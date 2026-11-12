import { area, polygon, difference, featureCollection, buffer, multiLineString, kinks } from '@turf/turf';
import { gpsDisplayPlots } from './gps-display-plots.mjs';

const ringFeature=(points,minimumSqM=1)=>{
  if(!Array.isArray(points)||points.length<3)throw new Error('ต้องมีอย่างน้อย 3 จุด');
  const coords=[];
  for(const p of points){
    if(p?.lng==null||p?.lat==null||p.lng===''||p.lat==='')throw new Error('พิกัดไม่ถูกต้อง');
    const xy=[Number(p.lng),Number(p.lat)];
    if(!xy.every(Number.isFinite)||Math.abs(xy[0])>180||Math.abs(xy[1])>90)throw new Error('พิกัดไม่ถูกต้อง');
    const last=coords[coords.length-1];if(!last||last[0]!==xy[0]||last[1]!==xy[1])coords.push(xy);
  }
  if(coords.length>1&&coords[0][0]===coords.at(-1)[0]&&coords[0][1]===coords.at(-1)[1])coords.pop();
  if(coords.length<3)throw new Error('ต้องมีอย่างน้อย 3 มุมที่ไม่ซ้ำกัน');
  const feature=polygon([[...coords,coords[0]]]);
  if(kinks(feature).features.length)throw new Error('เส้นตัดกันเอง');
  const ringArea=area(feature);
  if(ringArea<=0||ringArea<minimumSqM)throw new Error('พื้นที่ต้องมีอย่างน้อย 1 ตร.ม.');
  return feature;
};
export function savedPlotGeometry(plot) {
  const outer=ringFeature(plot.points);
  let net=outer;
  for(const hole of plot.holes || []) {
    if(!net)break;
    net=difference(featureCollection([net,ringFeature(hole.points,0)]));
  }
  const grossSqM=area(outer),netSqM=net?Math.min(grossSqM,Math.max(0,area(net))):0;
  return {outer,net,grossSqM,netSqM,excludedSqM:Math.max(0,grossSqM-netSqM)};
}
export function computeGpsProjection({saved,data,vehicle,date,revision}) {
  const geometries=saved.map(p=>{try{return savedPlotGeometry(p);}catch{return null;}});
  return {geometries,plots:gpsDisplayPlots(saved,geometries,data,vehicle,date,revision)};
}
// Only explicit hole/manual-boundary tools need a buffered full-day route.
// Ordinary GPS viewing uses the existing automatic result, off the UI thread.
export function computeRouteCoverage({segments,headWidth}) {
  return segments.length ? buffer(multiLineString(segments),Math.max(.5,Number(headWidth)/2),{units:'meters',steps:5}) : null;
}
