import {computeGpsProjection,computeRouteCoverage} from './gps-map-compute.mjs';
self.onmessage=({data:{id,type,input}})=>{
  try { self.postMessage({id,result:type==='coverage'?computeRouteCoverage(input):computeGpsProjection(input)}); }
  catch(error){self.postMessage({id,error:error.message});}
};
