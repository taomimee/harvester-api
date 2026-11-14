const test=require('node:test'),assert=require('node:assert/strict'),turf=require('@turf/turf');
const identity=import('../harvester-app/src/gps-field-identity.mjs');
const display=import('../harvester-app/src/gps-display-plots.mjs');
const {gpsPlotGroupKey}=require('../lib/field-trips');
const {createGpsFieldIdentityReader}=require('../lib/gps-field-identities');
const edges=Array.from({length:86},(_,i)=>`${i}>${i+1}`);
const plots=[{id:'other',number:1,edge_keys:['x','y']},{id:'first',number:2,edge_keys:edges},{id:'continued',number:3,edge_keys:[...edges,...Array.from({length:683},(_,i)=>`new${i}`)]}];
const box=(x1,x2)=>turf.polygon([[[100+x1,15],[100+x2,15],[100+x2,15.001],[100+x1,15.001],[100+x1,15]]]);
const a=box(0,.001),b=box(.001,.003),full=turf.union(turf.featureCollection([a,b]));
const day='2026-11-14',at='2026-11-14T03:00:00Z';
const origin=id=>({vehicle_id:9,work_date:day,plot_id:id,receipt_id:id});
const saved=[{id:'saved-a',name:'แปลงออโต้ 2',job_id:10,auto_origin:origin('first')},{id:'saved-b',name:'แปลงออโต้ 3',job_id:10,auto_origin:origin('continued')}];
const data={enabled:true,vehicle_id:9,work_date:day,editable_ready:true,editable_revision:2,
  locked_plots:[{id:'first',plot_id:'first',geometry:a},{id:'continued',plot_id:'continued',geometry:b}],
  plots:[{...plots[1],state:'completed',locked_at:at,geometry:a},{...plots[2],state:'working',locked_at:at,geometry:b}]};
test('an absorbed earlier field keeps the earliest number, independent of response order',async()=>{
 const {gpsFieldAliases}=await identity;const before=JSON.stringify(plots);
 assert.deepEqual(gpsFieldAliases(plots),{other:'other',first:'first',continued:'first'});
 assert.deepEqual(gpsFieldAliases([...plots].reverse()),{continued:'first',first:'first',other:'other'});
 assert.equal(JSON.stringify(plots),before);
});
test('touching fields, a crossing and partial shared tracks never establish identity',async()=>{
 const {gpsFieldAliases}=await identity;
 for(const shared of [[],edges.slice(0,1),edges.slice(0,5),edges.slice(0,85)]) {
  const result=gpsFieldAliases([{id:'a',number:1,edge_keys:edges},{id:'b',number:2,edge_keys:[...shared,'independent']}]);
  assert.equal(result.a,'a');assert.equal(result.b,'b');
 }
});
test('multiple absorbed identities resolve transitively without changing receipt IDs',async()=>{
 const {gpsFieldAliases}=await identity;
 const result=gpsFieldAliases([...plots,{id:'latest',number:4,edge_keys:[...plots[2].edge_keys,'later']}]);
 assert.equal(result.latest,'first');assert.equal(result.continued,'first');
});
test('connected fields display once with every saved ID and exact geometry and rai',async()=>{
 const {gpsDisplayPlots,gpsPlotStatus}=await display;const before=JSON.stringify({saved,data});
 const groups=gpsDisplayPlots(saved,[{net:a},{net:b}],data,9,day,2);
 assert.equal(groups.length,1);assert.equal(groups[0].name,'แปลงที่ 2');
 assert.deepEqual(groups[0].indices,[0,1]);assert.deepEqual(groups[0].autoPlot.source_ids,['first','continued']);
 assert.equal(gpsPlotStatus(groups[0]).key,'measuring');
 assert.ok(Math.abs(groups[0].areaRai-turf.area(full)/1600)<1e-8);
 assert.equal(JSON.stringify({saved,data}),before);
});
test('completion locks the combined field; saved edits and deleted receipts stay respected',async()=>{
 const {gpsDisplayPlots,gpsPlotStatus}=await display;
 const done={...data,plots:data.plots.map(p=>({...p,state:'completed'}))};
 const group=gpsDisplayPlots(saved,[{net:a},{net:b}],done,9,day,2)[0];
 assert.equal(gpsPlotStatus(group).key,'locked');
 const onlyB=gpsDisplayPlots(saved.slice(1),[{net:b}],done,9,day,3);
 assert.equal(onlyB.length,1);assert.ok(Math.abs(onlyB[0].areaRai-turf.area(b)/1600)<1e-8);
 const hole=box(.0003,.0005),edited=turf.difference(turf.featureCollection([a,hole]));
 const editedGroup=gpsDisplayPlots(saved,[{net:edited},{net:b}],data,9,day,2)[0];
 assert.ok(Math.abs(editedGroup.areaRai-(turf.area(full)-turf.area(hole))/1600)<1e-8);
});
test('vehicle/date guards prevent unrelated responses from merging plots',async()=>{
 const {gpsDisplayPlots}=await display;const {gpsOriginFieldId}=await identity;
 assert.equal(gpsDisplayPlots(saved,[{net:a},{net:b}],{...data,vehicle_id:10},9,day,2).length,2);
 assert.equal(gpsOriginFieldId(saved[0],{first:'continued'},10,day),null);
 assert.equal(gpsOriginFieldId(saved[0],{first:'continued'},9,'2026-11-13'),null);
});
test('queue and trip grouping shares the map identity while payments keep raw IDs',async()=>{
 const aliases=(await identity).gpsFieldAliases(plots);
 assert.equal(gpsPlotGroupKey(saved[0],9,day,aliases),gpsPlotGroupKey(saved[1],9,day,aliases));
 const {groupJobPlots,fieldPaymentStatus}=await import('../harvester-app/src/gps-field-groups.mjs');
 const items=saved.map((p,i)=>({...p,vehicle_id:9,work_date:day,group_key:gpsPlotGroupKey(p,9,day,aliases),area_rai:i+1}));
 const groups=groupJobPlots(items);assert.equal(groups.length,1);assert.equal(groups[0].area_rai,3);
 assert.deepEqual(groups[0].members.map(p=>p.id),['saved-a','saved-b']);
 assert.equal(fieldPaymentStatus(groups[0],new Set([`9/${day}/saved-a`])),'partial');
});
test('identity reader caches and deduplicates reads, expires, and ignores single-source scopes',async()=>{
 let calls=0,now=0;const db={from(){calls++;return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{result:{...data,plots}}};}};}};
 const read=createGpsFieldIdentityReader(db,{now:()=>now});
 assert.deepEqual(await read(9,day,[saved[0]]),{});assert.equal(calls,0);
 const [x,y]=await Promise.all([read(9,day,saved),read(9,day,saved)]);assert.deepEqual(x,y);assert.equal(x.continued,'first');assert.equal(calls,1);
 await read(9,day,saved);assert.equal(calls,1);now=60001;await read(9,day,saved);assert.equal(calls,2);
});
