import { money, quantity } from "@/lib/utils/format";
import { alignRight } from "@/lib/utils/operations";
import type { ReportColumn, ReportResult } from "@/types/operations";

/** Amounts are exact decimal strings from the server and are only formatted, never recalculated here. */
export function formatCell(c: ReportColumn, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  if (c.type === "money") return money(String(v));
  if (c.type === "qty") return quantity(String(v));
  if (c.type === "pct") return `${v}%`;
  return String(v);
}

export function ReportTable({ result }: { result: ReportResult }) {
  if (result.columns.length === 0) return null;
  const rows = result.totals ? [...result.rows, result.totals] : result.rows;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-xs uppercase text-slate-500">
          <tr>{result.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${alignRight(c.type) ? "text-right" : ""}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const total = result.totals !== null && i === rows.length - 1;
            return (
              <tr key={i} className={`border-t border-line ${total ? "bg-surface font-semibold" : ""}`}>
                {result.columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${alignRight(c.type) ? "text-right tabular-nums" : ""}`}>{formatCell(c, r[c.key])}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
