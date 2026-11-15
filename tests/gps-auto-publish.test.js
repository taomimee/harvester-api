const test=require('node:test'),assert=require('node:assert/strict'),turf=require('@turf/turf');
const {createFixture}=require('./field-fixture');
const {createAutoPublisher,planAutoPublish}=require('../lib/gps-auto-publish');
const ring=(x=100,w=.002)=>[[x,15],[x+w,15],[x+w,15.002],[x,15.002],[x,15]];
const receipt={id:'field@2026-11-10T04:00:00Z',plot_id:'field',number:1,locked_at:'2026-11-10T04:00:00Z',geometry:turf.polygon([ring(),ring(100.0005,.0002).map(([x,y])=>[x,15+(y-15)*.1])])};
const result={vehicle_id:1,work_date:'2026-11-10',locked_plots:[receipt]};
const geometry=p=>{const close=pts=>[...pts.map(p=>[p.lng,p.lat]),[pts[0].lng,pts[0].lat]];return turf.polygon([close(p.points),...p.holes.map(h=>close(h.points))]);};
test('automatic copies are atomic, idempotent, retain edits and never return after deletion',async t=>{
  const {db}=await createFixture();t.after(()=>db.close());
  await db.exec("insert into gps_area_daily(vehicle_id,work_date,result) values(1,'2026-11-10','{}');grant select,insert,update on harvest_plots,gps_area_daily to service_role;grant usage,select on sequence harvest_plots_id_seq to service_role;");
  const before=(await db.query('select to_jsonb(t) x from transactions t')).rows;
  const store={snapshot:async()=>{const p=(await db.query('select * from harvest_plots order by id desc limit 1')).rows[0];return{plots_data:p?.plots_data||[],revision:p?.revision||0,published_parts:(await db.query('select published_parts from gps_area_daily')).rows[0].published_parts};},
    append:async(v,d,r,p,h)=>(await db.query('select publish_gps_area_plots($1,$2,$3,$4,$5) result',[v,d,r,p,h])).rows[0].result};
  const publish=createAutoPublisher(store);
  await db.exec('set role service_role');
  await Promise.all([publish(result),publish(result)]);
  const first=await store.snapshot();assert.equal(first.plots_data.length,1);assert.equal(first.revision,1);
  assert.equal(first.plots_data[0].holes.length,1);
  assert.ok(Math.abs(turf.area(geometry(first.plots_data[0]))-turf.area(receipt.geometry))<.01);
  const modified=structuredClone(first.plots_data);modified[0].name='edited';modified[0].job_id=42;modified[0].points[0].lng+=.0001;
  await db.query('update harvest_plots set plots_data=$1,revision=2',[modified]);
  await publish(result);assert.deepEqual((await store.snapshot()).plots_data,modified);
  await db.exec("update harvest_plots set plots_data='[]',revision=3");await publish(result);
  assert.deepEqual((await store.snapshot()).plots_data,[]);
  await assert.rejects(store.append(1,result.work_date,0,[],['new']),/GPS_REVISION_CONFLICT/);
  await assert.rejects(store.append(1,result.work_date,3,[{source:'GPS_LOCK',job_id:99}],['new']),/UNASSIGNED/);
  assert.deepEqual((await db.query('select to_jsonb(t) x from transactions t')).rows,before);
  await db.exec('reset role');
  const permissions=(await db.query("select has_function_privilege('anon','public.publish_gps_area_plots(bigint,date,integer,jsonb,jsonb)','execute') a,has_function_privilege('authenticated','public.publish_gps_area_plots(bigint,date,integer,jsonb,jsonb)','execute') b")).rows[0];assert.deepEqual(permissions,{a:false,b:false});
});
test('already saved manual areas are subtracted instead of duplicated',async()=>{
  const old={id:'manual',points:ring(99.999,.002).slice(0,-1).map(([lng,lat])=>({lng,lat})),holes:[],job_id:42};
  const plan=await planAutoPublish(result,{plots_data:[old],revision:5,published_parts:[]});
  assert.equal(plan.plots.length,1);assert.equal(plan.plots[0].job_id,null);
  assert.equal(turf.intersect(turf.featureCollection([geometry(old),geometry(plan.plots[0])])),null);
  assert.ok(turf.area(geometry(plan.plots[0]))<turf.area(receipt.geometry));
  assert.ok(plan.plots[0].auto_origin.source_part_id);assert.equal(old.job_id,42);
  const fullyCovered=await planAutoPublish(result,{plots_data:[...plan.plots,old],revision:6,published_parts:[]});
  assert.equal(fullyCovered.plots.length,0);assert.equal(fullyCovered.handled.length,1);
});
test('working plots are not published and small fragments cannot block usable parts',async()=>{
  assert.equal((await planAutoPublish({...result,locked_plots:[],plots:[receipt]},{plots_data:[],published_parts:[]})).plots.length,0);
  const tiny=turf.polygon([ring(100,.000001).map(([x,y])=>[x,15+(y-15)*.0005])]);
  const mixed={...result,locked_plots:[{...receipt,geometry:turf.multiPolygon([tiny.geometry.coordinates,receipt.geometry.geometry.coordinates])}]};
  const plan=await planAutoPublish(mixed,{plots_data:[],published_parts:[]});assert.equal(plan.plots.length,1);assert.equal(plan.handled.length,2);
  const onlyTiny=await planAutoPublish({...result,locked_plots:[{...receipt,geometry:tiny}]},{plots_data:[],published_parts:[]});assert.equal(onlyTiny.plots.length,0);assert.equal(onlyTiny.handled.length,1);
});
test('mostly matching manual boundaries retain their corrections rather than receiving GPS edge fragments',async()=>{
  const old={id:'manual',points:ring(100,.0019).slice(0,-1).map(([lng,lat])=>({lng,lat})),holes:[]};
  const plan=await planAutoPublish(result,{plots_data:[old],published_parts:[]});
  assert.equal(plan.plots.length,0);assert.equal(plan.handled.length,1);
});

