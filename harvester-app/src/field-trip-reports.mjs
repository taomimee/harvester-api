// Shared by the API and browser: cash belongs to receipt day, production to work day.
// Receipts offset oldest daily earnings only for report allocation, without closing a trip.
export function fieldTripPeriodStats(trips, year, month = 0) {
  const inPeriod = d => Number(d.slice(0, 4)) === Number(year) && (!Number(month) || Number(d.slice(5, 7)) === Number(month));
  const result = { rai: 0, plots: 0, earned: 0, received: 0, outstanding: 0, days: 0, wages: 0 };
  for (const trip of trips || []) {
    const receipts = trip.payments.filter(p => !p.voided_at);
    let allocated = receipts.reduce((sum, p) => sum + Number(p.amount), 0);
    result.received += receipts.filter(p => inPeriod(p.payment_date)).reduce((sum, p) => sum + Number(p.amount), 0);
    for (const d of [...trip.days].sort((a, b) => a.work_date.localeCompare(b.work_date))) {
      const paid = Math.min(allocated, Number(d.harvest_amount));
      allocated -= paid;
      if (inPeriod(d.work_date)) {
        result.rai += Number(d.confirmed_rai); result.plots += d.plot_count; result.days++;
        result.earned += Number(d.harvest_amount); result.outstanding += Number(d.harvest_amount) - paid;
        result.wages += Number(d.wage_amount || 0);
      }
    }
  }
  for (const key of Object.keys(result)) result[key] = Math.round(result[key] * 10000) / 10000;
  return result;
}
