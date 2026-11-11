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
