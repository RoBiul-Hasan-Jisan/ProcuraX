import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
let perms: string[] = ["intelligence:view", "risks:review", "mrp:run", "forecasting:view", "suppliers:view"];
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ can: (p: string) => perms.includes(p), user: { id: "me1" } }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...r}>{children}</a> }));
// Recharts needs real layout; the chart itself is not what these tests check.
vi.mock("recharts", async () => {
  const R = await vi.importActual<Record<string, unknown>>("recharts");
  return { ...R, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div> };
});

import AssistantPage from "@/app/(app)/intelligence/assistant/page";
import RisksPage from "@/app/(app)/intelligence/risks/page";
import ForecastingPage from "@/app/(app)/planning/forecasting/page";
import SupplierPerformancePage from "@/app/(app)/suppliers/performance/page";
import { AnswerCard } from "@/features/intelligence/AnswerCard";
import { buildForecastSeries } from "@/lib/utils/forecast";
import { NEXT_STATUSES } from "@/lib/utils/risk";
import type { AssistantAnswer, MaterialForecastView, RiskAlert } from "@/types/intelligence";

const answer = (over: Partial<AssistantAnswer> = {}): AssistantAnswer => ({
  intent: "below_reorder", title: "Materials at or below reorder level", summary: "2 material(s) are at or below a configured level.", kind: "actual", available: true,
  table: { columns: [{ key: "sku", label: "SKU" }, { key: "total", label: "In stock" }], rows: [{ sku: "SCR-HMS", total: "10.000" }, { sku: "FER-SIMN", total: "3.000" }] },
  references: [{ type: "Material", id: "m1", label: "SCR-HMS" }], calculation: ["Status is critical if stock <= safety stock."], caveats: ["Only active materials."], asOf: "2026-11-25T06:00:00Z", ...over,
});

