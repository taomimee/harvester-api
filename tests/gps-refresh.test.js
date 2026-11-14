const test=require('node:test'),assert=require('node:assert/strict'),turf=require('@turf/turf');
const {readAreaSnapshot,registerGpsArea}=require('../lib/gps-auto-routes');
const {VERSION}=require('../lib/gps-auto');
const state=import('../harvester-app/src/gps-projection-state.mjs');
const display=import('../harvester-app/src/gps-display-plots.mjs');
const day='2026-11-14',scope=`9/${day}`;
const geometry=turf.polygon([[[100,15],[100.001,15],[100.001,15.001],[100,15.001],[100,15]]]);
const edges=Array.from({length:8},(_,i)=>`${i}>${i+1}`);
const source={enabled:true,version:VERSION,vehicle_id:9,work_date:day,head_width_m:3,route_revision:0,
  estimated_rai:19.7,locked_plots:[{id:'receipt',plot_id:'first',geometry}],
  plots:[{id:'first',number:2,state:'completed',edge_keys:edges,geometry},
    {id:'continued',number:3,state:'working',edge_keys:[...edges,'new'],geometry}]};
function storeFor(result=source) {
  return {settings:async()=>({enabled:true,head_width_m:3}),edges:async()=>({revision:0}),
    saved:async()=>({result,published_parts:['auto-receipt-1'],updated_at:'2026-11-14T06:00:00Z'}),plotRevision:async()=>3,
    gps:async()=>{throw Error('snapshot must not load all GPS points');},save:async()=>{throw Error('snapshot must not write');}};
}

test('saved receipt parts never appear as separate fields before the GPS result arrives',async()=>{
  const {selectGpsProjection,gpsAreaMatches}=await state,{gpsDisplayPlots}=await display;
  const saved=['first','continued'].map(id=>({id,auto_origin:{vehicle_id:9,work_date:day,plot_id:id}}));
  const raw=gpsDisplayPlots(saved,[{net:geometry},{net:geometry}],null,9,day,3);
  assert.equal(raw.length,2,'reproduce the initial unmerged view');
  assert.equal(gpsAreaMatches(null,9,day),false);
  const waiting=selectGpsProjection(null,saved,null,9,day,3);
  assert.deepEqual(waiting.plots,[]);assert.equal(waiting.pending,true);
  const plots=gpsDisplayPlots(saved,[{net:geometry},{net:geometry}],source,9,day,3);
  const complete=selectGpsProjection({scope,saved,source,plots},saved,source,9,day,3);
  assert.equal(complete.plots.length,1);assert.equal(complete.plots[0].name,'แปลงที่ 2');
  assert.equal(complete.pending,false);
});

test('map and header keep the same complete result while the next projection is computing',async()=>{
  const {selectGpsProjection,gpsVisibleTotals}=await state;
  const saved=[],plots=[{areaRai:19.5}],totals={source,estimated_rai:19.5,plot_count:1};
  const next={...source,estimated_rai:22,plots:[...source.plots,{id:'raw-part'}]};
  const current=selectGpsProjection({scope,saved,source,plots},saved,next,9,day,3);
  assert.equal(current.pending,true);assert.equal(current.plots,plots);
  assert.equal(gpsVisibleTotals(totals,next),totals);
  assert.equal(gpsVisibleTotals(null,next),null,'never fall back to raw GPS totals');
});

test('switching vehicle/day or changing saved edits cannot show a previous projection or its totals',async()=>{
  const {selectGpsProjection,gpsVisibleTotals}=await state;
  const saved=[],snapshot={scope,saved,source,plots:[{areaRai:19.5}]};
  for(const data of [{...source,vehicle_id:10},{...source,work_date:'2026-11-13'}]) {
    assert.equal(selectGpsProjection(snapshot,saved,data,data.vehicle_id,data.work_date,3).plots.length,0);
    assert.equal(gpsVisibleTotals({source,estimated_rai:19.5},data),null);
  }
  assert.equal(selectGpsProjection(snapshot,[],source,9,day,4).plots.length,0);
  assert.equal(gpsVisibleTotals({source},{...source,enabled:false}),null);
});

test('a failed refresh retains the last successful map and total instead of losing rai',async()=>{
  const {selectGpsProjection,gpsVisibleTotals}=await state;
  const saved=[],plots=[{areaRai:19.5}],next={...source,estimated_rai:22};
  const view=selectGpsProjection({scope,saved,source,plots,error:'temporary failure'},saved,next,9,day,3);
  assert.equal(view.plots,plots);assert.equal(view.pending,false);assert.equal(view.error,'temporary failure');
  assert.equal(gpsVisibleTotals({source,estimated_rai:19.5},next).estimated_rai,19.5);
});

test('bootstrap reads a complete persisted result without recalculating, publishing, or writing',async()=>{
  const before=JSON.stringify(source),result=await readAreaSnapshot(storeFor(),9,day);
  assert.equal(result.snapshot,true);assert.equal(result.editable_ready,true);assert.equal(result.editable_revision,3);
  assert.equal(result.estimated_rai,19.7);assert.deepEqual(result.plots,source.plots);assert.equal(JSON.stringify(source),before);
});

test('bootstrap respects deleted published fields and never resurrects their locked geometry',async()=>{
  const {gpsDisplayPlots}=await display;
  const done={...source,plots:[{...source.plots[0],state:'completed'}]};
  const result=await readAreaSnapshot(storeFor(done),9,day);
  assert.equal(gpsDisplayPlots([],[],result,9,day,3).length,0);
});

test('missing, unpublished, or incompatible snapshots wait for a live calculation',async()=>{
  for(const changed of [null,{...source,version:'old'},{...source,vehicle_id:10},
    {...source,work_date:'2026-11-13'},{...source,head_width_m:4},{...source,route_revision:1}]) {
    assert.equal(await readAreaSnapshot(storeFor(changed),9,day),null);
  }
  const unpublished=storeFor();unpublished.saved=async()=>({result:source,published_parts:[]});
  assert.equal(await readAreaSnapshot(unpublished,9,day),null);
  const edited=storeFor();edited.edges=async()=>({revision:1});
  assert.equal(await readAreaSnapshot(edited,9,day),null);
  const disabled=storeFor();disabled.settings=async()=>({enabled:false});
  assert.equal((await readAreaSnapshot(disabled,9,day)).enabled,false);
});

test('snapshot HTTP route works while the full-analysis path is busy and validates its scope',async()=>{
  const express=require('express'),app=express(),store=storeFor();
  const route=registerGpsArea(app,{store,service:{get:async()=>{throw Object.assign(Error('busy'),{status:429});},tick:async()=>[]}});
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base=`http://127.0.0.1:${server.address().port}/api/gps-area`;
  try {
    const response=await fetch(`${base}/9?date=${day}&snapshot=1`);
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).snapshot,true);
    assert.equal((await fetch(`${base}/9?date=2026-02-30&snapshot=1`)).status,400);
    store.saved=async()=>null;
    assert.equal((await fetch(`${base}/9?date=${day}&snapshot=1`)).status,204);
  } finally {route.stop();await new Promise(resolve=>server.close(resolve));}
});
