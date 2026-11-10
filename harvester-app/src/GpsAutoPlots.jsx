import { usedAutoPlotParts } from './gps-auto-import.mjs'
const rai = value => Number(value || 0).toLocaleString('th-TH', {minimumFractionDigits:2,maximumFractionDigits:2})
const time = value => value ? new Date(value).toLocaleTimeString('th-TH', {timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}) : '—'

export default function GpsAutoPlots({data, onSelect, savedPlots=[], onUse, onEdit, onOpenJob, onField, busy=false, canPostWork=false}) {
  if (!data?.enabled) return null
  return <section aria-label="แปลงที่บันทึกอัตโนมัติ" className="gps-auto-plots">
    <h3>แปลงจาก GPS อัตโนมัติ</h3>
    <p className="gps-auto-help">ออกห่างขอบแปลง 60 เมตรต่อเนื่อง 5 นาที ระบบล็อกยอดให้เอง</p>
    {!data.plots?.length && <p className="gps-empty">รอแนวเกี่ยวชัดเจน แล้วระบบจะเก็บแปลงให้อัตโนมัติ</p>}
    {(data.plots || []).map(plot => {
      const locked = plot.state === 'completed' && plot.locked_at
      const used = usedAutoPlotParts(savedPlots, plot.id)
      const jobs = [...new Set(used.map(p => p.job_id).filter(Boolean))]
      const status = locked ? `🔒 ล็อกแล้ว ${time(plot.locked_at)} น.` : plot.state === 'waiting' ? 'รอรถออกห่าง · ยังไม่ล็อก' : plot.locked_at ? 'กำลังเกี่ยวเพิ่มในแปลงเดิม' : 'กำลังเกี่ยว · ยังไม่ล็อก'
      return <article key={plot.id} className="gps-plot-card">
        <button type="button" className="gps-plot-select" onClick={() => onSelect(plot)} aria-label={`ดูแปลงอัตโนมัติที่ ${plot.number} บนแผนที่`}>
          <span><strong>แปลงที่ {plot.number}</strong><small>{status}</small></span><b>{rai(plot.estimated_rai)} ไร่</b>
        </button>
        <p className="gps-auto-detail">{locked ? 'บันทึกยอดและขอบแปลงแล้ว' : plot.locked_at ? `ล็อกไว้แล้ว ${rai(plot.locked_rai)} ไร่ · ส่วนเพิ่ม ${rai(plot.additional_rai)} ไร่` : 'หยุดพักหรือสัญญาณหายอย่างเดียวจะไม่ปิดแปลง'}<br/>ประมาณจาก GPS · แตะเพื่อดูแปลง</p>
        {plot.locked_at && <>
          {used.length > 0 && <p className="gps-auto-detail">นำไปใช้แล้ว {used.length} ส่วน · ยอดที่นำไปใช้ {rai(used.reduce((sum,p)=>sum+Number(p.area?.rawRai || 0),0))} ไร่</p>}
          <div className="gps-plot-buttons">
            <button type="button" disabled={busy} onClick={()=>onUse(plot,'link')}>🔗 ผูกคิว / ยอด</button>
            {!used.length && <button type="button" disabled={busy} onClick={()=>onUse(plot,'edit')}>✏️ นำไปแก้ไข</button>}
            {used.map((p,i)=><button key={p.id} type="button" disabled={busy} onClick={()=>onEdit(p.id)}>✏️ แก้ขอบ{used.length>1?`ส่วน ${i+1}`:'แปลง'}</button>)}
            {jobs.map(id=><button key={id} type="button" onClick={()=>onOpenJob(id)}>เปิดคิว #{id} / ลงยอด</button>)}
            {canPostWork && <button type="button" disabled={busy} onClick={()=>onField(plot)}>ใช้ลงยอดนอกพื้นที่</button>}
          </div>
        </>}
      </article>
    })}
  </section>
}
