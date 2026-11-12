import {useEffect,useMemo,useState} from 'react';

export function runGpsGeometry(type,input) {
  let worker,timer;
  const result=new Promise((resolve,reject)=>{
    worker=new Worker(new URL('./gps-map.worker.js',import.meta.url),{type:'module'});
    timer=setTimeout(()=>{worker.terminate();reject(new Error('คำนวณขอบแปลงใช้เวลานาน กรุณาลองใหม่'));},60000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};
    worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(new Error('โหลดเครื่องมือขอบแปลงไม่ได้ กรุณาเปิดหน้านี้ใหม่'));};
    worker.postMessage({id:1,type,input});
  });
  return {result,cancel:()=>{clearTimeout(timer);worker?.terminate();}};
}

export function useGpsMapGeometry(saved,data,vehicle,date,revision) {
  const [snapshot,setSnapshot]=useState(null);
  const scope=`${vehicle}/${date}`;
  useEffect(()=>{
    if(!vehicle || revision===null)return;
    let active=true;
    const task=runGpsGeometry('project',{saved,data,vehicle,date,revision});
    task.result.then(result=>{if(active)setSnapshot({...result,scope,saved,source:data,error:''});})
      .catch(error=>{if(active)setSnapshot({scope,saved,source:data,plots:[],geometries:[],error:error.message});});
    return ()=>{active=false;task.cancel();};
  },[saved,data,vehicle,date,revision,scope]);
  return useMemo(()=>snapshot?.scope===scope && snapshot.saved===saved
    ? {...snapshot,pending:snapshot.source!==data}
    : {plots:[],geometries:[],source:null,pending:revision!==null,error:''},[snapshot,scope,saved,data,revision]);
}
