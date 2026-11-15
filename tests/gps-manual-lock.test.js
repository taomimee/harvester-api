'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {analyzeGpsDay}=require('../lib/gps-auto');
const {sealGpsPlot}=require('../lib/gps-manual-lock');
const {createAreaService,registerGpsArea}=require('../lib/gps-auto-routes');
const options={vehicleId:9,workDate:'2026-11-09',headWidth:3};
function field(x=0,y=0) {const p=[];for(let row=0;row<20;row++)for(let col=0;col<=20;col++)p.push([x+(row%2?20-col:col)*5,y+row*3]);return p;}
function trace(positions) {return positions.map(([x,y],i)=>({id:i+1,latitude:14+y/111195,longitude:100+x/(111195*Math.cos(14*Math.PI/180)),created_at:new Date(Date.parse('2026-11-09T01:00:00Z')+i*6000).toISOString()}));}
const measure=(positions,previous,extra={})=>analyzeGpsDay(trace(positions),{...options,previous,...extra});
const seal=result=>sealGpsPlot(result,result.plots.find(p=>p.state!=='completed').id,randomUUID(),'2026-11-15T02:00:00Z');

test('manual seal freezes current area and adjacent harvesting starts a new field; automatic behaviour is unchanged',async()=>{
  const positions=field(),first=measure(positions),locked=await seal(first);
  assert.equal(locked.plots[0].state,'completed');assert.ok(locked.plots[0].manual_seal);
  assert.ok(Math.abs(locked.estimated_rai-first.estimated_rai)<.001);
  const more=[...positions,...field(0,60)];
  assert.equal(measure(more,first).plots.length,1,'ordinary adjacent work still merges');
  const next=measure(more,JSON.parse(JSON.stringify(locked)));
  assert.deepEqual(next.locked_plots,locked.locked_plots);
  assert.deepEqual(next.plots.map(p=>p.number),[1,2]);
  assert.equal(next.plots[0].state,'completed');assert.equal(next.plots[1].state,'working');
  assert.ok(next.estimated_rai>7 && next.estimated_rai<8.5);
  const {gpsFieldAliases}=await import('../harvester-app/src/gps-field-identity.mjs');
  const aliases=gpsFieldAliases(next.plots);assert.notEqual(aliases[next.plots[0].id],aliases[next.plots[1].id]);
});

test('sealed work survives no new GPS, restarts, repeated passes and unloading roads without new area',async()=>{
  const positions=field(),locked=await seal(measure(positions));
  const road=[];for(let lane=0;lane<3;lane++)for(let i=0;i<=160;i++)road.push([(lane%2?160-i:i)*5,57+lane*3]);
  for(const nextPositions of [positions,[...positions,...field()],[...positions,...road]]) {
    const result=measure(nextPositions,JSON.parse(JSON.stringify(locked)));
    assert.equal(result.plots.length,1);assert.equal(result.plots[0].state,'completed');
    assert.deepEqual(result.locked_plots,locked.locked_plots);
    assert.ok(Math.abs(result.estimated_rai-locked.estimated_rai)<.001);
  }
});

test('multiple manual seals preserve each number and the third adjacent field remains separate',async()=>{
  let positions=field(),locked=await seal(measure(positions));
  positions.push(...field(0,60));const second=measure(positions,locked);locked=await seal(second);
  const third=measure([...positions,...field(0,120)],locked);
  assert.deepEqual(third.plots.map(p=>p.number),[1,2,3]);
  assert.deepEqual(third.plots.map(p=>p.state),['completed','completed','working']);
  assert.deepEqual(third.locked_plots,locked.locked_plots);assert.equal(third.manual_seals.length,2);
});

test('new field can auto-lock at 60m for 5 minutes after an explicit seal',async()=>{
  const positions=field(),locked=await seal(measure(positions));positions.push(...field(0,60));
  for(let i=1;i<=120;i++)positions.push([i*5,117]);
  const result=measure(positions,locked);assert.equal(result.plots.length,2);
  assert.ok(result.plots.every(p=>p.state==='completed'));assert.deepEqual(result.locked_plots[0],locked.locked_plots[0]);
  assert.deepEqual(result.lock_policy,{distance_m:60,away_seconds:300});
});

