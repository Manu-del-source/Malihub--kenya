/** Integer cents → "KSh 3,000" / "KSh 3,000.50". Never goes through floats for arithmetic. */
export function formatKsh(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = new Intl.NumberFormat("en-KE").format(whole);
  return `${negative ? "-" : ""}KSh ${wholeStr}${frac ? `.${String(frac).padStart(2, "0")}` : ""}`;
}
