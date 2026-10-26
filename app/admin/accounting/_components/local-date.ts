/** Today's date in the browser's own time zone as YYYY-MM-DD (toISOString() would give the UTC date, which is tomorrow for US evenings). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
