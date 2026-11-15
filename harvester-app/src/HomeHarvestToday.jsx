import {useEffect, useState} from 'react';
import {runGpsGeometry} from './useGpsMapGeometry';
import {formatGpsRaiNgan, formatRaiNgan} from './thai-area.mjs';
import {homeHarvestSummary, loadHomeVehicle, thaiWorkDate} from './home-harvest.mjs';

const API = 'https://harvester-api-server.onrender.com/api';

export default function HomeHarvestToday({vehicles, recordedDate, recordedRai, onOpenGps}) {
  const [date, setDate] = useState(thaiWorkDate);
  const [rows, setRows] = useState({});
  const [reload, setReload] = useState(0);
  const ids = [...new Set(vehicles.map(v => String(v.id)))].sort().join(',');
  useEffect(() => {
    const timer = setInterval(() => setDate(thaiWorkDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!ids) return;
    let active = true, timer, controller, task;
    const previous = {};
    const refresh = async () => {
      // Serial requests avoid starting competing analyses on the small API host.
      for (const vehicle of ids.split(',')) {
        if (!active) return;
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
          const row = await loadHomeVehicle({fetcher:fetch, base:API, vehicle, date,
            signal:controller.signal, previous:previous[vehicle], project:input => {
              task = runGpsGeometry('project', input);
              return task.result;
            }});
          previous[vehicle] = row;
          if (active) setRows(old => ({...old, [vehicle]:row}));
        } catch {
          if (active) setRows(old => ({...old, [vehicle]:old[vehicle]?.date === date
            ? {...old[vehicle], stale:true} : {vehicle, date, state:'error'}}));
        } finally { clearTimeout(timeout); }
      }
      if (active) timer = setTimeout(refresh, 30000);
    };
    refresh();
    return () => {active = false; clearTimeout(timer); controller?.abort(); task?.cancel();};
  }, [ids, date, reload]);

  const summary = homeHarvestSummary(vehicles, rows, date, recordedDate === date ? recordedRai : 0);
  const time = summary.observedAt && new Date(summary.observedAt).toLocaleTimeString('th-TH',
    {timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit'});
  return <section aria-label="เกี่ยวจริงวันนี้" className="flex min-w-0 min-h-[122px] flex-col rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5 shadow-sm">
    <p className="text-xs font-bold text-emerald-900">🌾 เกี่ยวจริงวันนี้</p>
    <p className="mt-2 text-xl font-black leading-tight text-emerald-800 sm:text-2xl" aria-live="polite">
      {summary.source === 'pending' ? '—' : summary.source === 'gps' ? formatGpsRaiNgan(summary.rai) : formatRaiNgan(summary.rai)}
    </p>
    <div className="mt-auto pt-2 text-[11px] font-semibold text-emerald-900">
      {summary.source === 'gps' ? <>
        <span className="block">ประมาณจาก GPS · {summary.count} แปลง{summary.working ? ' · กำลังวัด' : ''}</span>
        {time && <span className="block">พิกัดถึง {time} น.</span>}
        {summary.recorded > 0 && <span className="block">ปิดรอบแล้ว {formatRaiNgan(summary.recorded)}</span>}
      </> : <span className="block">{summary.source === 'pending' ? 'กำลังโหลดยอด GPS…' : 'ตามรอบงานที่บันทึกแล้ว'}</span>}
      {summary.pending > 0 && <button type="button" onClick={() => setReload(n => n + 1)} className="mt-1 min-h-11 text-left underline">รอยอด GPS ล่าสุด · โหลดใหม่</button>}
    </div>
    <button type="button" onClick={onOpenGps} className="mt-1 min-h-11 text-left text-xs font-bold text-emerald-800 underline">ดูแปลงบนแผนที่ →</button>
  </section>;
}