test('route/head-width changes cannot silently undo a manual seal, or leak it to another vehicle/day',async()=>{
  const positions=field(),locked=await seal(measure(positions));
  for(const extra of [{routeRevision:2},{headWidth:4}]) {
    const result=measure(positions,locked,extra);assert.equal(result.plots.length,1);assert.deepEqual(result.locked_plots,locked.locked_plots);
  }
  for(const extra of [{vehicleId:10},{workDate:'2026-11-10'}])assert.equal(measure([],locked,extra).locked_count,0);
});

test('unrelated ongoing work is retained when one of two pending fields is sealed',async()=>{
  // The other field stays close enough to reset the first departure timer.
  const positions=[...field(),...field(130,0)];
  const rows=trace(positions).map((p,i)=>i<420?p:{...p,created_at:new Date(Date.parse(p.created_at)+3600000).toISOString()});
  const first=analyzeGpsDay(rows,options),locked=await sealGpsPlot(first,first.plots[0].id,randomUUID(),'2026-11-15T02:00:00Z');
  const next=analyzeGpsDay(rows,{...options,previous:locked});
  assert.equal(next.plots.length,2);assert.equal(next.plots[1].state,first.plots[1].state);
  assert.ok(Math.abs(next.plots[1].estimated_rai-first.plots[1].estimated_rai)<.001);
});

function memoryStore() {
  let row=null,rows=trace(field()),writes=0;
  return {settings:async()=>({enabled:true,head_width_m:3}),saved:async()=>structuredClone(row),edges:async()=>({revision:0,excluded_edges:[]}),gps:async()=>rows,
    enabled:async()=>[],plotRevision:async()=>0,save:async(next,rev)=>{if(rev!==(row?.revision||0))return null;row={...row,...structuredClone(next)};writes++;return structuredClone(row);},
    state:()=>structuredClone(row),writes:()=>writes,setRows:value=>{rows=value;}};
}
const command=result=>({plot_id:result.plots[0].id,expected_revision:result.snapshot_revision,request_id:randomUUID()});

test('server seals only reviewed revision; retries are idempotent across process restarts',async()=>{
  const store=memoryStore(),service=createAreaService(store,{analyze:analyzeGpsDay});
  const current=await service.get(9,options.workDate),request=command(current),before=store.writes();
  const locked=await service.lock(9,options.workDate,request);
  assert.equal(locked.snapshot_revision,current.snapshot_revision+1);assert.equal(store.writes(),before+1);
  const restart=createAreaService(store,{analyze:analyzeGpsDay});
  assert.deepEqual((await restart.lock(9,options.workDate,request)).locked_plots,locked.locked_plots);assert.equal(store.writes(),before+1);
  assert.equal((await restart.get(9,options.workDate)).plots[0].state,'completed');
  await assert.rejects(service.lock(9,options.workDate,{...request,request_id:randomUUID()}),e=>e.status===409);
  await assert.rejects(service.lock(9,options.workDate,{...request,plot_id:'another-field'}),e=>e.status===409);
});

test('two simultaneous confirmations create only one seal, and cached analysis cannot undo it',async()=>{
  const store=memoryStore(),service=createAreaService(store,{analyze:analyzeGpsDay});
  const current=await service.get(9,options.workDate);
  const results=await Promise.allSettled([service.lock(9,options.workDate,command(current)),service.lock(9,options.workDate,command(current))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(store.state().result.manual_seals.length,1);
  assert.equal((await service.get(9,options.workDate)).plots[0].state,'completed');
});

test('late in-flight analysis loses its compare-and-swap instead of overwriting a seal',async()=>{
  const store=memoryStore();let now=1000,release,started;
  const begin=new Promise(r=>started=r);
  const service=createAreaService(store,{now:()=>now,analyze:async(rows,o)=>{if(o.previous){started();await new Promise(r=>release=r);}return analyzeGpsDay(rows,o);}});
  const current=await service.get(9,options.workDate);now+=30000;
  store.setRows(trace([...field(),...field(0,60)]));const pending=service.get(9,options.workDate);await begin;
  const locked=await service.lock(9,options.workDate,command(current));release();const late=await pending;
  assert.equal(late.snapshot_revision,locked.snapshot_revision);assert.equal(late.plots[0].state,'completed');
  assert.equal(store.state().result.manual_seals.length,1);
});

test('publication failure preserves the seal and the same command safely retries publication',async()=>{
  const store=memoryStore();let attempts=0;
  const service=createAreaService(store,{analyze:analyzeGpsDay,publish:async()=>{if(++attempts===1)throw Error('temporary');return {editable_ready:true,editable_revision:2};}});
  const request=command(await service.get(9,options.workDate));
  const first=await service.lock(9,options.workDate,request);assert.equal(first.editable_ready,false);assert.equal(first.plots[0].state,'completed');
  const again=await service.lock(9,options.workDate,request);assert.equal(again.editable_ready,true);assert.equal(store.state().result.manual_seals.length,1);
});

test('driver can seal via JSON endpoint; invalid inputs and stale requests cannot change data',async()=>{
  const express=require('express'),app=express(),store=memoryStore(),service=createAreaService(store,{analyze:analyzeGpsDay});
  app.use(express.json());const route=registerGpsArea(app,{store,service});
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const url=`http://127.0.0.1:${server.address().port}/api/gps-area/9/lock`;
  try {
    const request=command(await service.get(9,options.workDate));
    const send=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await send({...request,work_date:'2026-02-30'})).status,400);
    assert.equal((await send({...request,work_date:options.workDate,request_id:'bad'})).status,400);
    assert.equal((await send({...request,work_date:options.workDate})).status,200);
    assert.equal(store.state().result.manual_seals.length,1);
  } finally {route.stop();await new Promise(resolve=>server.close(resolve));}
});

