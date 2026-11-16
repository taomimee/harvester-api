import {computeGpsProjection,computeRouteCoverage} from './gps-map-compute.mjs';
import {splitGeometry} from './gps-split.mjs';
self.onmessage=({data:{id,type,input}})=>{
  try { self.postMessage({id,result:type==='split'?splitGeometry(input.geometry,input.line):type==='coverage'?computeRouteCoverage(input):computeGpsProjection(input)}); }
  catch(error){self.postMessage({id,error:error.message});}
};
