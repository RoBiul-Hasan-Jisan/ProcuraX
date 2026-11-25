export interface WeeklyForecast { weekStart: string; point: number; low: number; high: number }
export interface Candidate { model: string; status: "evaluated" | "skipped"; reason?: string; mae?: number; rmse?: number; mape?: number | null; folds?: number }
export interface DemandResult {
  status: "ok" | "insufficient_data"; reason?: string; modelVersion: string; isForecast: true; historyWeeks: number;
  selectedModel?: string; candidates?: Candidate[]; horizons?: { days: number; total: number; low: number; high: number }[];
  weekly?: WeeklyForecast[]; historyStart?: string; historyEnd?: string; interval?: { level: number; method: string }; notes?: string[];
}
export interface PriceResult {
  status: "ok" | "insufficient_data"; reason?: string; modelVersion: string; isForecast: true;
  method?: string; observations?: number; spanDays?: number; lastPrice?: number; slopePerDay?: number; r2?: number;
  horizons?: { days: number; price: number; low: number; high: number; changePercent: number | null }[]; interval?: { level: number; method: string }; notes?: string[];
}
export interface StoredForecast<R> {
  id: string; material: string; sku: string; materialName: string; unit: string; status: "ok" | "insufficient_data"; reason: string | null;
  modelVersion: string; isForecast: true; asOf: string; createdAt: string; generatedByName: string | null; result: R;
}
export interface MaterialForecastView {
  material: { id: string; sku: string; name: string; unit: string };
  actualConsumption: { kind: "actual"; weekStart: string; weeks: number[] };
  priceHistory: { kind: "actual"; observations: { date: string; price: number; source: string }[] };
  demandForecast: StoredForecast<DemandResult> | null;
  priceForecast: StoredForecast<PriceResult> | null;
}

export type Severity = "critical" | "high" | "medium" | "low";
export type RiskStatus = "open" | "acknowledged" | "investigating" | "resolved" | "dismissed";
export interface RiskAlert {
  _id: string; number: string; category: string; severity: Severity; title: string; status: RiskStatus; detectedAt: string;
  material?: { id: string; name: string; sku?: string }; supplier?: { id: string; name: string }; reference?: { kind: string; id: string; number?: string };
  reason: string; evidence: Record<string, unknown>; recommendedAction: string; assignedToName: string; resolutionNote: string;
  history: { at: string; by: string; from: string; to: string; note: string }[];
}

export interface AssistantAnswer {
  intent: string; title: string; summary: string; kind: "actual" | "forecast" | "mixed" | "unavailable"; available: boolean;
  table: { columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] } | null;
  references: { type: string; id: string; label: string }[]; calculation: string[]; caveats: string[]; asOf: string;
}
export interface AssistantTurn { id: string; question: string; answer: AssistantAnswer | null; error?: string; createdAt?: string }

export interface SupplierScoreRow {
  supplierId: string; code: string; name: string; status: string; verification: string; completedOrders: number;
  onTimePercent: number | null; qualityPercent: number | null; proven: boolean; historyScore: number | null; note: string | null;
}
