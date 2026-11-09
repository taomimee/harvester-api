'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('GPS snapshots keep credentials private and leave the old business data alone',async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table vehicles(id bigint primary key); insert into vehicles values(9); create table transactions(id int, amount numeric); insert into transactions values(1,1234);");
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261109053812_gps_auto_area.sql'),'utf8'));
    assert.equal((await db.query('select amount from transactions')).rows[0].amount,'1234');
    assert.equal((await db.query('select head_width_m from gps_area_settings')).rows[0].head_width_m,'3');
    const access=await db.query("select has_table_privilege('anon','gps_area_worker','select') as anon, has_table_privilege('authenticated','gps_area_daily','select') as authenticated,has_table_privilege('service_role','gps_area_daily','update') as worker");
    assert.deepEqual(access.rows[0],{anon:false,authenticated:false,worker:true});
    assert.equal((await db.query("select count(*)::int as n from pg_class where relname in ('gps_area_daily','gps_area_settings','gps_area_worker') and relrowsecurity")).rows[0].n,3);
    await db.exec("set role service_role; insert into gps_area_daily(vehicle_id,work_date,result,fingerprint) values(9,'2026-11-09','{}','test');");
    const written=await db.query("update gps_area_daily set revision=2 where vehicle_id=9 and work_date='2026-11-09' and revision=1 returning revision");assert.equal(written.rows.length,1);
    const conflict=await db.query("update gps_area_daily set revision=2 where vehicle_id=9 and work_date='2026-11-09' and revision=1 returning revision");assert.equal(conflict.rows.length,0);
  } finally {await db.close();}
});
