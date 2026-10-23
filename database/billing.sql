-- Apply once after approval, before deploying the billing-aware frontend.
-- No existing listings, accounts, photos, or messages are deleted or rewritten.
begin;
create schema wheelswap_billing;
revoke all on schema wheelswap_billing from public, anon, authenticated;
create table wheelswap_billing.settings (id boolean primary key default true check(id),enabled boolean not null default false);
insert into wheelswap_billing.settings(id,enabled) values(true,false);
alter table wheelswap_billing.settings enable row level security;
create table wheelswap_billing.sellers (
 seller_id uuid primary key references auth.users(id) on delete cascade,
 trial_started_at timestamptz not null default now(),
 trial_ends_at timestamptz not null default (now()+interval '30 days')
);
create table wheelswap_billing.listing_access (
 listing_id uuid primary key references public.listings(id) on delete cascade,
 seller_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check(reason in ('existing','trial','payment')),
 granted_at timestamptz not null default now()
);
create table wheelswap_billing.orders (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.listings(id) on delete cascade,
 seller_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default (now()+interval '35 minutes'),
 status text not null default 'pending' check(status in ('pending','expired','paid')),
 session_id text unique,
 customer_id text,
 payment_intent_id text,
 paid_at timestamptz
);
create unique index one_pending_checkout_per_listing on wheelswap_billing.orders(listing_id) where status='pending';
alter table wheelswap_billing.sellers enable row level security;
alter table wheelswap_billing.listing_access enable row level security;
alter table wheelswap_billing.orders enable row level security;
-- Preserve access for every listing that predates this rollout, including sold/hidden ones.
insert into wheelswap_billing.listing_access(listing_id,seller_id,reason)
 select id,seller_id,'existing' from public.listings;

create function wheelswap_billing.guard_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not (select enabled from wheelswap_billing.settings where id) then return new; end if;
 if TG_OP='UPDATE' and (new.id<>old.id or new.seller_id<>old.seller_id) then
  raise exception 'Listing identity and ownership cannot change';
 end if;
 if new.status='active' then
  if not exists(select 1 from auth.users where id=new.seller_id and email_confirmed_at is not null) then
   raise exception 'Verify your email before publishing';
  end if;
  if not exists(select 1 from wheelswap_billing.listing_access a where a.listing_id=new.id and a.seller_id=new.seller_id) then
   raise exception 'Publish through WheelSwap to check your trial or listing payment';
  end if;
 end if;
 return new;
end $$;
revoke all on function wheelswap_billing.guard_listing() from public, anon, authenticated;
create trigger wheelswap_billing_gate before insert or update on public.listings
 for each row execute function wheelswap_billing.guard_listing();

