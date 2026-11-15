import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {formatGpsRaiNgan} from './thai-area.mjs'

export default function GpsManualLock({selection, onClose, onLocked, onRefresh}) {
  const dialog=useRef(null), busyRef=useRef(false), mounted=useRef(true)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [conflict,setConflict]=useState(false)
  useEffect(()=>{
    const previous=document.activeElement
    mounted.current=true;dialog.current.showModal()
    return ()=>{mounted.current=false;previous?.focus?.()}
  },[])
  const confirm=async()=>{
    if(busyRef.current || conflict)return
    busyRef.current=true;setBusy(true);setError('')
    try {
      const response=await fetch(`https://harvester-api-server.onrender.com/api/gps-area/${selection.vehicle}/lock`,{
        method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
        body:JSON.stringify({work_date:selection.date,plot_id:selection.plotId,expected_revision:selection.revision,request_id:selection.requestId})
      })
      const data=await response.json()
      if(!response.ok) {
        if(response.status===409 && mounted.current){setConflict(true);onRefresh?.()}
        throw new Error(data.error || 'ยังล็อกไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
      onLocked(data)
      if(mounted.current)onClose()
    } catch(e) {
      if(mounted.current)setError(e.name==='TimeoutError' || e.name==='AbortError' ? 'การเชื่อมต่อช้า กดยืนยันอีกครั้งเพื่อตรวจผลเดิมได้ ไม่ล็อกซ้ำ' : e.message)
    } finally {
      busyRef.current=false
      if(mounted.current)setBusy(false)
    }
  }
  return createPortal(<dialog ref={dialog} className="gps-seal-dialog" aria-labelledby="gps-seal-title" onCancel={e=>{e.preventDefault();if(!busyRef.current)onClose()}}>
    <h2 id="gps-seal-title">ล็อกแปลงนี้เลยไหม?</h2>
    <p className="gps-seal-name">{selection.name}</p>
    <strong className="gps-seal-area">{formatGpsRaiNgan(selection.areaRai)}</strong>
    <p>ยอดแปลงนี้จะหยุดเพิ่ม งานที่เกี่ยวต่อจะเริ่มเป็นแปลงใหม่ แม้อยู่ติดกัน</p>
    <p className="gps-seal-hint">พิกัดถึง {new Date(selection.observedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} น.<br/>หลังล็อกยังแก้ขอบแปลงและผูกคิวได้ตามเดิม</p>
    {error && <p className="gps-seal-error" role="alert">{error}</p>}
    <div className="gps-seal-actions"><button type="button" autoFocus disabled={busy} onClick={onClose}>{conflict?'ปิดและดูยอดล่าสุด':'ยกเลิก'}</button><button type="button" className="gps-seal-confirm" disabled={busy || conflict} onClick={confirm}>{busy?'กำลังล็อก…':'ยืนยันล็อกแปลง'}</button></div>
  </dialog>,document.body)
}
