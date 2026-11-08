-- Additive schema. Existing customer/job/GPS and wage records are never rewritten.
begin;
create table public.field_trips (
  id uuid primary key,
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (document->>'status' in ('OPEN', 'CLOSED')),
  check (jsonb_array_length(document->'vehicles') = 1),
  check (jsonb_typeof(document->'days') = 'array'),
  check (jsonb_typeof(document->'payments') = 'array')
);
create unique index field_trips_one_open_vehicle on public.field_trips
  ((document->'vehicles'->0->>'id')) where document->>'status' = 'OPEN';

create table public.field_trip_events (
  request_id uuid primary key,
  trip_id uuid not null references public.field_trips(id),
  request_hash text not null,
  action_type text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index field_trip_events_trip on public.field_trip_events(trip_id, created_at);
create table public.field_trip_gps_claims (
  plot_key text primary key,
  trip_id uuid not null references public.field_trips(id),
  day_id uuid not null
);
create index field_trip_gps_claims_trip on public.field_trip_gps_claims(trip_id);

-- Daily field work posts to the same wage ledger as local work. Existing withdrawals
-- keep offsetting the worker's lifetime balance, independently of broker receipts.
alter table public.transactions add column field_trip_id uuid references public.field_trips(id);
alter table public.transactions add column field_day_id uuid;
alter table public.transactions add column field_trip_label text;
create unique index transactions_field_day_unique on public.transactions(field_day_id);
create index transactions_field_trip on public.transactions(field_trip_id) where field_trip_id is not null;

-- Field days already contain the historical crew snapshot. Keep the existing
-- local-work trigger intact, but do not let it recalculate historical field wages.
drop trigger wage_transaction_snapshot on public.transactions;
create trigger wage_transaction_snapshot before insert on public.transactions
for each row when (new.field_day_id is null)
execute function public.wage_transaction_snapshot_trigger();

create function public.guard_field_trip_wages() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.field_day_id is not null and current_setting('harvester.field_trip_write', true) is distinct from 'on' then
    raise exception 'ค่าแรงงานนอกพื้นที่ต้องแก้จากยอดรายวัน เพื่อรักษายอดทริปและสมุดค่าแรงให้ตรงกัน';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_field_trip_wages() from public, anon, authenticated;
grant execute on function public.guard_field_trip_wages() to service_role;
create trigger guard_field_trip_wages before update or delete on public.transactions
for each row execute function public.guard_field_trip_wages();

alter table public.field_trips enable row level security;
alter table public.field_trip_events enable row level security;
alter table public.field_trip_gps_claims enable row level security;
revoke all on public.field_trips, public.field_trip_events, public.field_trip_gps_claims from anon, authenticated;
grant select, insert, update on public.field_trips to service_role;
grant select, insert on public.field_trip_events to service_role;
grant select, insert, delete on public.field_trip_gps_claims to service_role;

-- The authenticated backend validates the domain rules. This invoker function provides
-- atomic compare-and-swap, idempotency, GPS claims, and an immutable revision snapshot.
create function public.save_field_trip(
  p_id uuid, p_revision integer, p_document jsonb,
  p_request_id uuid, p_request_hash text, p_action_type text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_row public.field_trips%rowtype;
  prior public.field_trip_events%rowtype;
  result jsonb;
  daily jsonb;
  worker_text text;
  wage_note text;
begin
  if p_id is null or p_request_id is null or p_revision is null or p_revision < 0 or
    p_document is null or p_request_hash is null or length(p_request_hash) <> 64 then
    raise exception 'FIELD_TRIP_INVALID_REQUEST';
  end if;
  -- Serializes creation too, before a row exists. Hash collisions only serialize unrelated work.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into prior from public.field_trip_events where request_id = p_request_id;
  if found then
    if prior.trip_id <> p_id or prior.request_hash <> p_request_hash then
      raise exception 'FIELD_TRIP_REQUEST_REUSED';
    end if;
    return prior.result;
  end if;
  select * into current_row from public.field_trips where id = p_id for update;
  if found then
    if current_row.revision <> p_revision then raise exception 'FIELD_TRIP_CONFLICT'; end if;
    update public.field_trips set document = p_document, revision = revision + 1, updated_at = now()
      where id = p_id returning * into current_row;
  else
    if p_revision <> 0 or p_action_type <> 'CREATE' then raise exception 'FIELD_TRIP_CONFLICT'; end if;
    insert into public.field_trips(id, revision, document) values(p_id, 1, p_document) returning * into current_row;
  end if;
  delete from public.field_trip_gps_claims where trip_id = p_id;
  insert into public.field_trip_gps_claims(plot_key, trip_id, day_id)
    select plot->>'key', p_id, (day->>'id')::uuid
    from jsonb_array_elements(p_document->'days') day
    cross join lateral jsonb_array_elements(day->'gps_plots') plot;
  if p_action_type = 'DAY_SAVE' then
    perform set_config('harvester.field_trip_write', 'on', true);
    for daily in select value from jsonb_array_elements(p_document->'days') loop
      select string_agg(person->>'name', ', ' order by ordinality) into worker_text
        from jsonb_array_elements(daily->'crew') with ordinality as workers(person, ordinality);
      wage_note := format('คนทำ: %s (พื้นที่ %s ไร่, เรท 60 บ./ไร่) [นอกพื้นที่: %s] [ปิดรายวัน %s]',
        worker_text, daily->>'confirmed_rai', p_document->>'location', daily->>'work_date');
      if exists(select 1 from public.transactions where field_day_id = (daily->>'id')::uuid
        and (status = 'PAID' or note like '%[จ่ายแล้ว:%')
        and (total_amount is distinct from (daily->>'wage_amount')::numeric or wage_split is distinct from daily->'crew')) then
        raise exception 'FIELD_TRIP_WAGE_ALREADY_SETTLED';
      end if;
      -- Preserve historical per-person paid markers if an older release posted any.
      if exists(select 1 from public.transactions where field_day_id = (daily->>'id')::uuid
        and (status = 'PAID' or note like '%[จ่ายแล้ว:%')) then continue; end if;
      insert into public.transactions(type, category, total_amount, paid_amount, status, note,
        transaction_date, vehicle_id, wage_split, field_trip_id, field_day_id, field_trip_label)
      values('OUT', 'ค่าแรง', (daily->>'wage_amount')::numeric, 0, 'UNPAID', wage_note,
        ((daily->>'work_date') || 'T12:00:00+07:00')::timestamptz, (daily->>'vehicle_id')::bigint,
        daily->'crew', p_id, (daily->>'id')::uuid, p_document->>'location')
      on conflict(field_day_id) do update set total_amount = excluded.total_amount,
        note = excluded.note, transaction_date = excluded.transaction_date,
        vehicle_id = excluded.vehicle_id, wage_split = excluded.wage_split, field_trip_label = excluded.field_trip_label
      where (transactions.total_amount, transactions.note, transactions.transaction_date, transactions.vehicle_id,
        transactions.wage_split, transactions.field_trip_label)
        is distinct from (excluded.total_amount, excluded.note, excluded.transaction_date, excluded.vehicle_id,
        excluded.wage_split, excluded.field_trip_label);
    end loop;
    perform set_config('harvester.field_trip_write', 'off', true);
  end if;
  result := jsonb_build_object('id', current_row.id, 'revision', current_row.revision, 'document', current_row.document);
  insert into public.field_trip_events(request_id, trip_id, request_hash, action_type, result)
    values(p_request_id, p_id, p_request_hash, p_action_type, result);
  return result;
end;
$$;
revoke all on function public.save_field_trip(uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_field_trip(uuid, integer, jsonb, uuid, text, text) to service_role;
comment on table public.field_trips is 'One vehicle per trip. Daily wages post immediately to the existing worker wallet; broker receipts settle separately.';
notify pgrst, 'reload schema';
commit;
