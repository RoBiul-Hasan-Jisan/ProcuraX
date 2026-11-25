import { AlertCircle, ChartLine, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils/format";
import type { AssistantAnswer } from "@/types/intelligence";

const KIND = {
  actual: { label: "Actual data", tone: "bg-green-50 text-ok", Icon: CheckCircle2 },
  forecast: { label: "Forecast (prediction)", tone: "bg-amber-50 text-warn", Icon: ChartLine },
  mixed: { label: "Actual data and forecast", tone: "bg-amber-50 text-warn", Icon: ChartLine },
  unavailable: { label: "Data not available", tone: "bg-slate-100 text-slate-600", Icon: AlertCircle },
} as const;

export function AnswerCard({ answer }: { answer: AssistantAnswer }) {
  const k = KIND[answer.kind];
  return (
    <article className="rounded-lg border border-line bg-white p-4 text-sm" aria-label={answer.title}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{answer.title}</h3>
        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${k.tone}`}><k.Icon className="h-3 w-3" />{k.label}</span>
      </header>
      <p>{answer.summary}</p>
      {answer.table && answer.table.rows.length > 0 && (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr>{answer.table.columns.map((c) => <th key={c.key} className="px-2 py-1 font-medium text-slate-600">{c.label}</th>)}</tr></thead>
            <tbody>{answer.table.rows.map((r, i) => <tr key={i} className="border-t border-line">{answer.table!.columns.map((c) => <td key={c.key} className="px-2 py-1">{r[c.key] ?? "-"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {answer.calculation.length > 0 && (
        <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-steel-600">How this was calculated</summary>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{answer.calculation.map((c, i) => <li key={i}>{c}</li>)}</ul></details>
      )}
      {answer.caveats.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{answer.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {answer.references.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Records used: {answer.references.slice(0, 12).map((r) => `${r.type} ${r.label}`).join(", ")}{answer.references.length > 12 ? ` and ${answer.references.length - 12} more` : ""}</p>
      )}
      <footer className="mt-2 text-xs text-slate-400">Answered from live data at {formatDate(answer.asOf, true)}</footer>
    </article>
  );
}
