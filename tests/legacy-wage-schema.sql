CREATE OR REPLACE FUNCTION public.wage_crew_snapshot(worker_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  names text[];
  roles text[] := array[]::text[];
  n text;
  r text;
  driver_count integer := 0;
  amount integer;
  support_rate integer := 0;
  driver_rate integer;
  result jsonb := '[]'::jsonb;
  i integer;
begin
  select array_agg(btrim(x)) into names from unnest(string_to_array(worker_text, ',')) x where btrim(x) <> '';
  if coalesce(cardinality(names),0) < 1 then
    raise exception 'เลือกคนทำงานอย่างน้อย 1 คน';
  end if;
  if cardinality(names) <> (select count(distinct x) from unnest(names) x) then
    raise exception 'ห้ามเลือกชื่อคนงานซ้ำ';
  end if;
  foreach n in array names loop
    select role into r from public.wage_workers where name = n for share;
    if r is null then raise exception 'กรุณาตั้งระดับของ % ก่อนบันทึกรอบใหม่', n; end if;
    roles := array_append(roles,r);
    if r = 'DRIVER' then driver_count := driver_count + 1;
    elsif r = 'HELPER' then support_rate := support_rate + 20;
    else support_rate := support_rate + 10; end if;
  end loop;
  if driver_count = 0 then raise exception 'ต้องมีคนขับอย่างน้อย 1 คน'; end if;
  if 60 - support_rate < driver_count * 30 then
    raise exception 'ค่าแรง 60 บาท/ไร่ไม่พอสำหรับทีมนี้ คนขับต้องได้อย่างน้อยคนละ 30 บาท/ไร่ กรุณาตกลงทีมงานก่อนบันทึก';
  end if;
  driver_rate := (60 - support_rate) / driver_count;
  for i in 1..cardinality(names) loop
    amount := case when roles[i]='DRIVER' then driver_rate
      when roles[i]='HELPER' then 20 else 10 end;
    result := result || jsonb_build_array(jsonb_build_object('name',names[i],'role',roles[i],'rate',amount));
  end loop;
  return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.wage_transaction_snapshot_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare round_key text; worker_text text;
begin
  if new.type = 'OUT' and new.category = 'ค่าแรง' then
    round_key := substring(new.note from '\[รอบงาน:([0-9]+)\]');
    if round_key is not null then
      -- A NULL snapshot on a pre-upgrade round deliberately preserves equal division.
      select wage_split into new.wage_split from public.job_work_rounds
        where id = round_key::bigint and job_id = new.job_id;
      if not found then raise exception 'ไม่พบรอบงานของบิลค่าแรง'; end if;
    elsif exists(select 1 from public.job_work_rounds where job_id = new.job_id) then
      -- RPCs without a round marker are filled by the linkage trigger below.
      new.wage_split := null;
    else
      worker_text := btrim(substring(new.note from 'คนทำ:\s*([^\(\[]+)'));
      new.wage_split := public.wage_crew_snapshot(worker_text);
    end if;
  end if;
  return new;
end $function$
;