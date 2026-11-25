"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { WEIGHT_KEYS, normalizedShares, validateWeights } from "@/lib/utils/weights";
import type { Weights } from "@/types/procurement";

type Draft = Record<keyof Weights, string>;
const toDraft = (w: Weights): Draft => Object.fromEntries(WEIGHT_KEYS.map(({ key }) => [key, String(w[key])])) as Draft;

export default function SupplierEvaluationPage() {
  const current = useApi<Weights>("/settings/scoring");
  if (current.loading && !current.data) return <LoadingState />;
  if (current.error && !current.data) return <ErrorState message={current.error} onRetry={current.reload} />;
  if (!current.data) return null;
  return <Editor initial={current.data} onSaved={current.reload} />;
}

function Editor({ initial, onSaved }: { initial: Weights; onSaved: () => void }) {
  const { can } = useAuth();
  const [draft, setDraft] = useState<Draft>(toDraft(initial));
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();
  const problem = validateWeights(draft);
  const shares = normalizedShares(draft);
  const canEdit = can("suppliers:evaluate");
  const save = () => run(async () => {
    const body = Object.fromEntries(WEIGHT_KEYS.map(({ key }) => [key, Number(draft[key])]));
    await apiFetch("/settings/scoring", { method: "PUT", body: JSON.stringify(body) });
    setSaved(true); onSaved();
  });

  return (
    <>
      <PageHeader title="Supplier Evaluation" subtitle="How quotations are scored on the comparison page. The score is decision support only; awarding a supplier is always a manual decision." />
      <Card>
        <CardHeader title="Scoring weights" />
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); setSaved(false); if (!problem) void save(); }}>
          <div className="grid gap-4 md:grid-cols-2">
            {WEIGHT_KEYS.map(({ key, label, help }) => (
              <Field key={key} label={`${label} weight`} htmlFor={`w-${key}`} hint={`${help} Carries ${shares[key]}% of the score.`}>
                <Input id={`w-${key}`} inputMode="decimal" value={draft[key]} disabled={!canEdit} onChange={(e) => { setSaved(false); setDraft({ ...draft, [key]: e.target.value }); }} />
              </Field>
            ))}
          </div>
          <p className="text-xs text-slate-500">Weights are relative: they are rescaled so the shares add up to 100%. Each criterion is scored 0 to 100 and the total is the weighted average. Suppliers with fewer than 5 completed orders have no proven history and get a neutral (50) history score, so a new supplier is never treated as reliable.</p>
          {problem && <Notice tone="error">{problem}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {saved && <Notice tone="success">Weights saved. The change is recorded in the audit log.</Notice>}
          {canEdit ? <Button type="submit" disabled={pending || !!problem}>{pending ? "Saving…" : "Save weights"}</Button> : <Notice tone="info">You can view the weights but not change them.</Notice>}
        </form>
      </Card>
    </>
  );
}
