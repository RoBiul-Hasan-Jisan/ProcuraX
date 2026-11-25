"use client";

import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AnswerCard } from "@/features/intelligence/AnswerCard";
import { useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import type { AssistantAnswer, AssistantTurn } from "@/types/intelligence";

interface HistoryRow { id: string; question: string; answer: AssistantAnswer; createdAt: string }

export default function AssistantPage() {
  const suggestions = useApi<string[]>("/assistant/suggestions");
  const history = useApi<HistoryRow[]>("/assistant/history");
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (history.data && !loaded.current) { loaded.current = true; setTurns(history.data.map((h) => ({ id: h.id, question: h.question, answer: h.answer, createdAt: h.createdAt }))); }
  }, [history.data]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [turns, busy]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setBusy(true); setQuestion("");
    const id = `t${Date.now()}`;
    try {
      const res = await apiFetch<AssistantAnswer>("/assistant/query", { method: "POST", body: JSON.stringify({ question: text }) });
      setTurns((t) => [...t, { id, question: text, answer: res.data }]);
    } catch (e) {
      setTurns((t) => [...t, { id, question: text, answer: null, error: e instanceof Error ? e.message : "Request failed" }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="AI Procurement Assistant" subtitle="Ask about stock, suppliers, orders, invoices, spend and expected demand. Answers come from your own data through fixed queries." />
      <Notice tone="info">This assistant matches your question to a set of built-in business queries. It does not use an external AI service, it cannot run arbitrary queries, and when the data needed does not exist it says so instead of estimating.</Notice>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggested questions">
        {(suggestions.data ?? []).map((s) => <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="rounded-full border border-line bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">{s}</button>)}
      </div>
      <div className="mt-4 space-y-4" aria-live="polite">
        {turns.length === 0 && !history.loading && <p className="text-sm text-slate-500">No questions yet. Pick a suggestion or type your own below.</p>}
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="ml-auto max-w-xl rounded-lg bg-steel-600 px-3 py-2 text-sm text-white">{t.question}</div>
            {t.answer ? <AnswerCard answer={t.answer} /> : <Notice tone="error">{t.error}</Notice>}
          </div>
        ))}
        {busy && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking up your data…</div>}
        <div ref={end} />
      </div>
      <form className="sticky bottom-0 mt-4 flex gap-2 bg-white/90 py-3" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        <Input aria-label="Your question" placeholder="Ask a procurement question…" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" disabled={busy || question.trim().length < 3} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </>
  );
}
