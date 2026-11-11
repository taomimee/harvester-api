'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeGpsDay}=require('../lib/gps-auto');
const options={vehicleId:9,workDate:'2026-11-09',headWidth:3};
const start=Date.parse('2026-11-09T00:00:00Z');
const trace=(positions,{step=6,at=start,offset=0}={})=>positions.map(([x,y],i)=>({
  id:offset+i+1,latitude:14+y/111195,longitude:100+x/(111195*Math.cos(14*Math.PI/180)),
  created_at:new Date(at+i*step*1000).toISOString(),is_harvesting:true
}));
function strip(length=800,lanes=8,x=0,y=0,spacing=10){
  const result=[];
  for(let row=0;row<lanes;row++)for(let column=0;column<=length/spacing;column++)
    result.push([x+(row%2?length-column*spacing:column*spacing),y+row*3]);
  return result;
}
const measure=(rows,previous)=>analyzeGpsDay(rows,{...options,previous});
const rotate=(points,degrees)=>{const a=degrees*Math.PI/180;return points.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]);};

for(const angle of [0,30,90,150])test(`long narrow harvesting remains measurable at ${angle} degrees`,()=>{
  const result=measure(trace(rotate(strip(),angle)));
  assert.equal(result.plots.length,1);
  assert.equal(result.plots[0].state,'working');
  assert.ok(Math.abs(result.estimated_rai-800*24/1600)<.4,result.estimated_rai);
});

test('extending a narrow field past the former aspect-ratio cutoff never erases earlier work',()=>{
  const first=strip(300),base=measure(trace(first));
  const positions=[...first,...strip(500,8,300)];
  const continued=measure(trace(positions),base);
  assert.equal(continued.plots.length,1);
  assert.equal(continued.plots[0].id,base.plots[0].id);
  assert.ok(continued.estimated_rai>base.estimated_rai+6);
  assert.equal(continued.plots[0].state,'working');
});

function resumedField(){
  const original=strip(100,20);
  for(let x=10;x<=700;x+=10)original.push([x,57]);
  const locked=measure(trace(original));
  assert.equal(locked.locked_count,1);
  const positions=[...original,...strip(800,8,60)];
  return {locked,positions,active:measure(trace(positions),locked)};
}

test('long adjacent harvesting resumes the same field and preserves its locked receipts',()=>{
  const {locked,active}=resumedField();
  assert.deepEqual(active.locked_plots,locked.locked_plots);
  assert.equal(active.plots.length,1);
  assert.equal(active.plots[0].id,locked.plots[0].id);
  assert.equal(active.plots[0].state,'working');
  assert.ok(active.working_rai>10,active.working_rai);
  assert.ok(active.estimated_rai>locked.estimated_rai+10);
  const fresh=measure(trace(strip(800,8,60)));
  assert.ok(active.estimated_rai<locked.estimated_rai+fresh.estimated_rai,'overlap is counted once');
});

test('driving back across the harvested field to unload adds no area and does not close ongoing work',()=>{
  const {locked,positions,active}=resumedField();
  // Stay in the harvested coverage while returning to the unloading point.
  for(let x=60;x>=0;x-=5)positions.push([x,21]);
  for(let i=0;i<25;i++)positions.push([0,21]);
  for(let x=0;x<=60;x+=5)positions.push([x,21]);
  const unloaded=measure(trace(positions),active);
  assert.equal(unloaded.plots.length,1);
  assert.notEqual(unloaded.plots[0].state,'completed');
  assert.deepEqual(unloaded.locked_plots,locked.locked_plots);
  assert.ok(Math.abs(unloaded.estimated_rai-active.estimated_rai)<.03);
  const restarted=measure(trace(positions),JSON.parse(JSON.stringify(unloaded)));
  assert.deepEqual(restarted.plots,unloaded.plots);
});

test('the long resumed field locks only after leaving the expanded boundary for five minutes',()=>{
  const {positions,active}=resumedField(),rows=trace(positions),at=Date.parse(rows.at(-1).created_at)+6000;
  const nearby=trace(Array.from({length:8},()=>[900,21]),{step:50,at,offset:10000});
  const stillHere=measure([...rows,...nearby],active);
  assert.notEqual(stillHere.plots[0].state,'completed','40 m from the extended field is not departure');
  const away=trace(Array.from({length:7},()=>[1000,21]),{step:50,at,offset:10000});
  const fourMinutes=measure([...rows,...away.slice(0,6)],active);
  assert.notEqual(fourMinutes.plots[0].state,'completed');
  const done=measure([...rows,...away],active);
  assert.equal(done.plots[0].state,'completed');
  assert.equal(done.locked_count,1);
  assert.ok(Math.abs(done.estimated_rai-active.estimated_rai)<.03);
  const repeated=measure([...rows,...away],done);
  assert.deepEqual(repeated.locked_plots,done.locked_plots);
  assert.equal(repeated.estimated_rai,done.estimated_rai);
});

test('long straight, L-shaped and curved three-pass roads remain excluded',()=>{
  const straight=strip(1000,3),bend=[],curve=[];
  for(let lane=0;lane<3;lane++){
    const points=[];
    for(let x=0;x<=500;x+=5)points.push([x,lane*3]);
    for(let y=5;y<=500;y+=5)points.push([500-lane*3,y]);
    if(lane%2)points.reverse();
    bend.push(...points);
    const arc=[];
    for(let i=0;i<=200;i++){const angle=i/200*Math.PI;arc.push([(300+lane*3)*Math.cos(angle),(300+lane*3)*Math.sin(angle)]);}
    if(lane%2)arc.reverse();
    curve.push(...arc);
  }
  for(const [name,positions] of [['straight',straight],['bend',bend],['curve',curve]])
    assert.equal(measure(trace(positions)).estimated_rai,0,name);
});

test('four-pass curved transit does not become a broad field just because it bends',()=>{
  const positions=[];
  for(let lane=0;lane<4;lane++){
    const arc=[];
    for(let i=0;i<=200;i++){const a=i/200*Math.PI;arc.push([(300+lane*3)*Math.cos(a),(300+lane*3)*Math.sin(a)]);}
    positions.push(...(lane%2?arc.reverse():arc));
  }
  assert.equal(measure(trace(positions)).estimated_rai,0);
});

test('small broad fields remain measurable; the interior check does not trim their area',()=>{
  const result=measure(trace(strip(30,10,0,0,2),{step:10}));
  assert.equal(result.plots.length,1);
  assert.ok(result.estimated_rai>.5&&result.estimated_rai<.7,result.estimated_rai);
});

test('sparse, shuffled and repeated GPS points preserve the long field footprint',()=>{
  const rows=trace(strip(800,8,0,0,20),{step:20});
  const original=measure(rows);
  assert.ok(original.estimated_rai>11.5);
  const shuffled=measure([...rows,...rows.slice(0,25)].reverse());
  assert.equal(shuffled.estimated_rai,original.estimated_rai);
  assert.deepEqual(shuffled.plots,original.plots);
});

test('missing GPS cannot lock ongoing long-field work or draw a connecting strip',()=>{
  const rows=trace(strip()),active=measure(rows);
  const gap=trace([[2000,0],[2000,0],[2000,0]],{step:30,at:Date.parse(rows.at(-1).created_at)+3600000,offset:10000});
  const result=measure([...rows,...gap],active);
  assert.equal(result.locked_count,0);
  assert.ok(Math.abs(result.estimated_rai-active.estimated_rai)<.03);
});
