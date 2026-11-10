'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const turf = require('@turf/turf');
const { randomUUID } = require('node:crypto');
const { applyAction, gpsPlotGroupKey } = require('../lib/field-trips');
const { createFixture } = require('./field-fixture');
const { registerFieldTrips } = require('../lib/field-trip-routes');
const express = require('express');
const { once } = require('node:events');
const helpers = import('../harvester-app/src/gps-auto-import.mjs');
const day = '2026-11-10';
const ring = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const shape = {type:'MultiPolygon',coordinates:[[ring(100,15,.002,.002),ring(100.0005,15.0005,.0003,.0003)],[ring(100.003,15,.001,.001)]]};
const receipt = {id:'field-1@2026-11-10T04:00:00Z',plot_id:'field-1',number:1,locked_at:'2026-11-10T04:00:00Z',geometry:{type:'Feature',properties:{},geometry:shape}};
const result = {vehicle_id:1,work_date:day,locked_plots:[receipt],plots:[{id:'field-1',additional_rai:10}]};
const geometry = plot => {
  const close = points => [...points.map(p=>[p.lng,p.lat]),[points[0].lng,points[0].lat]];
  return turf.polygon([close(plot.points),...plot.holes.map(h=>close(h.points))]);
};

test('import preserves every disconnected piece and inner exclusion, only from locked receipts',async()=>{
  const {prepareAutoPlotUse} = await helpers;
  const copy = structuredClone(result), plan = prepareAutoPlotUse(result,'field-1',[],1,day);
  assert.equal(plan.plots.length,2); assert.equal(plan.plots[0].holes.length,1);
  assert.ok(Math.abs(plan.plots.reduce((s,p)=>s+turf.area(geometry(p)),0)-turf.area(shape))<0.01);
  assert.equal(new Set(plan.ids).size,2); assert.deepEqual(result,copy);
  assert.throws(()=>prepareAutoPlotUse({...result,locked_plots:[]},'field-1',[],1,day),/ยังไม่มี/);
});
test('retry and later coverage preserve edited geometry, queue and names without duplicates',async()=>{
  const {prepareAutoPlotUse} = await helpers;
  const first=prepareAutoPlotUse(result,'field-1',[],1,day);
  const edited=structuredClone(first.plots); edited[0].job_id=81;edited[0].name='แก้โดยเจ้าของ';edited[0].points[0].lat+=.0001;
  const again=prepareAutoPlotUse(result,'field-1',edited,1,day);
  assert.deepEqual(again.plots,edited);assert.equal(again.added.length,0);
  const newer={...result,locked_plots:[receipt,{...receipt,id:'field-1@2026-11-10T06:00:00Z',geometry:{type:'Polygon',coordinates:[ring(100.005,15,.001,.001)]}}]};
  const more=prepareAutoPlotUse(newer,'field-1',edited,1,day);
  assert.equal(more.added.length,1);assert.deepEqual(more.plots.slice(0,2),edited);
});
test('stale vehicle/day or unusable geometry cannot import into another scope',async()=>{
  const {prepareAutoPlotUse}=await helpers;
  assert.throws(()=>prepareAutoPlotUse(result,'field-1',[],2,day),/รถหรือวันที่/);
  assert.throws(()=>prepareAutoPlotUse(result,'field-1',[],1,'2026-11-11'),/รถหรือวันที่/);
  assert.throws(()=>prepareAutoPlotUse({...result,locked_plots:[{...receipt,geometry:{type:'LineString',coordinates:[]}}]},'field-1',[],1,day),/ขอบแปลง/);
});
test('field-trip handoff keeps confirmed area and does not create a second daily job',async()=>{
  const {prepareFieldGpsDay}=await helpers;
  const old={id:'old-day',work_date:day,vehicle_id:'1',plot_count:4,confirmed_rai:30,price_per_rai:600,crew:[{name:'สมชาย'}],gps_plots:[{key:`1/${day}/old`}],note:'ยอดนายหน้า'};
  const trip={status:'OPEN',vehicles:[{id:'1'}],start_date:day,price_per_rai:600,days:[old]};
  const entry={vehicle_id:1,work_date:day,plot_ids:['auto-1','auto-2']};
  const draft=prepareFieldGpsDay(trip,entry,'unused');
  assert.equal(draft.id,old.id);assert.equal(draft.confirmed_rai,30);assert.equal(draft.plot_count,4);
  assert.deepEqual(draft.gps_keys,[`1/${day}/old`,`1/${day}/auto-1`,`1/${day}/auto-2`]);
  assert.equal(prepareFieldGpsDay({...trip,days:[]},entry,'new').confirmed_rai,'');
  assert.throws(()=>prepareFieldGpsDay({...trip,status:'CLOSED'},entry,'new'),/ไม่ตรง/);
});
test('multiple GPS pieces count as one field, while other fields and duplicate keys are rejected',async()=>{
  const {prepareAutoPlotUse}=await helpers;
  const context={vehicles:[{id:1,name:'รถ 1'}],profiles:[{name:'สมชาย',role:'DRIVER'}]};
  const trip=applyAction(null,{type:'CREATE',location:'ลพบุรี',start_date:day,vehicle_ids:[1],price_per_rai:600},context);
  const plots=prepareAutoPlotUse(result,'field-1',[],1,day).plots.map(p=>({key:`1/${day}/${p.id}`,group_key:gpsPlotGroupKey(p,1,day),vehicle_id:'1',work_date:day,area_rai:2,job_id:null}));
  const action={type:'DAY_SAVE',id:randomUUID(),vehicle_id:'1',work_date:day,plot_count:1,confirmed_rai:3,price_per_rai:600,worker_names:['สมชาย'],gps_keys:plots.map(p=>p.key)};
  const saved=applyAction(trip,action,{...context,gpsPlots:plots});
  assert.equal(saved.days[0].gps_rai,4);assert.equal(saved.days[0].plot_count,1);assert.equal(saved.days[0].wage_amount,180);
  assert.throws(()=>applyAction(trip,{...action,gps_keys:[plots[0].key,plots[0].key]},{...context,gpsPlots:plots}),/เลือกซ้ำ/);
  assert.throws(()=>applyAction(trip,action,{...context,gpsPlots:[plots[0],{...plots[1],group_key:'other-field'}]}),/เกินจำนวน/);
  assert.throws(()=>applyAction(trip,action,{...context,gpsPlots:[{...plots[0],job_id:81},plots[1]]}),/ลงซ้ำ/);
});
test('route and database keep one daily wage on retry and GPS-only edits',async t=>{
  const fixture=await createFixture();
  const {prepareAutoPlotUse}=await helpers;
  const editable=prepareAutoPlotUse(result,'field-1',[],1,day).plots;
  fixture.store.plots=async()=>editable;
  fixture.geometry=p=>({netSqM:turf.area(geometry(p)),net:geometry(p)});
  const app=express();app.use(express.json());registerFieldTrips(app,{...fixture,isBoss:()=>true});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await fixture.db.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/field-trips`;
  const refs=await (await fetch(`${url}/gps/1?date=${day}`)).json();
  assert.equal(refs.plots.length,2);assert.equal(new Set(refs.plots.map(p=>p.group_key)).size,1);
  assert.equal((await fixture.db.query('select count(*)::int n from transactions')).rows[0].n,1);
  const id=randomUUID();let revision=0;
  const send=async(action,request_id=randomUUID(),rev=revision)=>{
    const r=await fetch(`${url}/${id}/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:rev,request_id,action})});
    const data=await r.json();assert.equal(r.status,200,data.error);revision=data.revision;return data;
  };
  await send({type:'CREATE',location:'ลพบุรี',start_date:day,vehicle_ids:[1],price_per_rai:600});
  const action={type:'DAY_SAVE',id:randomUUID(),vehicle_id:'1',work_date:day,plot_count:1,confirmed_rai:3,price_per_rai:600,worker_names:['สมชาย'],gps_keys:refs.plots.map(p=>p.key)};
  const request=randomUUID(), before=revision;
  const first=await send(action,request);await send(action,request,before);
  editable[0].points[0].lat+=.0001;
  const updated=await send(action);
  assert.notEqual(updated.days[0].gps_rai,first.days[0].gps_rai);
  assert.equal(updated.days[0].confirmed_rai,3);assert.equal(updated.summary.received,0);assert.equal(updated.summary.broker_balance,1800);
  const wages=(await fixture.db.query("select total_amount from transactions where job_id is null and category='ค่าแรง'")).rows;
  assert.equal(wages.length,1);assert.equal(Number(wages[0].total_amount),180);
});
