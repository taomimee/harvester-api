'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeGpsDay}=require('../lib/gps-auto');
const {createAreaService,thaiDay,validDay,secureEqual}=require('../lib/gps-auto-routes');
function trace(positions,{start=Date.parse('2026-11-09T01:00:00Z'),step=6,offset=0}={}) {
  return positions.map(([x,y],i)=>({id:i+1+offset,latitude:14+y/111195,longitude:100+x/(111195*Math.cos(14*Math.PI/180)),created_at:new Date(start+i*step*1000).toISOString(),is_harvesting:true}));
}
function field(x=0,y=0) {
  const p=[];
  for(let row=0;row<20;row++)for(let column=0;column<=20;column++)p.push([x+(row%2?20-column:column)*5,y+row*3]);
  return p;
}
const options={vehicleId:9,workDate:'2026-11-09',headWidth:3};
const measure=rows=>analyzeGpsDay(rows,options);
test('parallel harvesting measures footprint; stationary vehicle does not finish the job',()=>{
  const rows=trace(field()),result=measure(rows);
  assert.equal(result.plots.length,1);
  assert.ok(result.estimated_rai>3 && result.estimated_rai<4.3,result.estimated_rai);
  assert.equal(result.plots[0].state,'working');
  const stopped=rows.concat(trace(Array.from({length:100},()=>[0,57]),{start:Date.parse(rows.at(-1).created_at)+30000,step:30,offset:1000}));
  assert.equal(measure(stopped).plots[0].state,'waiting');
});
test('slow road and repeated road trips are not harvested area even with the old flag true',()=>{
  const road=[];for(let lane=0;lane<3;lane++)for(let i=0;i<=200;i++)road.push([(lane%2?200-i:i)*5,lane*3]);
  assert.equal(measure(trace(road)).estimated_rai,0);
  assert.equal(measure(trace(Array.from({length:500},(_,i)=>[i*5,0]))).estimated_rai,0);
});
test('GPS drift, large jumps, absent and invalid points do not create fields',()=>{
  assert.equal(measure(trace(Array.from({length:200},(_,i)=>[Math.sin(i)*3,Math.cos(i)*3]))).estimated_rai,0);
  assert.equal(measure(trace(Array.from({length:100},(_,i)=>[i%2*10000,0]))).estimated_rai,0);
  assert.equal(measure([{latitude:null,longitude:null,created_at:'bad'}]).estimated_rai,0);
});
test('overlapping repeat passes count once',()=>{
  const positions=field(),once=measure(trace(positions)),twice=measure(trace([...positions,...positions]));
  assert.ok(Math.abs(once.estimated_rai-twice.estimated_rai)<once.estimated_rai*.02);
});
test('a gap alone never closes a plot or joins a route across missing GPS',()=>{
  const rows=trace(field()),at=Date.parse(rows.at(-1).created_at);
  const gap=trace([[1000,0],[1005,0],[1010,0]],{start:at+3600000,offset:1000});
  assert.notEqual(measure([...rows,...gap]).plots[0].state,'completed');
  const allGaps=trace(field(),{step:300});assert.equal(measure(allGaps).estimated_rai,0);
});
test('sustained observed departure closes; harvesting on return expands same footprint',()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const result=measure(trace(positions));assert.equal(result.plots[0].state,'completed');
  assert.ok(result.estimated_rai<4.3,'departure road adds no area');
  const returned=measure(trace([...positions,...field()]));
  assert.equal(returned.plots.length,1);assert.equal(returned.plots[0].state,'working');
  assert.ok(Math.abs(result.estimated_rai-returned.estimated_rai)<.1);
});
test('manual excluded edges are respected and separate fields remain separate',()=>{
  const a=trace(field()),all=a.slice(1).map((b,i)=>`${a[i].id}>${b.id}`);
  assert.equal(analyzeGpsDay(a,{...options,excludedEdges:all}).estimated_rai,0);
  const b=trace(field(600,0),{offset:1000,start:Date.parse(a.at(-1).created_at)+300000});
  assert.equal(measure([...a,...b]).plots.length,2);
});
test('automatic locks survive refresh, a restart and driving back through the field',()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const rows=trace(positions),closed=measure(rows);
  assert.equal(closed.locked_count,1);assert.equal(closed.locked_plots.length,1);
  assert.ok(closed.plots[0].locked_at);assert.equal(closed.plots[0].number,1);
  const reloaded=analyzeGpsDay(rows,{...options,previous:JSON.parse(JSON.stringify(closed))});
  assert.deepEqual(reloaded.locked_plots,closed.locked_plots);
  const returned=analyzeGpsDay(trace([...positions,...field()]),{...options,previous:reloaded});
  assert.deepEqual(returned.locked_plots,closed.locked_plots);
  assert.equal(returned.locked_count,1);assert.equal(returned.plots.length,1);
  assert.ok(Math.abs(returned.estimated_rai-closed.estimated_rai)<.02);
});
test('a brief trip away and return does not lock a field',()=>{
  const rows=trace(field()),start=Date.parse(rows.at(-1).created_at)+6000;
  const brief=trace([[40,57],[80,57],[120,57],[160,57],[200,57],[160,57],[120,57],[80,57],[40,57],[0,57]],{start,offset:1000,step:30});
  assert.equal(measure([...rows,...brief]).locked_count,0);
});
test('new fields get stable numbers while locked boundaries and rai stay unchanged',()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const first=measure(trace(positions));
  const second=analyzeGpsDay(trace([...positions,...field(600,0)]),{...options,previous:first});
  assert.deepEqual(second.locked_plots,first.locked_plots);
  assert.equal(second.locked_count,1);assert.equal(second.plots.length,2);
  assert.deepEqual(second.plots.map(p=>p.number),[1,2]);
  const exit=[...positions,...field(600,0)];for(let i=1;i<=120;i++)exit.push([600+i*5,57]);
  const third=analyzeGpsDay(trace(exit),{...options,previous:second});
  assert.equal(third.locked_count,2);assert.equal(third.locked_plots.length,2);
  assert.deepEqual(third.locked_plots[0],first.locked_plots[0]);
  assert.ok(Math.abs(third.estimated_rai-third.completed_rai)<.000001);
});
test('harvesting additional land on return adds only new area to the original field',()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const first=measure(trace(positions));
  const more=[...positions,...field(60,0)];
  const active=analyzeGpsDay(trace(more),{...options,previous:first});
  assert.deepEqual(active.locked_plots,first.locked_plots);
  assert.equal(active.plots.length,1);assert.equal(active.plots[0].number,1);
  assert.ok(active.working_rai>1 && active.working_rai<3);
  for(let i=1;i<=120;i++)more.push([60+i*5,57]);
  const done=analyzeGpsDay(trace(more),{...options,previous:active});
  assert.equal(done.locked_count,1);assert.equal(done.locked_plots.length,2);
  assert.deepEqual(done.locked_plots[0],first.locked_plots[0]);
  assert.ok(done.estimated_rai>5 && done.estimated_rai<7);
});
test('explicit route corrections can remove a mistaken lock, unrelated scopes cannot import it',()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const rows=trace(positions),closed=measure(rows);
  const excluded=rows.slice(1).map((b,i)=>`${rows[i].id}>${b.id}`);
  const corrected=analyzeGpsDay(rows,{...options,previous:closed,excludedEdges:excluded,routeRevision:1});
  assert.equal(corrected.locked_count,0);assert.equal(corrected.estimated_rai,0);
  assert.equal(analyzeGpsDay([],{...options,vehicleId:10,previous:closed}).locked_count,0);
  assert.equal(analyzeGpsDay([],{...options,workDate:'2026-11-10',previous:closed}).locked_count,0);
});
function memoryStore(rows) {
  const saved=new Map();let writes=0;
  return {settings:async()=>({enabled:true,head_width_m:3}),saved:async(v,d)=>saved.get(`${v}/${d}`)||null,edges:async()=>({excluded_edges:[],revision:0}),gps:async(v,d)=>rows.filter(p=>thaiDay(Date.parse(p.created_at))===d),
    enabled:async()=>[{vehicle_id:9}],save:async(row,rev)=>{const key=`${row.vehicle_id}/${row.work_date}`;assert.equal(rev,saved.get(key)?.revision||0);saved.set(key,row);writes++;return row;},
    state:()=>({saved:saved.get('9/2026-11-09'),writes}),setRows:value=>{rows=value;}};
}
test('background processing persists without any browser request and repeated runs are idempotent',async()=>{
  const store=memoryStore(trace(field()));let now=Date.parse('2026-11-09T08:00:00Z'),calls=0;
  const service=createAreaService(store,{now:()=>now,analyze:async(rows,o)=>{calls++;return analyzeGpsDay(rows,o);}});
  await service.tick();now+=30000;await service.tick();
  assert.equal(calls,1);assert.equal(store.state().writes,1);
  const archived=store.state().saved.result;store.setRows([]);now+=30000;
  assert.deepEqual((await service.get(9,'2026-11-09')).plots,archived.plots);
  assert.equal(store.state().writes,1);
});
test('background lock persists through a service restart and expired tracker history',async()=>{
  const positions=field();for(let i=1;i<=120;i++)positions.push([i*5,57]);
  const store=memoryStore(trace(positions)),now=()=>Date.parse('2026-11-09T08:00:00Z');
  const service=createAreaService(store,{now});
  await service.tick();const first=store.state().saved.result;
  assert.equal(first.locked_count,1);
  store.setRows(trace([...positions,...field(600,0)]));
  const restarted=createAreaService(store,{now});
  await restarted.tick();const second=store.state().saved.result;
  assert.deepEqual(second.locked_plots,first.locked_plots);
  assert.equal(second.plots.length,2);
  store.setRows([]);
  const expired=await createAreaService(store,{now}).get(9,'2026-11-09');
  assert.equal(expired.archived,true);assert.deepEqual(expired.locked_plots,first.locked_plots);
});
test('concurrent screen requests share one calculation and errors do not become zero rai',async()=>{
  const store=memoryStore(trace(field()));let calls=0;
  const service=createAreaService(store,{analyze:async(rows,o)=>{calls++;return analyzeGpsDay(rows,o);}});
  const [a,b]=await Promise.all([service.get(9,'2026-11-09'),service.get(9,'2026-11-09')]);
  assert.equal(calls,1);assert.deepEqual(a,b);
  store.gps=async()=>{throw new Error('database unavailable');};
  await assert.rejects(createAreaService(store).get(9,'2026-11-09'));
});
test('scope validation, Thai midnight and worker token checks',()=>{
  assert.equal(thaiDay(Date.parse('2026-11-08T17:00:00Z')),'2026-11-09');
  assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2026-11-09'),true);
  assert.equal(secureEqual('secret','secret'),true);assert.equal(secureEqual('secret','wrong!'),false);
  assert.equal(secureEqual('é','x'),false);assert.equal(secureEqual(undefined,'x'),false);
});
test('HTTP endpoint executes the worker, validates scope and protects scheduled runs',async()=>{
  const express=require('express'),{registerGpsArea}=require('../lib/gps-auto-routes');
  const store=memoryStore(trace(field()));store.token=async()=>'private-test-token';
  const service=createAreaService(store,{now:()=>Date.parse('2026-11-09T08:00:00Z')});
  const app=express(),handler=registerGpsArea(app,{store,service});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/gps-area-worker`,{method:'POST'})).status,403);
    assert.equal((await fetch(`${url}/api/gps-area/9?date=2026-02-30`)).status,400);
    assert.equal((await fetch(`${url}/api/gps-area-worker`,{method:'POST',headers:{'x-gps-worker-token':'private-test-token'}})).status,200);
    const response=await fetch(`${url}/api/gps-area/9?date=2026-11-09`);
    assert.equal(response.status,200);const data=await response.json();assert.ok(data.estimated_rai>3);assert.equal(data.vehicle_id,9);
    assert.equal(store.state().writes,1);assert.ok(!('token' in data));
  } finally {handler.stop();await new Promise(resolve=>server.close(resolve));}
});
