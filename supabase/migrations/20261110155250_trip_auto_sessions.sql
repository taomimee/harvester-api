begin;
-- Work trips and broker balances are independent. Never close or rewrite a trip here.
drop index public.field_trips_one_open_vehicle;

create table public.boss_sessions (
  token_hash text primary key check(length(token_hash)=64),
  pin_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.boss_sessions enable row level security;
revoke all on public.boss_sessions from public, anon, authenticated;
grant select, insert, delete on public.boss_sessions to service_role;
create index boss_sessions_expiry on public.boss_sessions(expires_at);

-- Remember copies even after an owner deletes them, so background work cannot revive them.
alter table public.gps_area_daily add column published_parts jsonb not null default '[]'::jsonb;
create function public.publish_gps_area_plots(
  p_vehicle_id bigint, p_work_date date, p_expected_revision integer,
  p_new_plots jsonb, p_handled_parts jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  existing public.harvest_plots%rowtype;
  current_revision integer;
  combined jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('gps-plots:' || p_vehicle_id::text || ':' || p_work_date::text,0));
  select * into existing from public.harvest_plots where vehicle_id=p_vehicle_id and work_date=p_work_date
    order by created_at desc,id desc limit 1 for update;
  current_revision := coalesce(existing.revision,0);
  if current_revision <> p_expected_revision then raise exception 'GPS_REVISION_CONFLICT'; end if;
  perform 1 from public.gps_area_daily where vehicle_id=p_vehicle_id and work_date=p_work_date for update;
  if not found then raise exception 'GPS_SNAPSHOT_MISSING'; end if;
  if jsonb_typeof(p_new_plots) <> 'array' or jsonb_typeof(p_handled_parts) <> 'array' then raise exception 'GPS_INVALID_PUBLISH'; end if;
  -- Two workers can share the same old plot revision when all parts were already covered.
  if exists(select 1 from public.gps_area_daily d, jsonb_array_elements_text(p_handled_parts) p
    where d.vehicle_id=p_vehicle_id and d.work_date=p_work_date and d.published_parts ? p) then
    raise exception 'GPS_REVISION_CONFLICT';
  end if;
  if exists(select 1 from jsonb_array_elements(p_new_plots) p where p->>'job_id' is not null or p->>'source' is distinct from 'GPS_LOCK') then
    raise exception 'GPS_AUTO_MUST_BE_UNASSIGNED';
  end if;
  combined := coalesce(existing.plots_data,'[]'::jsonb) || p_new_plots;
  if jsonb_array_length(combined)>200 then raise exception 'GPS_PLOT_LIMIT'; end if;
  if jsonb_array_length(p_new_plots)>0 then
    if existing.id is null then
      insert into public.harvest_plots(vehicle_id,work_date,plots_data,revision) values(p_vehicle_id,p_work_date,combined,current_revision+1);
    else
      update public.harvest_plots set plots_data=combined,revision=current_revision+1 where id=existing.id;
    end if;
    current_revision := current_revision+1;
  end if;
  update public.gps_area_daily set published_parts=published_parts || p_handled_parts where vehicle_id=p_vehicle_id and work_date=p_work_date;
  return jsonb_build_object('revision',current_revision,'added',jsonb_array_length(p_new_plots));
end;
$$;
revoke all on function public.publish_gps_area_plots(bigint,date,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_gps_area_plots(bigint,date,integer,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
