const test=require('node:test'),assert=require('node:assert/strict'),turf=require('@turf/turf');
const groups=import('../harvester-app/src/gps-field-groups.mjs');
const route=import('../harvester-app/src/gps-route-lines.mjs');
const compute=import('../harvester-app/src/gps-map-compute.mjs');
const date='2026-01-02',source='GPS-9-2026-01-02-100';
const part=(n,extra={})=>({id:`auto-${source}@lock-${n}`,vehicle_id:9,work_date:date,name:`แปลงออโต้ 1 · ส่วน ${n}`,area_rai:n,...extra});
const key=p=>`${p.vehicle_id}/${p.work_date}/${p.id}`;
const ring=(x=100,w=.002)=>[{lng:x,lat:15},{lng:x+w,lat:15},{lng:x+w,lat:15.002},{lng:x,lat:15.002}];
test('receipt parts display as one field without changing IDs, links or source data',async()=>{
 const p=[part(1,{job_id:20}),part(2,{job_id:20})],before=JSON.stringify(p);
 const g=(await groups).groupJobPlots(p);assert.equal(g.length,1);assert.equal(g[0].area_rai,3);assert.equal(g[0].name,'แปลงออโต้ 1');assert.deepEqual(g[0].members,p);assert.equal(JSON.stringify(p),before);
});
test('different fields, vehicles, days and manual IDs never group by shared names',async()=>{
 const p=[part(1),part(2),part(3,{id:'auto-GPS-9-2026-01-02-200@lock-1'}),part(4,{vehicle_id:10}),part(5,{work_date:'2026-01-03'}),part(6,{id:'manual-one'}),part(7,{id:'manual-two'})];
 assert.equal((await groups).groupJobPlots(p).length,6);
});
test('origin metadata and legacy receipt IDs identify the same field',async()=>{
 const p=[part(1),part(2,{auto_origin:{plot_id:source,vehicle_id:9,work_date:date}})];assert.equal((await groups).groupJobPlots(p).length,1);
});
test('partly paid fields stay partial and all original payment keys remain valid',async()=>{
 const {groupJobPlots,fieldPaymentStatus}=await groups,p=[part(1),part(2)],g=groupJobPlots(p)[0];
 assert.equal(fieldPaymentStatus(g,new Set()),'unpaid');assert.equal(fieldPaymentStatus(g,new Set([key(p[0])])),'partial');assert.equal(fieldPaymentStatus(g,new Set(p.map(key))),'paid');assert.equal(fieldPaymentStatus(g,new Set(),true),'paid');
});
test('combined previews retain all polygon components and interior holes',async()=>{
 const polygon={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,0]],[[1,1],[2,1],[2,2],[1,1]]]};
 const g=(await groups).groupJobPlots([part(1,{preview_geometry:polygon}),part(2,{preview_geometry:{type:'MultiPolygon',coordinates:[polygon.coordinates]}})])[0];
 assert.equal(g.preview_geometry.coordinates.length,2);assert.equal(g.preview_geometry.coordinates[0].length,2);
});
const rows=Array.from({length:4000},(_,i)=>({id:i,latitude:15+i*.000001,longitude:100,created_at:new Date(Date.UTC(2026,0,2,0,0,i*10)).toISOString()}));
test('4000 GPS points render in two style layers with every valid edge preserved',async()=>{
 const lines=(await route).gpsRouteLines(rows,{harvesting:a=>a.id%2===0});assert.equal(lines.length,2);assert.equal(lines.reduce((n,g)=>n+g.lines.length,0),3999);
});
test('route gaps and reversed timestamps are not joined',async()=>{
 const data=[rows[0],rows[1],{...rows[2],created_at:new Date(Date.parse(rows[1].created_at)+181000).toISOString()},rows[3]];
 assert.equal((await route).gpsRouteLines(data)[0].lines.length,1);
});
test('hidden exclusions, edit selection, restoration and fallback IDs retain their styles',async()=>{
 const {gpsRouteLines}=await route,excluded=new Set(['0>1']);assert.equal(gpsRouteLines(rows.slice(0,3),{excluded})[0].lines.length,1);
 assert.equal(gpsRouteLines(rows.slice(0,2),{excluded,editing:true})[0].style,'excluded');
 assert.equal(gpsRouteLines(rows.slice(0,2),{excluded,editing:true,selected:excluded,restore:true})[0].style,'restore');
 const data=rows.slice(0,2).map(({id,...p})=>p),fallback=data.map(p=>`${p.created_at}|${p.latitude}|${p.longitude}`).join('>');assert.equal(gpsRouteLines(data,{excluded:new Set([fallback])}).length,0);
});
test('off-thread geometry deducts overlapping holes only once and does not change the saved data',async()=>{
 const p={points:ring(),holes:[{points:ring(100.0002,.0005)},{points:ring(100.0004,.0005)}]},before=JSON.stringify(p);
 const g=(await compute).savedPlotGeometry(p),outer=turf.polygon([[...p.points.map(p=>[p.lng,p.lat]),[100,15]]]);
 const holes=p.holes.map(h=>turf.polygon([[...h.points.map(p=>[p.lng,p.lat]),[h.points[0].lng,15]]]));
 const expected=turf.difference(turf.featureCollection([outer,turf.union(turf.featureCollection(holes))]));assert.ok(Math.abs(g.netSqM-turf.area(expected))<.00001);assert.equal(JSON.stringify(p),before);
});
test('invalid coordinates and crossed boundaries are rejected instead of producing false area',async()=>{
 const {savedPlotGeometry}=await compute;assert.throws(()=>savedPlotGeometry({points:[{lat:null,lng:100},...ring().slice(1)]}));const p=ring();assert.throws(()=>savedPlotGeometry({points:[p[0],p[2],p[1],p[3]]}));
});
test('worker projection retains multiple receipt parts as one field with unchanged net area',async()=>{
 const {computeGpsProjection,savedPlotGeometry}=await compute,origin={vehicle_id:9,work_date:date,plot_id:source};
 const saved=[{...part(1),auto_origin:origin,points:ring(100,.001)},{...part(2),auto_origin:origin,points:ring(100.001,.001)}];
 const p=computeGpsProjection({saved,data:null,vehicle:9,date,revision:1});assert.equal(p.plots.length,1);assert.deepEqual(p.plots[0].indices,[0,1]);assert.ok(Math.abs(p.plots[0].areaRai-savedPlotGeometry({points:ring()}).netSqM/1600)<.00001);
});
test('sub-square-metre GPS holes survive publication and display without adding area',async()=>{
 const fs=require('node:fs'),server=fs.readFileSync(require.resolve('../server.js'),'utf8');
 // Exercise the server's actual pure geometry validator without starting the API.
 const code=server.slice(server.indexOf('const plotClip ='),server.indexOf('const loadGpsJobSummary ='));
 const normalize=new Function('turf',code+';return normalizeJobPlots;')(turf);
 const hole=[{lng:100.0005,lat:15.0005},{lng:100.000504,lat:15.0005},{lng:100.000504,lat:15.000504},{lng:100.0005,lat:15.000504}];
 const geometry=turf.polygon([[...ring().map(p=>[p.lng,p.lat]),[100,15]],[...hole.map(p=>[p.lng,p.lat]),[hole[0].lng,hole[0].lat]]]);
 const data={vehicle_id:9,work_date:date,locked_plots:[{id:source+'@lock',plot_id:source,number:1,locked_at:'2026-01-02T12:00:00Z',geometry}]};
 const {planAutoPublish}=require('../lib/gps-auto-publish');
 const plan=await planAutoPublish(data,{plots_data:[],published_parts:[]},normalize);
 assert.equal(plan.plots.length,1);assert.equal(plan.plots[0].holes.length,1);
 const projected=(await compute).savedPlotGeometry(plan.plots[0]);assert.ok(Math.abs(projected.netSqM-turf.area(geometry))<.00001);
 assert.ok(projected.excludedSqM>0&&projected.excludedSqM<1);
 assert.throws(()=>normalize([{points:hole}],9,date),/1 ตร.ม/);
});
