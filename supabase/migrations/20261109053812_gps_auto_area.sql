begin;
create table public.gps_area_settings (
  vehicle_id bigint primary key references public.vehicles(id),
  enabled boolean not null default true,
  head_width_m numeric not null default 3 check(head_width_m between 1 and 15),
  created_at timestamptz not null default now()
);
create table public.gps_area_daily (
  vehicle_id bigint not null references public.vehicles(id),
  work_date date not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  fingerprint text not null,
  revision bigint not null default 1 check(revision>0),
  source_first timestamptz,
  source_last timestamptz,
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,work_date)
);
-- The worker credential remains inside the existing backend/database boundary.
create table public.gps_area_worker (
  id text primary key check(id='main'),
  token text not null default(gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into public.gps_area_worker(id) values('main');
insert into public.gps_area_settings(vehicle_id) select id from public.vehicles;
alter table public.gps_area_settings enable row level security;
alter table public.gps_area_daily enable row level security;
alter table public.gps_area_worker enable row level security;
revoke all on public.gps_area_settings,public.gps_area_daily,public.gps_area_worker from public,anon,authenticated;
grant select on public.gps_area_settings,public.gps_area_worker to service_role;
grant select,insert,update on public.gps_area_daily to service_role;
comment on table public.gps_area_daily is 'Automatic GPS area estimates only. Does not post wages, customer jobs or broker receipts.';
commit;
