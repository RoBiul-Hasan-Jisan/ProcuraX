const num = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** Formats an exact decimal STRING from the API. Strings are passed through unchanged to avoid float rounding. */
export function money(value: string | null | undefined, currency = "BDT"): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${currency} ${num.format(value as unknown as number)}`;
}
export const quantity = (value: string | null | undefined) => (value == null ? "-" : qty.format(value as unknown as number));

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return withTime
    ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/** yyyy-mm-dd for <input type="date"> */
export const toDateInput = (value: string | Date) => new Date(value).toISOString().slice(0, 10);
export const toDateTimeInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