test('generated pinched rings publish without changing area, saved edits, or part identity',async()=>{
  const {cleanGeneratedGeometry}=require('../lib/gps-auto-publish');
  const pinched=turf.polygon([[[100,15],[100.001,15],[100.001,15.001],[100.0005,15.001],[100.0005,15.0015],[100.0005,15.001],[100,15.001],[100,15]],
    [[100.0001,15.0001],[100.0002,15.0001],[100.0002,15.0002],[100.0001,15.0002],[100.0001,15.0001]]]);
  const before=JSON.stringify(pinched);assert.ok(turf.kinks(pinched).features.length);
  const fixed=cleanGeneratedGeometry(pinched);
  assert.equal(turf.kinks(fixed).features.length,0);assert.equal(fixed.geometry.coordinates.length,2);
  assert.ok(Math.abs(turf.area(fixed)-turf.area(pinched))<.01);assert.equal(JSON.stringify(pinched),before);
  const plan=await planAutoPublish({...result,locked_plots:[{...receipt,geometry:pinched}]},{plots_data:[],published_parts:[]});
  assert.equal(plan.plots.length,1);assert.equal(plan.plots[0].id,`auto-${receipt.id}-1`);
  assert.equal(turf.kinks(geometry(plan.plots[0])).features.length,0);
  const unchanged=turf.polygon([ring()]);assert.equal(cleanGeneratedGeometry(unchanged),unchanged);
});

test('a true crossed boundary is rejected when repairing it would change its area',()=>{
  const {cleanGeneratedGeometry}=require('../lib/gps-auto-publish');
  const bowtie=turf.polygon([[[100,15],[100.002,15.002],[100,15.002],[100.002,15],[100,15]]]);
  assert.throws(()=>cleanGeneratedGeometry(bowtie),/GPS_GENERATED_BOUNDARY_NEEDS_REVIEW/);
});

test('two generated lobes touching at one point retain unique storage IDs and a single field identity',async()=>{
  const pinched=turf.polygon([[[100,15],[100.001,15],[100.001,15.001],[100.002,15.001],[100.002,15.002],[100.001,15.002],[100.001,15.001],[100,15.001],[100,15]]]);
  const plan=await planAutoPublish({...result,locked_plots:[{...receipt,geometry:pinched}]},{plots_data:[],published_parts:[]});
  assert.equal(plan.plots.length,2);assert.equal(new Set(plan.plots.map(p=>p.id)).size,2);
  assert.ok(plan.plots.every(p=>p.auto_origin.plot_id===receipt.plot_id && turf.kinks(geometry(p)).features.length===0));
  assert.ok(Math.abs(plan.plots.reduce((sum,p)=>sum+turf.area(geometry(p)),0)-turf.area(pinched))<.01);
});