-- These internal functions are ONLY callable by service_role through the wrappers below.
-- Seller identity is verified with Supabase Auth by the server, never supplied by the browser.
create function wheelswap_billing.prepare(p_seller_id uuid,p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.listings; s wheelswap_billing.sellers; o wheelswap_billing.orders;
begin
 if auth.uid() is not null then raise exception 'Server access required'; end if;
 if not exists(select 1 from auth.users where id=p_seller_id and email_confirmed_at is not null) then
  raise exception 'Verified seller required';
 end if;
 select * into l from public.listings where id=p_listing_id and seller_id=p_seller_id for update;
 if not found then raise exception 'Listing not found'; end if;
 if exists(select 1 from wheelswap_billing.listing_access where listing_id=l.id and seller_id=p_seller_id) then
  update public.listings set status='active' where id=l.id;
  return jsonb_build_object('published',true);
 end if;
 insert into wheelswap_billing.sellers(seller_id) values(p_seller_id) on conflict do nothing;
 select * into s from wheelswap_billing.sellers where seller_id=p_seller_id;
 if now()<s.trial_ends_at then
  insert into wheelswap_billing.listing_access(listing_id,seller_id,reason) values(l.id,p_seller_id,'trial');
  update public.listings set status='active' where id=l.id;
  return jsonb_build_object('published',true,'trial_ends_at',s.trial_ends_at);
 end if;
 select * into o from wheelswap_billing.orders where listing_id=l.id and status='pending';
 if not found then
  insert into wheelswap_billing.orders(listing_id,seller_id) values(l.id,p_seller_id) returning * into o;
 end if;
 return jsonb_build_object('published',false,'order_id',o.id,'listing_id',l.id,'expires_at',o.expires_at,'session_id',o.session_id);
end $$;
revoke all on function wheelswap_billing.prepare(uuid,uuid) from public, anon, authenticated;

create function wheelswap_billing.fulfill(p_order_id uuid,p_session_id text,p_seller_id uuid,p_listing_id uuid,p_customer_id text,p_payment_intent_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o wheelswap_billing.orders;
begin
 if auth.uid() is not null then raise exception 'Server access required'; end if;
 -- Same lock order as prepare prevents checkout/webhook deadlocks.
 perform 1 from public.listings where id=p_listing_id and seller_id=p_seller_id for update;
 if not found then raise exception 'Listing not found'; end if;
 select * into o from wheelswap_billing.orders where id=p_order_id for update;
 if not found or o.seller_id<>p_seller_id or o.listing_id<>p_listing_id then raise exception 'Order mismatch'; end if;
 if o.session_id is not null and o.session_id<>p_session_id then raise exception 'Session mismatch'; end if;
 if o.status='paid' then
  if o.session_id<>p_session_id then raise exception 'Session mismatch'; end if;
  return jsonb_build_object('fulfilled',true,'duplicate',true);
 end if;
 update wheelswap_billing.orders set status='paid',session_id=p_session_id,customer_id=p_customer_id,
  payment_intent_id=p_payment_intent_id,paid_at=now() where id=o.id;
 insert into wheelswap_billing.listing_access(listing_id,seller_id,reason) values(o.listing_id,o.seller_id,'payment') on conflict do nothing;
 update public.listings set status='active' where id=o.listing_id and status='hidden';
 return jsonb_build_object('fulfilled',true,'duplicate',false);
end $$;
revoke all on function wheelswap_billing.fulfill(uuid,text,uuid,uuid,text,text) from public, anon, authenticated;

create function public.billing_prepare_listing(p_seller_id uuid,p_listing_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select wheelswap_billing.prepare(p_seller_id,p_listing_id) $$;
create function public.billing_fulfill_listing(p_order_id uuid,p_session_id text,p_seller_id uuid,p_listing_id uuid,p_customer_id text,p_payment_intent_id text) returns jsonb
language sql security invoker set search_path='' as $$ select wheelswap_billing.fulfill(p_order_id,p_session_id,p_seller_id,p_listing_id,p_customer_id,p_payment_intent_id) $$;
revoke all on function public.billing_prepare_listing(uuid,uuid) from public,anon,authenticated;
revoke all on function public.billing_fulfill_listing(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant usage on schema wheelswap_billing to service_role;
grant execute on function wheelswap_billing.prepare(uuid,uuid),wheelswap_billing.fulfill(uuid,text,uuid,uuid,text,text) to service_role;
grant execute on function public.billing_prepare_listing(uuid,uuid),public.billing_fulfill_listing(uuid,text,uuid,uuid,text,text) to service_role;

create function wheelswap_billing.checkout_session(p_order_id uuid,p_seller_id uuid,p_session_id text,p_expire boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then raise exception 'Server access required'; end if;
 if p_expire then
  update wheelswap_billing.orders set status='expired' where id=p_order_id and seller_id=p_seller_id and session_id=p_session_id and status='pending';
 else
  update wheelswap_billing.orders set session_id=p_session_id where id=p_order_id and seller_id=p_seller_id and (session_id is null or session_id=p_session_id);
 end if;
 if not found then raise exception 'Order mismatch'; end if;
end $$;
revoke all on function wheelswap_billing.checkout_session(uuid,uuid,text,boolean) from public,anon,authenticated;
create function public.billing_checkout_session(p_order_id uuid,p_seller_id uuid,p_session_id text,p_expire boolean) returns void
language sql security invoker set search_path='' as $$ select wheelswap_billing.checkout_session(p_order_id,p_seller_id,p_session_id,p_expire) $$;
revoke all on function public.billing_checkout_session(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.billing_checkout_session(uuid,uuid,text,boolean),wheelswap_billing.checkout_session(uuid,uuid,text,boolean) to service_role;

-- Activate only after the Vercel deployment and Sandbox checks succeed.
-- Locks briefly so no pre-rollout listing loses its access during the switch.
create function wheelswap_billing.activate() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then raise exception 'Server access required'; end if;
 lock table public.listings in share row exclusive mode;
 if (select enabled from wheelswap_billing.settings where id) then return; end if;
 insert into wheelswap_billing.listing_access(listing_id,seller_id,reason)
  select id,seller_id,'existing' from public.listings on conflict do nothing;
 update wheelswap_billing.settings set enabled=true where id;
end $$;
revoke all on function wheelswap_billing.activate() from public,anon,authenticated;
create function public.billing_activate() returns void language sql security invoker set search_path='' as $$ select wheelswap_billing.activate() $$;
revoke all on function public.billing_activate() from public,anon,authenticated;
grant execute on function public.billing_activate(),wheelswap_billing.activate() to service_role;
commit;
