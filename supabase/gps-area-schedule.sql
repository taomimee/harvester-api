-- Enable only after the HTTP release is healthy. No business data is changed.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
revoke usage on schema net from public,anon,authenticated;
revoke all on all functions in schema net from public,anon,authenticated;
revoke all on all tables in schema net from public,anon,authenticated;

select cron.schedule('harvester-gps-area','*/2 * * * *',$schedule$
  select net.http_post(
    url:='https://harvester-api-server.onrender.com/api/gps-area-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-gps-worker-token',w.token),
    body:='{}'::jsonb,
    timeout_milliseconds:=90000
  ) from public.gps_area_worker w where w.id='main'
    and exists(select 1 from public.gps_logs where created_at>now()-interval '5 minutes');
$schedule$);
