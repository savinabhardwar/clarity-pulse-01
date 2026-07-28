// Working-day helpers. Weekends must never count as "idle" or as sprint
// elapsed time -- a Monday should never read as "3 days idle" just
// because of the weekend.

export function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function workdaysBetween(fromDate, toDate) {
  if (toDate <= fromDate) return 0;
  let count = 0;
  const cur = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekend(cur)) count++;
  }
  return count;
}

export function workdaysInclusive(fromDate, toDate) {
  return workdaysBetween(new Date(fromDate.getTime() - 86400000), toDate);
}
