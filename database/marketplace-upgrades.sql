begin;
-- Private saved filters; alerts are evaluated in the signed-in app.
create table public.saved_searches (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 100),
 filters jsonb not null check(jsonb_typeof(filters)='object' and octet_length(filters::text)<4000),
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 unique(user_id,filters)
);
alter table public.saved_searches enable row level security;
revoke all on public.saved_searches from anon,authenticated;
grant select,insert,update,delete on public.saved_searches to authenticated;
create policy own_saved_searches on public.saved_searches to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

-- Serialize per-account inserts so the limit also holds for concurrent requests.
create function public.limit_saved_searches() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext(new.user_id::text));
 if (select count(*) from public.saved_searches where user_id=new.user_id)>=20 then raise exception 'You can save up to 20 searches'; end if;
 return new;
end; $$;
revoke all on function public.limit_saved_searches() from public,anon,authenticated;
create trigger limit_saved_searches before insert on public.saved_searches for each row execute function public.limit_saved_searches();

-- Atomically save fields and the ordered photo references. Ownership stays under RLS.
create function public.edit_listing(p_id uuid,p_version timestamptz,p_details jsonb,p_photos jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare l public.listings; path text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into l from public.listings where id=p_id and seller_id=auth.uid() for update;
 if not found then raise exception 'Listing unavailable'; end if;
 if l.updated_at is distinct from p_version then raise exception 'This listing changed. Reopen the editor to get the latest version.'; end if;
 if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos)>10 then raise exception 'Choose up to 10 photos'; end if;
 if (select count(*) from jsonb_array_elements_text(p_photos))<>(select count(distinct value) from jsonb_array_elements_text(p_photos)) then raise exception 'Duplicate photos'; end if;
 for path in select value from jsonb_array_elements_text(p_photos) loop
  if path !~ ('^'||auth.uid()::text||'/'||p_id::text||'/[a-f0-9-]+\.(jpeg|jpg|png|webp)$') then raise exception 'Invalid photo path'; end if;
 end loop;
 if length(trim(p_details->>'title')) not between 5 and 90 or (p_details->>'price')::numeric not between 1 and 100000
 or length(trim(p_details->>'city')) not between 1 and 80 or (p_details->>'state') !~ '^[A-Z]{2}$'
 or (p_details->>'zip') !~ '^[0-9]{5}$' or coalesce(p_details->>'bolt','')='' then raise exception 'Check the listing details'; end if;
 update public.listings set title=trim(p_details->>'title'),price=(p_details->>'price')::numeric,
 wheel_diameter=(p_details->>'size')::numeric,wheel_width=nullif(p_details->>'width','')::numeric,
 bolt_pattern=p_details->>'bolt',brand=nullif(p_details->>'brand',''),city=trim(p_details->>'city'),state=p_details->>'state',zip_code=p_details->>'zip',
 description=coalesce(p_details->>'description',''),condition=p_details->>'condition',
 pickup_available=coalesce((p_details->>'pickup')::boolean,true),shipping_available=coalesce((p_details->>'shipping')::boolean,false),
 trades_accepted=coalesce((p_details->>'trade')::boolean,false),updated_at=clock_timestamp()
 where id=p_id and seller_id=auth.uid();
 delete from public.listing_photos where listing_id=p_id;
 insert into public.listing_photos(listing_id,storage_path,sort_order)
 select p_id,value,(ordinality-1)::integer from jsonb_array_elements_text(p_photos) with ordinality;
end; $$;
revoke all on function public.edit_listing(uuid,timestamptz,jsonb,jsonb) from public,anon;
grant execute on function public.edit_listing(uuid,timestamptz,jsonb,jsonb) to authenticated;

-- Public promotion expiry is readable; only the payment service can write it.
create table public.featured_listings (
 listing_id uuid primary key references public.listings(id) on delete cascade,
 starts_at timestamptz not null default now(),ends_at timestamptz not null
);
alter table public.featured_listings enable row level security;
revoke all on public.featured_listings from anon,authenticated;
grant select on public.featured_listings to anon,authenticated;
create policy active_featured on public.featured_listings for select to anon,authenticated
 using(ends_at>now() and exists(select 1 from public.listings l where l.id=listing_id and l.status='active'));
