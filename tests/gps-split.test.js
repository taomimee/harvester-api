const {test}=require('node:test');
const assert=require('node:assert/strict');
const turf=require('@turf/turf');
const {createSplitService}=require('../lib/gps-split-routes');
const {planAutoPublish}=require('../lib/gps-auto-publish');
const {gpsPlotGroupKey}=require('../lib/field-trips');
const modules=Promise.all([import('../harvester-app/src/gps-split.mjs'),import('../harvester-app/src/gps-map-compute.mjs'),import('../harvester-app/src/gps-display-plots.mjs'),import('../harvester-app/src/gps-auto-import.mjs')]);
const date='2026-11-16',requestId='11111111-1111-4111-8111-111111111111';
function fixture(){
  const points=[{lng:100,lat:15},{lng:100.004,lat:15},{lng:100.004,lat:15.002},{lng:100,lat:15.002}];
  const hole=[{lng:100.001,lat:15.0004},{lng:100.002,lat:15.0004},{lng:100.002,lat:15.0015},{lng:100.001,lat:15.0015}];
  const shape=turf.polygon([[...points,points[0]].map(p=>[p.lng,p.lat]),[...hole,hole[0]].map(p=>[p.lng,p.lat])]);
  const plot={id:'auto-receipt-1',job_id:null,points,holes:[{id:'hole',points:hole}],auto_origin:{vehicle_id:9,work_date:date,plot_id:'field',receipt_id:'receipt',locked_at:date+'T03:00:00Z'}};
  const data={enabled:true,vehicle_id:9,work_date:date,editable_ready:true,editable_revision:1,plots:[{id:'field',number:1,state:'completed',geometry:shape,locked_at:date+'T03:00:00Z',edge_keys:['a','b','c','d','e','f']}],locked_plots:[{id:'receipt',plot_id:'field',number:1,geometry:shape,locked_at:date+'T03:00:00Z'}]};
  const input={plots:[plot],ids:[plot.id],line:[{lng:99.999,lat:15.001},{lng:100.005,lat:15.001}],names:['Upper','Lower'],requestId,vehicle:9,date,createdAt:date+'T05:00:00Z'};
  return {input,data};
}
test('split keeps the net area, holes and unrelated plots without overlaps or lost strips',async()=>{
  const [{buildSplitPlan},{savedPlotGeometry}]=await modules;const {input}=fixture();
  const unrelated={id:'other',points:[{lng:101,lat:15},{lng:101.001,lat:15},{lng:101.001,lat:15.001},{lng:101,lat:15.001}]};
  input.plots.push(unrelated);const before=structuredClone(input.plots),result=buildSplitPlan(input);
  assert.deepEqual(input.plots,before);assert.deepEqual(result.plots.find(p=>p.id==='other'),unrelated);
  const total=result.created.reduce((sum,p)=>sum+savedPlotGeometry(p).netSqM,0);
  assert.ok(Math.abs(total-savedPlotGeometry(input.plots[0]).netSqM)<.01);
  assert.equal(turf.intersect(turf.featureCollection(result.parts)),null);
  assert.equal(turf.booleanPointInPolygon([100.0015,15.001],turf.union(turf.featureCollection(result.parts))),false);
});
test('bad lines, non-crossing lines and sub-metre scraps cannot save',async()=>{
  const [{buildSplitPlan}]=await modules;const {input}=fixture();
  for(const line of [[],[{lat:0,lng:0},{lat:0,lng:0}],[{lat:NaN,lng:100},{lat:15,lng:101}],[{lat:16,lng:99},{lat:16,lng:101}]])assert.throws(()=>buildSplitPlan({...input,line}));
  assert.throws(()=>buildSplitPlan({...input,line:[{lng:100.003999999,lat:14},{lng:100.003999999,lat:16}]}));
});
test('split identities remain separate after reload, group in queues/trips and preserve edits while publication is pending',async()=>{
  const [{buildSplitPlan},{computeGpsProjection},{gpsPlotStatus}]=await modules;const {input,data}=fixture();
  const result=buildSplitPlan(input);
  for(const ready of [true,false]){
    const projection=computeGpsProjection({saved:result.plots,data:{...data,editable_ready:ready},vehicle:9,date,revision:2});
    assert.equal(projection.plots.length,2);assert.equal(new Set(projection.plots.map(p=>p.sourceId)).size,2);
    assert.ok(projection.plots.every(p=>gpsPlotStatus(p).key==='locked'));
    assert.ok(Math.abs(projection.plots.reduce((n,p)=>n+p.areaRai,0)-result.totalRai)<.001);
  }
  assert.equal(new Set(result.plots.map(p=>gpsPlotGroupKey(p,9,date,{field:'old'}))).size,2);
});
test('old imports and automatic publication cannot recreate the parent after splitting',async()=>{
  const [{buildSplitPlan},,,{prepareAutoPlotUse}]=await modules;const {input,data}=fixture();const result=buildSplitPlan(input);
  const again=prepareAutoPlotUse(data,'field',result.plots,9,date);
  assert.equal(again.added.length,0);assert.equal(again.plots.length,result.plots.length);
  const publication=await planAutoPublish(data,{plots_data:result.plots,published_parts:[]});
  assert.equal(publication.plots.length,0);
});
test('continued adjacent work stays separate and does not merge the two split fields',async()=>{
  const [{buildSplitPlan},{computeGpsProjection}]=await modules;const {input,data}=fixture();const result=buildSplitPlan(input);
  const extra=turf.polygon([[[100.004,15],[100.005,15],[100.005,15.002],[100.004,15.002],[100.004,15]]]);
  const grown={...data,editable_ready:false,plots:[{...data.plots[0],state:'working',geometry:turf.union(turf.featureCollection([data.plots[0].geometry,extra]))}]};
  const projection=computeGpsProjection({saved:result.plots,data:grown,vehicle:9,date,revision:2});
  assert.equal(projection.plots.length,3);assert.equal(projection.plots.filter(p=>p.growing).length,1);
});
function serviceFixture(){
  const {input,data}=fixture();let snapshot={plots_data:structuredClone(input.plots),revision:1},writes=0,claimed=false;
  const store={snapshot:async()=>structuredClone(snapshot),area:async()=>data,claimed:async()=>claimed,
    save:async(_v,_d,rev,plots)=>{if(rev!==snapshot.revision)throw Error('GPS_REVISION_CONFLICT');writes++;snapshot={plots_data:structuredClone(plots),revision:rev+1};return structuredClone(snapshot);}};
  const body={vehicle_id:9,work_date:date,expected_revision:1,source_ids:input.ids,line:input.line,names:input.names,request_id:requestId};
  return {body,store,data,split:createSplitService(store,p=>p,()=>input.createdAt),get:()=>snapshot,writes:()=>writes,claim:()=>{claimed=true;}};
}
test('retry and concurrent identical commands split once; different commands cannot replace newer edits',async()=>{
  const f=serviceFixture();const results=await Promise.all([f.split(f.body),f.split(f.body)]);
  assert.equal(f.writes(),1);assert.equal(results[0].revision,2);assert.equal(results[1].revision,2);
  assert.equal((await f.split(f.body)).repeated,true);
  await assert.rejects(f.split({...f.body,names:['changed','Lower']}),e=>e.status===409);
  await assert.rejects(f.split({...f.body,request_id:'22222222-2222-4222-8222-222222222222'}),e=>e.status===409);
});
test('linked work, claimed trips, active measurement and incomplete selections are rejected without writes',async()=>{
  let f=serviceFixture();f.get().plots_data[0].job_id=42;await assert.rejects(f.split(f.body),e=>e.status===409);assert.equal(f.writes(),0);
  f=serviceFixture();f.claim();await assert.rejects(f.split(f.body),e=>e.status===409);assert.equal(f.writes(),0);
  f=serviceFixture();f.data.plots[0].state='working';await assert.rejects(f.split(f.body),e=>e.status===409);assert.equal(f.writes(),0);
  f=serviceFixture();f.get().plots_data.push({...f.get().plots_data[0],id:'another-part'});await assert.rejects(f.split(f.body),e=>e.status===409);assert.equal(f.writes(),0);
});
