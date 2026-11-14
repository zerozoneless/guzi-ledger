-- ============================================================================
-- 谷子账本 · Supabase 建表脚本
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 注意：先把下面两处 'guzi-2026' 换成你自己的房间码（要和 App 里填的一致）
--
-- 本脚本对「Automatically expose new tables」开着或关着都能正常工作：
-- 末尾显式给 anon 角色授权，不依赖自动暴露。
-- ============================================================================

create table if not exists customers (
  id text primary key,
  room text not null,
  name text not null,
  note text default '',
  created_at text default '',
  updated_at bigint not null,
  deleted boolean default false
);

create table if not exists txns (
  id text primary key,
  room text not null,
  customer_id text not null,
  kind text not null,
  amount integer not null,
  at text not null,
  note text default '',
  operator text default '',
  voided boolean default false,
  voided_at text default '',
  created_at text default '',
  updated_at bigint not null,
  deleted boolean default false
);

create index if not exists customers_room_idx on customers (room);
create index if not exists txns_room_idx on txns (room);

-- 开启行级权限：只有知道房间码的客户端才读得到自己的数据
alter table customers enable row level security;
alter table txns enable row level security;

drop policy if exists room_customers on customers;
create policy room_customers on customers
  for all to anon
  using (room = 'guzi-2026')
  with check (room = 'guzi-2026');

drop policy if exists room_txns on txns;
create policy room_txns on txns
  for all to anon
  using (room = 'guzi-2026')
  with check (room = 'guzi-2026');

-- 显式授权：这样即使项目里关掉了「自动暴露新表」，REST 接口也能读写
grant usage on schema public to anon;
grant select, insert, update, delete on public.customers to anon;
grant select, insert, update, delete on public.txns to anon;