create table wheelswap_billing.feature_orders (
 id uuid primary key default gen_random_uuid(),listing_id uuid not null references public.listings(id) on delete cascade,
 seller_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','expired','paid')),
 session_id text unique,expires_at timestamptz not null default now()+interval '35 minutes',paid_at timestamptz,ends_at timestamptz
);
alter table wheelswap_billing.feature_orders enable row level security;
create unique index one_pending_feature_checkout on wheelswap_billing.feature_orders(listing_id) where status='pending';
-- Service-only RPCs run with no end-user identity; never executable by a browser role.
create function public.feature_prepare(p_seller_id uuid,p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o wheelswap_billing.feature_orders; ending timestamptz;
begin
 perform 1 from public.listings where id=p_listing_id and seller_id=p_seller_id and status='active' for update;
 if not found then raise exception 'Choose your own available listing'; end if;
 select ends_at into ending from public.featured_listings where listing_id=p_listing_id and ends_at>now();
 if found then return jsonb_build_object('active',true,'ends_at',ending); end if;
 -- Pending sessions are checked with Stripe before expiring the order.
 select * into o from wheelswap_billing.feature_orders where listing_id=p_listing_id and status='pending';
 if not found then insert into wheelswap_billing.feature_orders(listing_id,seller_id) values(p_listing_id,p_seller_id) returning * into o; end if;
 return jsonb_build_object('order_id',o.id,'session_id',o.session_id,'expires_at',o.expires_at);
end; $$;
create function public.feature_session(p_order_id uuid,p_seller_id uuid,p_session_id text,p_expire boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_expire then
  update wheelswap_billing.feature_orders set status='expired' where id=p_order_id and seller_id=p_seller_id and status='pending' and (session_id=p_session_id or (session_id is null and expires_at<now()));
 else
  update wheelswap_billing.feature_orders set session_id=p_session_id where id=p_order_id and seller_id=p_seller_id and status='pending' and (session_id is null or session_id=p_session_id);
 end if;
 if not found then raise exception 'Feature checkout changed. Please retry'; end if;
end; $$;
create function public.feature_fulfill(p_order_id uuid,p_seller_id uuid,p_listing_id uuid,p_session_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o wheelswap_billing.feature_orders; ending timestamptz;
begin
 -- Consistent listing -> order lock order with prepare avoids deadlocks.
 perform 1 from public.listings where id=p_listing_id and seller_id=p_seller_id for update;
 if not found then raise exception 'Listing unavailable'; end if;
 select * into o from wheelswap_billing.feature_orders where id=p_order_id and seller_id=p_seller_id and listing_id=p_listing_id for update;
 if not found or (o.session_id is not null and o.session_id<>p_session_id) then raise exception 'Feature payment does not match'; end if;
 if o.status='paid' then return jsonb_build_object('fulfilled',true,'ends_at',o.ends_at); end if;
 select greatest(now(),coalesce(ends_at,now()))+interval '7 days' into ending from public.featured_listings where listing_id=p_listing_id;
 ending=coalesce(ending,now()+interval '7 days');
 insert into public.featured_listings(listing_id,ends_at) values(p_listing_id,ending)
 on conflict(listing_id) do update set starts_at=now(),ends_at=excluded.ends_at;
 update wheelswap_billing.feature_orders set status='paid',session_id=p_session_id,paid_at=now(),ends_at=ending where id=o.id;
 return jsonb_build_object('fulfilled',true,'ends_at',ending);
end; $$;
revoke all on function public.feature_prepare(uuid,uuid),public.feature_session(uuid,uuid,text,boolean),public.feature_fulfill(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.feature_prepare(uuid,uuid),public.feature_session(uuid,uuid,text,boolean),public.feature_fulfill(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