test('a delayed snapshot cannot replace an acknowledged seal or contaminate another day',async()=>{
  const {retainNewestGpsArea}=await import('../harvester-app/src/gps-projection-state.mjs');
  const scope='9/2026-11-09',old={snapshot_revision:3},sealed={snapshot_revision:4,manual_seals:[{}]};
  const state=retainNewestGpsArea({scope,data:old},sealed,scope);
  assert.equal(retainNewestGpsArea(state,old,scope),state);
  assert.equal(retainNewestGpsArea(state,{snapshot_revision:5},scope).data.snapshot_revision,5);
  assert.equal(retainNewestGpsArea(state,old,'10/2026-11-10').data,old);
});

test('sealing an absorbed field retains its saved IDs and queue links through publication',async()=>{
  const turf=require('@turf/turf'),{planAutoPublish}=require('../lib/gps-auto-publish');
  const {gpsFieldAliases}=await import('../harvester-app/src/gps-field-identity.mjs');
  const {gpsDisplayPlots,gpsPlotStatus}=await import('../harvester-app/src/gps-display-plots.mjs');
  let positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const closed=measure(positions);positions.push(...field(0,60));
  const active=measure(positions,closed),oldPlan=await planAutoPublish(closed,{plots_data:[],published_parts:[]});
  const saved=oldPlan.plots.map(p=>({...p,name:'Existing queue',job_id:158})),before=structuredClone(saved);
  const locked=await seal(active),plan=await planAutoPublish(locked,{plots_data:saved,published_parts:oldPlan.handled});
  assert.deepEqual(saved,before);assert.ok(plan.plots.length>0);assert.ok(plan.plots.every(p=>p.id.length<=120 && p.job_id===null));
  const all=[...saved,...plan.plots];
  const geometry=p=>turf.polygon([[...p.points.map(p=>[p.lng,p.lat]),[p.points[0].lng,p.points[0].lat]],...(p.holes||[]).map(h=>[...h.points.map(p=>[p.lng,p.lat]),[h.points[0].lng,h.points[0].lat]])]);
  const display=gpsDisplayPlots(all,all.map(p=>({net:geometry(p)})),{...locked,enabled:true,editable_ready:true,editable_revision:2},9,options.workDate,2);
  assert.equal(display.length,1);assert.equal(gpsPlotStatus(display[0]).key,'locked');
  const replay=measure(positions,locked);assert.ok(replay.plots.every(p=>p.state==='completed'));
  const duplicate=await planAutoPublish(replay,{plots_data:all,published_parts:[...oldPlan.handled,...plan.handled]});
  assert.equal(duplicate.plots.length,0);
  const same=[{id:'a',number:1,manual_seal:'one',edge_keys:['1']},{id:'b',number:2,manual_seal:'one',edge_keys:['2']},{id:'c',number:3,edge_keys:['1','2']}];
  assert.deepEqual(gpsFieldAliases(same),{a:'a',b:'a',c:'c'});
});
