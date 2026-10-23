const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', U='33333333-3333-4333-8333-333333333333';
const L=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
test('Postgres enforcement: free trial, ownership, expiration, payment replay and existing listings',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;grant usage on schema auth to authenticated,anon,service_role;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
 create table public.listings(id uuid primary key,seller_id uuid references auth.users(id),status text not null default 'active',title text);
 alter table public.listings enable row level security;
 grant select,insert,update,delete on public.listings to authenticated;
 create policy own on public.listings to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid());
 insert into auth.users values('${A}',now()),('${B}',now()),('${U}',null);
 insert into public.listings values('${L(1)}','${A}','active','Existing');
 `);
 await db.exec(fs.readFileSync('database/billing.sql','utf8'));
 const run=(role,sub,sql,args=[])=>db.transaction(async tx=>{
  await tx.exec('set local role '+role);
  await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(sub?{sub,role}:{role})]);
  return tx.query(sql,args);
 });
 const user=(sub,sql,args)=>run('authenticated',sub,sql,args);
 const service=(sql,args)=>run('service_role',null,sql,args);
 const prepare=(seller,id)=>service('select public.billing_prepare_listing($1,$2) as result',[seller,id]).then(r=>r.rows[0].result);
 await service('select public.billing_activate()');
 const add=(seller,id)=>user(seller,"insert into public.listings values($1,$2,'hidden','New wheels')",[id,seller]);
 await user(A,"update public.listings set title='Existing preserved' where id=$1",[L(1)]);
 await assert.rejects(user(A,"insert into public.listings values($1,$2,'active','Bypass')",[L(2),A]),/Publish through/);
 await add(A,L(2));
 await assert.rejects(user(A,"select public.billing_prepare_listing($1,$2)",[A,L(2)]),/permission denied/);
 await assert.rejects(user(A,"insert into wheelswap_billing.listing_access values($1,$2,'payment',now())",[L(2),A]),/permission denied/);
 const trial=await prepare(A,L(2));assert.equal(trial.published,true);assert.ok(trial.trial_ends_at);
 const dates=(await db.query('select * from wheelswap_billing.sellers')).rows[0];
 assert.equal(new Date(dates.trial_ends_at)-new Date(dates.trial_started_at),30*86400000);
 await add(B,L(3));await assert.rejects(prepare(A,L(3)),/Listing not found/);
 await db.query("update wheelswap_billing.sellers set trial_ends_at=now()-interval '1 second' where seller_id=$1",[A]);
 await add(A,L(4));const order=await prepare(A,L(4));assert.equal(order.published,false);assert.ok(order.order_id);
 const repeat=await prepare(A,L(4));assert.equal(repeat.order_id,order.order_id);
 assert.equal((await db.query('select count(*)::int n from wheelswap_billing.sellers where seller_id=$1',[A])).rows[0].n,1);
 await assert.rejects(user(A,"update public.listings set status='active' where id=$1",[L(4)]),/Publish through/);
 const fulfill=(seller,listing,session='cs_test_verified')=>service('select public.billing_fulfill_listing($1,$2,$3,$4,null,null) as result',[order.order_id,session,seller,listing]).then(r=>r.rows[0].result);
 await assert.rejects(fulfill(B,L(3)),/Order mismatch/);
 await service('select public.billing_checkout_session($1,$2,$3,false)',[order.order_id,A,'cs_test_verified']);
 await assert.rejects(fulfill(A,L(4),'cs_test_other'),/Session mismatch/);
 assert.equal((await fulfill(A,L(4))).fulfilled,true);
 assert.equal((await db.query('select status from public.listings where id=$1',[L(4)])).rows[0].status,'active');
 await user(A,"update public.listings set status='sold' where id=$1",[L(4)]);
 assert.equal((await fulfill(A,L(4))).duplicate,true);
 assert.equal((await db.query('select status from public.listings where id=$1',[L(4)])).rows[0].status,'sold');
 assert.equal((await prepare(A,L(4))).published,true);
 await assert.rejects(user(A,'update public.listings set id=$1 where id=$2',[L(5),L(4)]),/identity/);
 await add(U,L(6));await assert.rejects(prepare(U,L(6)),/Verified seller/);
 // Another seller starts an independent trial; resetting a profile cannot reset it.
 const second=await prepare(B,L(3));assert.equal(second.published,true);
 assert.equal((await db.query('select count(*)::int n from wheelswap_billing.sellers')).rows[0].n,2);
 // Expiry needs a server-verified expired Stripe Session; time alone never permits double checkout during delayed settlement.
 await add(A,L(7));const pending=await prepare(A,L(7));
 await db.query("update wheelswap_billing.orders set expires_at=now()-interval '1 day' where id=$1",[pending.order_id]);
 assert.equal((await prepare(A,L(7))).order_id,pending.order_id);
 await service('select public.billing_checkout_session($1,$2,$3,false)',[pending.order_id,A,'cs_expired']);
 await service('select public.billing_checkout_session($1,$2,$3,true)',[pending.order_id,A,'cs_expired']);
 assert.notEqual((await prepare(A,L(7))).order_id,pending.order_id);
 } finally {await db.close();}
});
