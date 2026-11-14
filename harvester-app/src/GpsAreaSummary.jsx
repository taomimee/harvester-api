import { useEffect, useState } from 'react'
import { splitGpsThaiArea } from './thai-area.mjs'
import { gpsVisibleTotals } from './gps-projection-state.mjs'

export function useGpsArea(vehicle, date, enabled) {
  const scope = `${vehicle}/${date}`
  const [snapshot, setSnapshot] = useState(null)
  const [failure, setFailure] = useState(null)
  useEffect(() => {
    if (!enabled || !vehicle || !date) return
    let active = true, timer, controller, liveArrived = false
    const url = `https://harvester-api-server.onrender.com/api/gps-area/${vehicle}?date=${date}`
    const cachedController = new AbortController()
    const cachedTimeout = setTimeout(() => cachedController.abort(), 10000)
    fetch(`${url}&snapshot=1`, {signal:cachedController.signal, cache:'no-store'})
      .then(async response => response.ok && response.status !== 204 ? response.json() : null)
      .then(data => {
        if (!active || liveArrived || !data?.snapshot || Number(data.vehicle_id)!==Number(vehicle) || data.work_date!==date) return
        // A slower bootstrap must never replace a live result or an existing view.
        setSnapshot(previous => previous?.scope===scope ? previous : {scope,data})
      }).catch(() => {}).finally(() => clearTimeout(cachedTimeout))
    const refresh = async () => {
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45000)
      let failed = false
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'โหลดพื้นที่ไม่ได้')
        if (Number(data.vehicle_id) !== Number(vehicle) || data.work_date !== date) throw new Error('ขอบเขตข้อมูลไม่ตรง')
        if (active) {
          liveArrived = true
          setSnapshot(previous => previous?.scope===scope && JSON.stringify(previous.data)===JSON.stringify(data) ? previous : {scope,data})
          setFailure(null)
        }
      } catch (error) {
        failed = true
        if (active) setFailure({scope, message: error.name === 'AbortError' ? 'รอการเชื่อมต่อ ระบบจะลองใหม่' : 'อัปเดตไม่สำเร็จ ระบบจะลองใหม่'})
      } finally {
        clearTimeout(timeout)
        if (active) timer = setTimeout(refresh, failed ? 10000 : 30000)
      }
    }
    refresh()
    return () => { active = false; clearTimeout(timer); clearTimeout(cachedTimeout); cachedController.abort(); controller?.abort() }
  }, [vehicle, date, enabled, scope])
  return {data: snapshot?.scope === scope ? snapshot.data : null, error: failure?.scope === scope ? failure.message : null}
}

export default function GpsAreaSummary({ data, displayTotals, error, history }) {
  const visible = gpsVisibleTotals(displayTotals, data)
  const source = visible?.source || data
  const totalRai = visible?.estimated_rai
  const available = Boolean(visible) && Number.isFinite(totalRai)
  const last = source?.observed_at ? new Date(source.observed_at) : null
  const stale = !history && last && Date.now() - last.getTime() > 180000
  const time = last?.toLocaleTimeString('th-TH', {timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})
  let message = 'กำลังคำนวณอัตโนมัติ…'
  if (data?.enabled === false) message = 'รถคันนี้ยังไม่ได้เปิดวัดอัตโนมัติ'
  else if (data?.status === 'no_data') message = 'ยังไม่มีพิกัดสำหรับวันนี้'
  else if (data?.status === 'insufficient' || data?.status === 'observing') message = 'รอแนวเกี่ยวชัดเจน · ยังไม่สรุปเป็นศูนย์'
  else if (!visible) message = 'กำลังโหลดแปลงล่าสุด…'
  else if (source?.archived) message = `ยอดที่เก็บไว้ · พิกัดถึง ${time || '—'} น.`
  else if (source?.snapshot) message = `ยอดล่าสุดถึง ${time || '—'} น. · กำลังอัปเดตต่อ`
  else if (stale) message = `ยอดล่าสุดถึง ${time} น. · รอพิกัดใหม่`
  else if (time) message = `วัดอัตโนมัติ · พิกัดถึง ${time} น.`
  const hasArea = available && totalRai > 0
  const area = splitGpsThaiArea(totalRai)
  const count = visible?.plot_count || 0
  const working = visible?.working_count > 0
  const locked = count > 0 && visible?.locked_count === count
  return <section className="gps-area-summary" aria-label="ยอดไร่จาก GPS อัตโนมัติ">
    <div className="gps-area-caption"><strong>{history ? 'เกี่ยวได้ในวันที่เลือก' : 'เกี่ยวแล้ววันนี้'}</strong><small>{error || message}</small>{visible?.source?.lock_version && <small>🌾 {count} แปลง{working ? ' · กำลังวัดต่อ' : locked ? ' · ล็อกแล้ว' : ''}</small>}</div>
    <div className="gps-area-value"><small>ประมาณจาก GPS</small>{hasArea ? <div className="gps-area-units"><span><strong>{area.rai.toLocaleString('th-TH')}</strong> ไร่</span><span><strong>{area.ngan.toLocaleString('th-TH')}</strong> งาน</span></div> : <strong>—</strong>}<small>4 งาน = 1 ไร่</small></div>
  </section>
}
