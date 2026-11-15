const {test}=require('node:test');
const assert=require('node:assert/strict');
const turf=require('@turf/turf');
const modules=Promise.all([import('../harvester-app/src/home-harvest.mjs'),import('../harvester-app/src/gps-map-compute.mjs')]);
const date='2026-11-15', vehicles=[{id:9}];
const ready=(rai=42.4)=>({date,state:'ready',rai,count:3,working:true});

test('home uses GPS without double counting recorded work, and totals multiple vehicles once',async()=>{
  const [{homeHarvestSummary:s}]=await modules;
  assert.equal(s(vehicles,{9:ready()},date,0).rai,42.4);
  assert.equal(s(vehicles,{9:ready()},date,40).rai,42.4);
  const combined=s([{id:9},{id:10},{id:9}],{9:ready(10),10:ready(20)},date,30);
  assert.equal(combined.rai,30);assert.equal(combined.count,6);assert.equal(combined.recorded,30);
});
test('unknown, failed and previous-day GPS cannot look like zero today',async()=>{
  const [{homeHarvestSummary:s}]=await modules;
  assert.equal(s(vehicles,{},date).source,'pending');
  assert.equal(s(vehicles,{9:{date,state:'error'}},date).source,'pending');
  assert.equal(s(vehicles,{9:{...ready(),date:'2026-11-14'}},date).source,'pending');
  assert.equal(s(vehicles,{9:{date,state:'disabled'}},date,5).rai,5);
  assert.equal(s(vehicles,{9:{date,state:'empty'}},date).source,'recorded');
  const partial=s([{id:9},{id:10}],{9:{...ready(),stale:true}},date);
  assert.equal(partial.rai,42.4);assert.equal(partial.pending,2);
});
test('Thai work date changes at Bangkok midnight regardless of browser timezone',async()=>{
  const [{thaiWorkDate}]=await modules;
  assert.equal(thaiWorkDate(Date.parse('2026-11-14T16:59:59Z')),'2026-11-14');
  assert.equal(thaiWorkDate(Date.parse('2026-11-14T17:00:00Z')),'2026-11-15');
});

const response=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>data});
function fixture(){
  const geometry=turf.polygon([[[100,15],[100.001,15],[100.001,15.001],[100,15.001],[100,15]]]);
  const points=geometry.geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>({lng,lat}));
  const plot={id:'field',number:1,state:'completed',geometry,locked_at:date+'T05:00:00Z'};
  const data={enabled:true,snapshot:true,vehicle_id:9,work_date:date,snapshot_revision:7,editable_ready:true,editable_revision:2,observed_at:date+'T05:00:00Z',plots:[plot],locked_plots:[{...plot,id:'receipt',plot_id:'field'}]};
  const saved={revision:2,plots_data:[{id:'copy',points,holes:[{points:[{lng:100.0002,lat:15.0002},{lng:100.0004,lat:15.0002},{lng:100.0004,lat:15.0004},{lng:100.0002,lat:15.0004}]}],auto_origin:{vehicle_id:9,work_date:date,plot_id:'field',receipt_id:'receipt'}}]};
  return {data,saved};
}
test('home area matches map projection including edited holes; snapshot path never downloads raw GPS',async()=>{
  const [{loadHomeVehicle}, {computeGpsProjection}]=await modules;
  const {data,saved}=fixture(),calls=[];
  const input={vehicle:9,date,base:'/api',project:computeGpsProjection,fetcher:async url=>{calls.push(url);return response(url.includes('/gps-area/')?data:saved)}};
  const result=await loadHomeVehicle(input);
  const map=computeGpsProjection({saved:saved.plots_data,data,vehicle:9,date,revision:saved.revision});
  assert.equal(result.rai,map.plots.reduce((s,p)=>s+p.areaRai,0));assert.equal(result.count,map.plots.length);
  assert.deepEqual(calls,[`/api/gps-area/9?date=${date}&snapshot=1`,`/api/plots-snapshot/9?date=${date}`]);
  const again=await loadHomeVehicle({...input,previous:result,project:()=>{throw Error('Unchanged geometry must be reused')}});
  assert.equal(again.rai,result.rai);
});
test('missing snapshot falls back to live result; working work appears before a round is closed',async()=>{
  const [{loadHomeVehicle},{computeGpsProjection}]=await modules;
  const {data}=fixture();data.plots[0].state='working';data.locked_plots=[];data.editable_ready=false;
  const calls=[];const row=await loadHomeVehicle({vehicle:9,date,base:'/api',project:computeGpsProjection,fetcher:async url=>{
    calls.push(url);return url.endsWith('snapshot=1')?response(null,204):response(url.includes('/gps-area/')?data:{plots_data:[],revision:0});
  }});
  assert.ok(row.rai>0);assert.equal(row.working,true);assert.equal(calls.length,3);
});
test('wrong scope, failed responses and older saved boundaries reject rather than zero',async()=>{
  const [{loadHomeVehicle}]=await modules;const {data,saved}=fixture();
  const read=(d,s,status=200)=>loadHomeVehicle({vehicle:9,date,base:'/api',project:()=>{throw Error('Must not project')},fetcher:async url=>response(url.includes('/gps-area/')?d:s,status)});
  await assert.rejects(read({...data,work_date:'2026-11-14'},saved),/SCOPE/);
  await assert.rejects(read(data,saved,503),/UNAVAILABLE/);
  await assert.rejects(read(data,{...saved,revision:1}),/PENDING/);
});
