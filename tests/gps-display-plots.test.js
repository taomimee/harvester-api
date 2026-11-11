const test = require('node:test'), assert = require('node:assert/strict'), turf = require('@turf/turf');
const modulePromise = import('../harvester-app/src/gps-display-plots.mjs');
const box = (start, end) => turf.polygon([[[100+start,15],[100+end,15],[100+end,15.002],[100+start,15.002],[100+start,15]]]);
const a = box(0,.001), b = box(.001,.004), full = box(0,.004);
const origin = {vehicle_id:9,work_date:'2026-11-11',plot_id:'same-field',receipt_id:'first'};
const saved = [{id:'copy-a',name:'แปลงออโต้ 1',auto_origin:origin,job_id:42}];
const data = {enabled:true,vehicle_id:9,work_date:origin.work_date,editable_ready:true,editable_revision:1,
  locked_plots:[{id:'first',plot_id:'same-field',geometry:a}],
  plots:[{id:'same-field',number:1,state:'waiting',geometry:full}]};
const render = async (s=saved, geometries=[a], d=data, revision=1) => (await modulePromise).gpsDisplayPlots(s,geometries.map(net=>({net})),d,9,origin.work_date,revision);
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<.00001,`${actual} != ${expected}`);

test('a saved lock and continued harvesting display as one field with the full area',async()=>{
  const before=JSON.stringify({saved,data});
  const groups=await render();
  assert.equal(groups.length,1);assert.deepEqual(groups[0].indices,[0]);
  assert.equal(groups[0].name,'แปลงที่ 1');assert.equal(groups[0].growing,true);
  near(groups[0].areaRai,turf.area(full)/1600);
  near(groups[0].savedRai,turf.area(a)/1600);
  assert.equal(JSON.stringify({saved,data}),before);
});

test('later locks and disconnected receipt pieces stay one logical field and retain all IDs',async()=>{
  const other=box(.005,.006), combined=turf.union(turf.featureCollection([full,other]));
  const s=[...saved,{id:'copy-b',auto_origin:{...origin,receipt_id:'second'}},{id:'copy-c',auto_origin:{...origin,receipt_id:'second'}}];
  const groups=await render(s,[a,b,other],{...data,editable_revision:2,plots:[{...data.plots[0],state:'completed',geometry:combined}]},2);
  assert.equal(groups.length,1);assert.deepEqual(groups[0].indices,[0,1,2]);
  near(groups[0].areaRai,turf.area(combined)/1600);assert.equal(groups[0].growing,false);
});

test('edited holes and custom names are preserved when new work is added',async()=>{
  const hole=box(.0002,.0004), edited=turf.difference(turf.featureCollection([a,hole]));
  const groups=await render([{...saved[0],name:'ขอบที่แก้ไว้'}],[edited]);
  near(groups[0].areaRai,(turf.area(full)-turf.area(hole))/1600);
  assert.equal(groups[0].name,'ขอบที่แก้ไว้');assert.equal(turf.intersect(turf.featureCollection([groups[0].geometry,hole])),null);
});

test('deleted locked parts never reappear; only new work remains visible',async()=>{
  const groups=await render([],[],data,2);assert.equal(groups.length,1);
  near(groups[0].areaRai,turf.area(b)/1600);
  assert.equal((await render([],[],{...data,plots:[{...data.plots[0],state:'completed'}]},2)).length,0);
});

test('newly completed area is visible while the saved snapshot catches up',async()=>{
  const completed={...data,editable_revision:2,locked_plots:[...data.locked_plots,{id:'second',plot_id:'same-field',geometry:b}],plots:[{...data.plots[0],state:'completed'}]};
  const groups=await render(saved,[a],completed,1);
  assert.equal(groups.length,1);near(groups[0].areaRai,turf.area(full)/1600);
});

test('separate identities are never merged merely because their edges touch',async()=>{
  const s=[...saved,{id:'other',auto_origin:{...origin,plot_id:'another-field'}}];
  const groups=await render(s,[a,b],{...data,plots:[]});
  assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.indices),[[0],[1]]);
});

test('unrelated vehicle/day data cannot be combined into this field',async()=>{
  const groups=await render(saved,[a],{...data,vehicle_id:10});
  assert.equal(groups.length,1);near(groups[0].areaRai,turf.area(a)/1600);
  const s=[saved[0],{...saved[0],id:'other',auto_origin:{...origin,work_date:'2026-11-10'}}];
  assert.equal((await render(s,[a,b],null)).length,2);
});

test('field status shows measuring again after a partial lock, then locked only after completion',async()=>{
  const {gpsPlotStatus}=await modulePromise;
  const lockedAt='2026-11-11T04:48:23Z';
  const growing=await render(saved,[a],{...data,plots:[{...data.plots[0],locked_at:lockedAt}]});
  assert.equal(gpsPlotStatus(growing[0]).key,'measuring');
  const finished=await render(saved,[a],{...data,plots:[{...data.plots[0],state:'completed',locked_at:lockedAt}]});
  assert.deepEqual(gpsPlotStatus(finished[0]),{key:'locked',label:'🔒 ล็อกแล้ว',lockedAt});
  const loading=await render(saved,[a],null);
  assert.equal(gpsPlotStatus(loading[0]).key,'checking');
  const manual=await render([{id:'manual',name:'วาดเอง'}],[a],null);
  assert.equal(gpsPlotStatus(manual[0]).key,'saved');
});
