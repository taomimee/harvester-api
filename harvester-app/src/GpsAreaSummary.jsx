import { useEffect, useState } from 'react'
import { splitGpsThaiArea } from './thai-area.mjs'

export function useGpsArea(vehicle, date, enabled) {
  const scope = `${vehicle}/${date}`
  const [snapshot, setSnapshot] = useState(null)
  const [failure, setFailure] = useState(null)
  useEffect(() => {
    if (!enabled || !vehicle || !date) return
    let active = true, timer, controller
    const refresh = async () => {
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45000)
      try {
        const response = await fetch(`https://harvester-api-server.onrender.com/api/gps-area/${vehicle}?date=${date}`, { signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'โหลดพื้นที่ไม่ได้')
        if (Number(data.vehicle_id) !== Number(vehicle) || data.work_date !== date) throw new Error('ขอบเขตข้อมูลไม่ตรง')
        if (active) {
          setSnapshot(previous => previous?.scope===scope && JSON.stringify(previous.data)===JSON.stringify(data) ? previous : {scope,data})
          setFailure(null)
        }
      } catch (error) {
        if (active) setFailure({scope, message: error.name === 'AbortError' ? 'รอการเชื่อมต่อ ระบบจะลองใหม่' : 'อัปเดตไม่สำเร็จ ระบบจะลองใหม่'})
      } finally {
        clearTimeout(timeout)
        if (active) timer = setTimeout(refresh, 30000)
      }
    }
    refresh()
    return () => { active = false; clearTimeout(timer); controller?.abort() }
  }, [vehicle, date, enabled, scope])
  return {data: snapshot?.scope === scope ? snapshot.data : null, error: failure?.scope === scope ? failure.message : null}
}

export default function GpsAreaSummary({ data, displayTotals, error, history }) {
  const visible = displayTotals?.source === data ? displayTotals : null
  const totalRai = visible?.estimated_rai ?? data?.estimated_rai
  const available = data?.enabled && Number.isFinite(data.estimated_rai)
  const last = data?.observed_at ? new Date(data.observed_at) : null
  const stale = !history && last && Date.now() - last.getTime() > 180000
  const time = last?.toLocaleTimeString('th-TH', {timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})
  let message = 'กำลังคำนวณอัตโนมัติ…'
  if (data?.enabled === false) message = 'รถคันนี้ยังไม่ได้เปิดวัดอัตโนมัติ'
  else if (data?.status === 'no_data') message = 'ยังไม่มีพิกัดสำหรับวันนี้'
  else if (data?.status === 'insufficient' || data?.status === 'observing') message = 'รอแนวเกี่ยวชัดเจน · ยังไม่สรุปเป็นศูนย์'
  else if (data?.archived) message = `ยอดที่เก็บไว้ · พิกัดถึง ${time || '—'} น.`
  else if (stale) message = `ยอดล่าสุดถึง ${time} น. · รอพิกัดใหม่`
  else if (time) message = `วัดอัตโนมัติ · พิกัดถึง ${time} น.`
  const hasArea = available && totalRai > 0
  const area = splitGpsThaiArea(totalRai)
  const count = visible?.plot_count ?? (data?.plots?.length || data?.locked_count || 0)
  const working = visible ? visible.working_count > 0 : data?.working_rai > 0
  const locked = visible ? count > 0 && visible.locked_count === count : count > 0 && !working
  return <section className="gps-area-summary" aria-label="ยอดไร่จาก GPS อัตโนมัติ">
    <div className="gps-area-caption"><strong>{history ? 'เกี่ยวได้ในวันที่เลือก' : 'เกี่ยวแล้ววันนี้'}</strong><small>{error || message}</small>{data?.lock_version && <small>🌾 {count} แปลง{working ? ' · กำลังวัดต่อ' : locked ? ' · ล็อกแล้ว' : ''}</small>}</div>
    <div className="gps-area-value"><small>ประมาณจาก GPS</small>{hasArea ? <div className="gps-area-units"><span><strong>{area.rai.toLocaleString('th-TH')}</strong> ไร่</span><span><strong>{area.ngan.toLocaleString('th-TH')}</strong> งาน</span></div> : <strong>—</strong>}<small>4 งาน = 1 ไร่</small></div>
  </section>
}
