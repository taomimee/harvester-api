import {useRef,useState} from 'react';

export function useBossSession({api,getToken,clearToken,onAuthorized}) {
  const [dialog,setDialog]=useState(null),[pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(null);
  const ask=()=>{
    if(pending.current)return pending.current.promise;
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    pending.current={promise,resolve};setPin('');setError('');setDialog(true);
    return promise;
  };
  const finish=token=>{pending.current?.resolve(token);pending.current=null;setDialog(null);setPin('');};
  const requireToken=async()=>{
    const token=getToken() || await ask();
    if(!token)throw new Error('ยังไม่ได้ยืนยันรหัส ข้อมูลที่กรอกยังอยู่ กดบันทึกเพื่อลองอีกครั้ง');
    return token;
  };
  const submit=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const response=await fetch(`${api}/boss/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'ยืนยันรหัสไม่สำเร็จ');
      localStorage.setItem('harvester_boss_token',data.token);sessionStorage.setItem('harvester_boss_token',data.token);
      onAuthorized();finish(data.token);
    } catch(e){setError(e.message||'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง');}
    finally{setBusy(false);}
  };
  const bossFetch=async(url,options={})=>{
    let token=await requireToken();
    const send=()=>fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});
    let response=await send();
    if(response.status===401 || response.status===403) {
      // A rejected request did not mutate data. Keep the same idempotency key/body on retry.
      if(getToken()===token)clearToken();
      token=await requireToken();response=await send();
    }
    return response;
  };
  const authorize=async()=>{
    if(getToken()) {
      const response=await fetch(`${api}/boss/session`,{headers:{Authorization:`Bearer ${getToken()}`},cache:'no-store'});
      if(response.ok){onAuthorized();return getToken();}
      if(response.status!==401 && response.status!==403)throw new Error('ตรวจสิทธิ์ไม่ได้ชั่วคราว กรุณาลองใหม่');
      clearToken();
    }
    return requireToken();
  };
  const sessionDialog=dialog && <div className="boss-session-overlay"><form className="boss-session-dialog" role="dialog" aria-modal="true" aria-labelledby="boss-session-title" onSubmit={submit}>
    <h2 id="boss-session-title">ยืนยันโหมดเถ้าแก่</h2><p>ใส่รหัสเพื่อทำรายการต่อ ข้อมูลที่กำลังกรอกยังอยู่ครบ</p>
    <label>รหัสเถ้าแก่<input autoFocus type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required disabled={busy}/></label>
    {error && <p role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>finish(null)}>ยกเลิก</button><button type="submit" disabled={busy}>{busy?'กำลังตรวจรหัส…':'ยืนยันและทำต่อ'}</button></div>
  </form></div>;
  return {requireToken,bossFetch,authorize,sessionDialog};
}