describe("forecast series", () => {
  it("keeps actual and forecast in separate fields, joins the lines once, and gives actual points no band", () => {
    const s = buildForecastSeries("2026-10-05", [10, 12, 11], [{ weekStart: "2026-10-26", point: 11, low: 8, high: 14 }, { weekStart: "2026-11-02", point: 11, low: 7, high: 15 }]);
    expect(s.map((p) => p.label)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    expect(s[2]).toMatchObject({ actual: 11, forecast: 11, band: null }); // join point: no uncertainty drawn on a known value
    expect(s[3]).toMatchObject({ actual: null, forecast: 11, band: [8, 14] });
    expect(s[0].forecast).toBeNull();
  });
  it("shows only the most recent actual weeks and keeps their dates correct", () => {
    const s = buildForecastSeries("2026-01-05", Array.from({ length: 40 }, (_, i) => i), [], 4);
    expect(s).toHaveLength(4); expect(s[3].actual).toBe(39); expect(s[0].label).toBe("2026-09-14"); // 36 weeks (252 days) after 5 Jan
  });
  it("draws no forecast line when there is no forecast", () => { expect(buildForecastSeries("2026-10-05", [1, 2], []).every((p) => p.forecast === null)).toBe(true); });
});

describe("risk workflow buttons", () => {
  it("offer only the moves the server allows", () => {
    expect(NEXT_STATUSES.open).not.toContain("resolved");
    expect(NEXT_STATUSES.resolved).toEqual([]);
    expect(NEXT_STATUSES.investigating).toEqual(["resolved", "dismissed"]);
  });
});

describe("AnswerCard", () => {
  it("labels actual data, shows the table, calculation and records used", () => {
    render(<AnswerCard answer={answer()} />);
    expect(screen.getByText("Actual data")).toBeInTheDocument();
    expect(screen.getByText("SCR-HMS")).toBeInTheDocument();
    expect(screen.getByText("How this was calculated")).toBeInTheDocument();
    expect(screen.getByText(/Records used: Material SCR-HMS/)).toBeInTheDocument();
  });
  it("labels forecasts as predictions and unavailable data as unavailable", () => {
    const { rerender } = render(<AnswerCard answer={answer({ kind: "forecast" })} />);
    expect(screen.getByText("Forecast (prediction)")).toBeInTheDocument();
    rerender(<AnswerCard answer={answer({ kind: "unavailable", available: false, table: null, summary: "No demand forecast has been generated yet." })} />);
    expect(screen.getByText("Data not available")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("assistant page", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/assistant/suggestions") return { data: ["Which purchase orders are delayed?"], pagination: null };
      if (path === "/assistant/history") return { data: [{ id: "h1", question: "Earlier question", answer: answer({ title: "Earlier answer" }), createdAt: "2026-11-24T00:00:00Z" }], pagination: null };
      if (path === "/assistant/query") return { data: answer({ title: "Delayed purchase orders", summary: "1 purchase order is late." }), pagination: null, _body: init?.body };
      return { data: [], pagination: null };
    });
  });
  it("loads history, answers a suggested question, and posts exactly that question", async () => {
    render(<AssistantPage />);
    expect(await screen.findByText("Earlier question")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Which purchase orders are delayed?" }));
    expect(await screen.findByText("1 purchase order is late.")).toBeInTheDocument();
    const call = apiFetch.mock.calls.find((c) => c[0] === "/assistant/query")!;
    expect(JSON.parse(call[1].body)).toEqual({ question: "Which purchase orders are delayed?" });
  });
  it("will not send a too-short question and shows a server error instead of a fake answer", async () => {
    render(<AssistantPage />);
    const send = await screen.findByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Your question"), "why price?");
    apiFetch.mockImplementationOnce(async () => { throw new Error("Service down"); });
    await userEvent.click(send);
    expect(await screen.findByText("Service down")).toBeInTheDocument();
  });
});

const ALERT: RiskAlert = {
  _id: "a1", number: "RSK-2026-0001", category: "delayed_po", severity: "high", title: "PO PO-2026-0003 is 20 day(s) overdue", status: "open", detectedAt: "2026-11-25T00:00:00Z",
  supplier: { id: "s1", name: "Alpha Steel" }, reason: "The order is issued and was expected on 2026-11-05.", evidence: { daysLate: 20, expectedDeliveryDate: "2026-11-05" },
  recommendedAction: "Contact the supplier for a revised date.", assignedToName: "", resolutionNote: "", history: [{ at: "2026-11-25T00:00:00Z", by: "System scan", from: "", to: "open", note: "" }],
};
describe("risk page", () => {
  beforeEach(() => {
    perms = ["intelligence:view", "risks:review"];
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/risk-alerts?")) return { data: [ALERT], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, unresolved: { critical: 0, high: 1, medium: 0, low: 0 } } };
      if (path === "/risk-alerts/scan") return { data: { detected: 3, created: 1, alreadyKnown: 2 }, pagination: null };
      return { data: {}, pagination: null };
    });
  });
  it("shows counts and the alert, and the detail dialog explains why with evidence", async () => {
    render(<RisksPage />);
    expect(await screen.findByText(ALERT.title)).toBeInTheDocument();
    expect(screen.getByText("Unresolved high").previousSibling).toHaveTextContent("1");
    await userEvent.click(screen.getByText(ALERT.title));
    expect(await screen.findByText("Why it was flagged")).toBeInTheDocument();
    expect(screen.getByText("Contact the supplier for a revised date.")).toBeInTheDocument();
    expect(screen.getByText("days late")).toBeInTheDocument();
  });
  it("cannot resolve or dismiss without a written note, and posts the review when allowed", async () => {
    apiFetch.mockImplementation(async (path: string) => path.startsWith("/risk-alerts?") ? { data: [{ ...ALERT, status: "investigating" }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, unresolved: {} } } : { data: {}, pagination: null });
    render(<RisksPage />);
    await userEvent.click(await screen.findByText(ALERT.title));
    const resolve = await screen.findByRole("button", { name: "Resolve" });
    expect(resolve).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Note/), "Supplier confirmed delivery on 28 Nov.");
    expect(resolve).toBeEnabled();
    await userEvent.click(resolve);
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === "/risk-alerts/a1/review")).toBe(true));
    const body = JSON.parse(apiFetch.mock.calls.find((c) => c[0] === "/risk-alerts/a1/review")![1].body);
    expect(body).toEqual({ status: "resolved", note: "Supplier confirmed delivery on 28 Nov." });
  });
  it("read-only users see no scan button and no review controls", async () => {
    perms = ["intelligence:view"];
    render(<RisksPage />);
    expect(screen.queryByRole("button", { name: /detection scan/i })).toBeNull();
    await userEvent.click(await screen.findByText(ALERT.title));
    expect(await screen.findByText(/only procurement managers and administrators/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
  });
  it("a scan reports what it found", async () => {
    render(<RisksPage />);
    await userEvent.click(await screen.findByRole("button", { name: /run detection scan/i }));
    expect(await screen.findByText(/3 condition\(s\) found: 1 new alert\(s\), 2 already known/)).toBeInTheDocument();
  });
});

