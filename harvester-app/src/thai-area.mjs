// Display only: stored areas and money calculations continue to use decimal rai.
// Round in hundredths of a ngan first so 4 ngan always carries into 1 rai.
export function splitThaiArea(raiValue) {
  const value = Number(raiValue);
  const hundredths = Math.round((Number.isFinite(value) ? Math.max(0, value) : 0) * 400);
  return { rai: Math.floor(hundredths / 400), ngan: (hundredths % 400) / 100 };
}

export function formatRaiNgan(raiValue) {
  const { rai, ngan } = splitThaiArea(raiValue);
  return `${rai.toLocaleString('th-TH')} ไร่ ${ngan.toLocaleString('th-TH', { maximumFractionDigits: 2 })} งาน`;
}

// GPS estimates are shown in whole ngan, always rounding a real fraction up.
// Keep raw decimal rai and the precise accounting formatter above unchanged.
export function splitGpsThaiArea(raiValue) {
  const value = Number(raiValue);
  const total = (Number.isFinite(value) ? Math.max(0, value) : 0) * 4;
  const nearest = Math.round(total);
  const tolerance = Number.EPSILON * Math.max(1, total) * 4;
  const wholeNgan = nearest > 0 && Math.abs(total - nearest) <= tolerance
    ? nearest : Math.ceil(total);
  return { rai: Math.floor(wholeNgan / 4), ngan: wholeNgan % 4 };
}

export function formatGpsRaiNgan(raiValue) {
  const { rai, ngan } = splitGpsThaiArea(raiValue);
  return `${rai.toLocaleString('th-TH')} ไร่ ${ngan} งาน`;
}
