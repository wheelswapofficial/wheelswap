-- Applied using Supabase migration seller_private_listing_views.

create table public.listing_views (
 listing_id uuid not null references public.listings(id) on delete cascade,
 viewer_session uuid not null,
 viewed_at timestamptz not null default now(),
 primary key (listing_id, viewer_session)
);
alter table public.listing_views enable row level security;
revoke all on public.listing_views from public, anon, authenticated;
grant insert (listing_id, viewer_session) on public.listing_views to anon, authenticated;
grant select on public.listing_views to authenticated;
create policy "Visitors record active listing opens" on public.listing_views
for insert to anon, authenticated with check (
 exists (select 1 from public.listings l where l.id=listing_id and l.status='active'
 and l.seller_id is distinct from (select auth.uid()))
);
create policy "Sellers read only their listing views" on public.listing_views
for select to authenticated using (
 exists (select 1 from public.listings l where l.id=listing_id and l.seller_id=(select auth.uid()))
);
create function public.get_my_listing_view_counts()
returns table(listing_id uuid, views bigint)
language sql stable security invoker set search_path=''
as $$
 select v.listing_id, count(*) from public.listing_views v
 join public.listings l on l.id=v.listing_id
 where l.seller_id=(select auth.uid())
 group by v.listing_id;
$$;
revoke all on function public.get_my_listing_view_counts() from public, anon;
grant execute on function public.get_my_listing_view_counts() to authenticated;
comment on table public.listing_views is 'Listing detail opens, deduplicated per listing and browser session. Counts begin when tracking is deployed.';