const VIEW = (over: Partial<MaterialForecastView> = {}): MaterialForecastView => ({
  material: { id: "m1", sku: "SCR-HMS", name: "HMS Scrap", unit: "MT" },
  actualConsumption: { kind: "actual", weekStart: "2026-01-05", weeks: [10, 11, 12, 10, 11, 12, 10, 11] },
  priceHistory: { kind: "actual", observations: [] }, demandForecast: null, priceForecast: null, ...over,
});
describe("forecasting page", () => {
  const setup = (view: MaterialForecastView) => {
    perms = ["forecasting:view", "mrp:run"];
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/materials")) return { data: [{ id: "m1", sku: "SCR-HMS", name: "[DEMO] HMS Scrap", unit: "MT" }], pagination: null };
      if (path.startsWith("/forecasting/material/")) return { data: view, pagination: null };
      return { data: {}, pagination: null };
    });
  };
  it("asks for a material first", async () => {
    setup(VIEW());
    render(<ForecastingPage />);
    expect(screen.getByText(/Choose a material to see/)).toBeInTheDocument();
  });
  it("says plainly that there is no forecast yet, and offers generation to those allowed", async () => {
    setup(VIEW());
    render(<ForecastingPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Material"), "m1");
    expect(await screen.findByText(/No forecast has been generated for this material yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate demand forecast" })).toBeInTheDocument();
  });
  it("shows insufficient data with the reason, not numbers", async () => {
    setup(VIEW({ demandForecast: { id: "f1", material: "m1", sku: "SCR-HMS", materialName: "HMS Scrap", unit: "MT", status: "insufficient_data", reason: "Need at least 8 weeks", modelVersion: "v1", isForecast: true, asOf: "2026-11-25T00:00:00Z", createdAt: "2026-11-25T00:00:00Z", generatedByName: "Buyer", result: { status: "insufficient_data", reason: "Need at least 8 weeks of history; found 3.", modelVersion: "v1", isForecast: true, historyWeeks: 3 } } }));
    render(<ForecastingPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Material"), "m1");
    expect(await screen.findByText(/Not enough data to forecast: Need at least 8 weeks of history; found 3\./)).toBeInTheDocument();
    expect(screen.queryByText("Forecast demand by horizon")).toBeNull();
  });
  it("shows horizons with ranges, backtest metrics, skipped models with reasons, and the forecast label", async () => {
    setup(VIEW({ demandForecast: { id: "f1", material: "m1", sku: "SCR-HMS", materialName: "HMS Scrap", unit: "MT", status: "ok", reason: null, modelVersion: "2026.11-1", isForecast: true, asOf: "2026-11-25T00:00:00Z", createdAt: "2026-11-25T00:00:00Z", generatedByName: "Buyer",
      result: { status: "ok", modelVersion: "2026.11-1", isForecast: true, historyWeeks: 52, selectedModel: "exponential_smoothing", horizons: [{ days: 7, total: 11, low: 8, high: 14 }, { days: 30, total: 47.1, low: 38, high: 56 }],
        weekly: [{ weekStart: "2026-11-30", point: 11, low: 8, high: 14 }], candidates: [{ model: "moving_average", status: "evaluated", mae: 1.2, rmse: 1.5, mape: 10.4, folds: 8 }, { model: "exponential_smoothing", status: "evaluated", mae: 1.0, rmse: 1.3, mape: null, folds: 8 }, { model: "xgboost", status: "skipped", reason: "needs 30 weeks of history, have 12" }], interval: { level: 0.8, method: "normal approximation" } } } }));
    render(<ForecastingPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Material"), "m1");
    expect(await screen.findByText("Next 30 days")).toBeInTheDocument();
    expect(screen.getByText("38 to 56")).toBeInTheDocument();
    expect(screen.getByText("n/a (zero actuals)")).toBeInTheDocument();
    expect(screen.getByText(/Not used: needs 30 weeks of history, have 12/)).toBeInTheDocument();
    expect(screen.getByText("selected")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText(/Forecast = model prediction/)).toBeInTheDocument();
  });
  it("hides the generate buttons from people who cannot run forecasts", async () => {
    setup(VIEW()); perms = ["forecasting:view"];
    render(<ForecastingPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Material"), "m1");
    expect(await screen.findByText(/A procurement manager can generate one/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate/ })).toBeNull();
  });
  it("generating posts the chosen material and reloads", async () => {
    setup(VIEW());
    render(<ForecastingPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Material"), "m1");
    await userEvent.click(await screen.findByRole("button", { name: "Generate demand forecast" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === "/forecasting/demand")).toBe(true));
    expect(JSON.parse(apiFetch.mock.calls.find((c) => c[0] === "/forecasting/demand")![1].body)).toEqual({ materialId: "m1" });
  });
});

describe("supplier performance page", () => {
  it("shows no score for unproven suppliers", async () => {
    perms = ["suppliers:view"];
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ data: { minHistoryOrders: 5, rows: [
      { supplierId: "1", code: "SUP-1", name: "Alpha", status: "active", verification: "verified", completedOrders: 20, onTimePercent: 90, qualityPercent: 98, proven: true, historyScore: 94, note: null },
      { supplierId: "2", code: "SUP-2", name: "Newco", status: "active", verification: "verified", completedOrders: 2, onTimePercent: 100, qualityPercent: 100, proven: false, historyScore: null, note: "Only 2 completed order(s); at least 5 are needed before reliability is rated." },
    ] }, pagination: null });
    render(<SupplierPerformancePage />);
    expect(await screen.findByText("94")).toBeInTheDocument();
    expect(screen.getByText("Unproven")).toBeInTheDocument();
    expect(screen.getByText(/at least 5 are needed/)).toBeInTheDocument();
  });
});
