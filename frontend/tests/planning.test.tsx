import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ can: (p: string) => ["mrp:run", "mrp:view", "production:manage"].includes(p) }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...r}>{children}</a> }));

import MrpPage from "@/app/(app)/planning/mrp/page";
import { BomDialog } from "@/features/planning/BomDialog";
import { MrpRunView, mrpCsv } from "@/features/planning/MrpRunView";
import { PlanDialog } from "@/features/planning/PlanDialog";
import { toCsv } from "@/lib/utils/csv";
import type { MrpResult, MrpRun } from "@/types/planning";

const PRODUCTS = [{ id: "p1", code: "TMT12", name: "TMT Bar 12mm", unit: "MT", description: "", intermediate: false, active: true }, { id: "p2", code: "BIL-IH", name: "In-house Billet", unit: "MT", description: "", intermediate: true, active: true }];
const MATERIALS = [{ id: "m1", sku: "BIL-130", name: "Steel Billet 130mm", unit: "MT" }, { id: "m2", sku: "FER-SIMN", name: "Silico Manganese", unit: "MT" }];
const PLANS = [{ id: "pl1", number: "PP-2026-0001", status: "confirmed", quantity: "500.000", unit: "MT", startDate: "2026-12-10T00:00:00Z", endDate: "2026-12-20T00:00:00Z", notes: "", product: { id: "p1", code: "TMT12", name: "TMT Bar 12mm" } }];

const result = (over: Partial<MrpResult> = {}): MrpResult => ({
  id: "r1", material: "m1", sku: "BIL-130", name: "Steel Billet 130mm", category: "Steel Billets", unit: "MT", grossRequirement: "510.000", adjustedRequirement: "535.500",
  onHand: "100.000", reservedOther: "20.000", reservedForPlans: "0.000", available: "80.000", scheduledReceiptsTotal: "50.000", scheduledReceiptsUsed: "50.000", safetyStock: "25.000", netRequirement: "430.500",
  plannedOrders: [{ needDate: "2026-12-10T00:00:00Z", quantity: "430.500", releaseDate: "2026-11-26T00:00:00Z", expectedArrival: "2026-12-10T00:00:00Z", late: false, daysLate: 0, urgency: "high" }],
  firstNeedDate: "2026-12-10T00:00:00Z", urgency: "high", leadTimeDays: 14, leadTimeAssumed: false, preferredSupplier: { id: "s1", name: "Karnaphuli Metals" }, supplierNote: null,
  exceedsSupplierCapacity: false, ordersNeededForCapacity: null, estimatedCost: "29,000.00".replace(",", ""),
  demands: [], receipts: [{ reference: "PO-2026-0004", date: "2026-12-01T00:00:00Z", quantity: "50.000" }], lateReceipts: [],
  explanation: ["PP-2026-0001: 510.000 gross, 535.500 after wastage.", "By 2026-12-10: shortfall 430.500."], ...over,
});
const RUN = (over: Partial<MrpRun> = {}): MrpRun => ({
  id: "run1", number: "MRP-2026-0001", runDate: "2026-11-25T00:00:00Z", horizonDays: 30, status: "completed", createdByName: "Buyer", issues: [],
  summary: { materials: 2, withShortage: 1, covered: 1, critical: 0, high: 1, medium: 0, low: 0, capacityWarnings: 0, noEligibleSupplier: 0, estimatedCost: "29000.00", estimatedCostNote: "Net requirement x average price." },
  inputs: { plans: [{ number: "PP-2026-0001", product: "TMT Bar 12mm", quantity: "500.000", unit: "MT", startDate: "2026-12-10T00:00:00Z", status: "confirmed" }], excludedPlans: [], bomsUsed: [{ number: "BOM-2026-0001", version: 2 }] },
  results: [result(), result({ id: "r2", material: "m2", sku: "FER-SIMN", name: "Silico Manganese", netRequirement: "0.000", urgency: null, plannedOrders: [], explanation: ["Existing stock covers the demand."] })], ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith("/finished-products")) return { data: PRODUCTS, pagination: null };
    if (path.startsWith("/materials")) return { data: MATERIALS, pagination: null };
    if (path === "/settings/mrp") return { data: { horizonDays: 45, defaultLeadTimeDays: 14, urgency: { highDays: 3, mediumDays: 10 }, reorder: { lookbackDays: 90, coverageDays: 30 } }, pagination: null };
    if (path.startsWith("/production-plans")) return { data: path.includes("status=confirmed") ? PLANS : [], pagination: null };
    if (path === "/mrp/run") return { data: RUN(), pagination: null };
    return { data: init?.method === "POST" ? { id: "x" } : [], pagination: null };
  });
});
const posts = (p: string) => apiFetch.mock.calls.filter((c) => c[0] === p && c[1]?.method);

describe("CSV export", () => {
  it("quotes commas and quotes, and neutralises spreadsheet formulas", () => {
    const out = toCsv([["a,b", 'say "hi"', "=HYPERLINK(\"x\")", "+1", "-5", 5, "@cmd", null]]);
    expect(out).toBe('"a,b","say ""hi""","\'=HYPERLINK(""x"")",\'+1,-5,5,\'@cmd,');
  });
  it("keeps negative numbers and decimals intact", () => {
    expect(toCsv([["-12.5", "0.0008"]])).toBe("-12.5,0.0008");
  });
  it("exports one row per material with the columns the spec lists", () => {
    const csv = mrpCsv(RUN(), RUN().results!);
    const lines = csv.split("\r\n");
    expect(lines[2]).toContain("Gross requirement");
    expect(lines[2]).toContain("Net requirement / suggested quantity");
    expect(lines).toHaveLength(5); // title, blank, header, two materials
    expect(lines[3]).toContain("BIL-130");
    expect(lines[3]).toContain("430.500");
    expect(lines[3]).toContain("Karnaphuli Metals");
    expect(lines[4]).toContain("covered");
  });
});

describe("MRP run view", () => {
  it("shows the summary, per-material figures and urgency", () => {
    render(<MrpRunView run={RUN()} />);
    expect(screen.getByText("Need procurement")).toBeInTheDocument();
    expect(screen.getByText("Steel Billet 130mm")).toBeInTheDocument();
    expect(screen.getByText("430.5")).toBeInTheDocument();
    expect(screen.getByText("Covered")).toBeInTheDocument(); // the row with nothing to buy
    expect(screen.getAllByText(/Karnaphuli Metals/).length).toBeGreaterThan(0);
  });
  it("explains a row on demand", async () => {
    render(<MrpRunView run={RUN()} />);
    expect(screen.queryByText(/shortfall 430.500/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explain Steel Billet 130mm" }));
    expect(screen.getByText(/shortfall 430.500/)).toBeInTheDocument();
    expect(screen.getByText(/PO-2026-0004/)).toBeInTheDocument();
  });
  it("makes problems and exclusions visible, never silent", () => {
    render(<MrpRunView run={RUN({ status: "completed_with_issues", issues: [{ plan: "PP-2026-0002", message: "No active BOM effective on 2026-12-01 for Wire Rod" }],
      inputs: { ...RUN().inputs!, excludedPlans: [{ plan: "PP-2026-0003", reason: "Starts after the 30-day planning horizon" }] } })} />);
    expect(screen.getByText(/1 problem\(s\) in this run/)).toBeInTheDocument();
    expect(screen.getByText(/No active BOM/)).toBeInTheDocument();
    expect(screen.getByText(/PP-2026-0003/)).toBeInTheDocument();
  });
  it("flags materials that need ordering but have no eligible supplier", () => {
    render(<MrpRunView run={RUN({ results: [result({ preferredSupplier: null, supplierNote: "No preferred supplier is set" })] })} />);
    expect(screen.getByText("None eligible")).toBeInTheDocument();
  });
  it("shows a late order as late", () => {
    const late = result({ plannedOrders: [{ needDate: "2026-12-10T00:00:00Z", quantity: "10.000", releaseDate: "2026-11-25T00:00:00Z", expectedArrival: "2026-12-20T00:00:00Z", late: true, daysLate: 10, urgency: "critical" }], urgency: "critical" });
    render(<MrpRunView run={RUN({ results: [late] })} />);
    expect(screen.getByText(/10d late/)).toBeInTheDocument();
  });
  it("tells the person when an assumed lead time was used", () => {
    render(<MrpRunView run={RUN({ results: [result({ leadTimeAssumed: true })] })} />);
    expect(screen.getByText(/14d lead \(assumed\)/)).toBeInTheDocument();
  });
  it("lists the inputs the run used", () => {
    render(<MrpRunView run={RUN()} />);
    expect(screen.getByText(/BOM-2026-0001 v2/)).toBeInTheDocument();
    expect(screen.getByText(/PP-2026-0001: 500 MT TMT Bar 12mm/)).toBeInTheDocument();
  });
});

describe("MRP page", () => {
  it("cannot run until a plan is chosen", async () => {
    render(<MrpPage />);
    const btn = await screen.findByRole("button", { name: /run mrp/i });
    expect(btn).toBeDisabled();
    await userEvent.click(await screen.findByLabelText("Include PP-2026-0001"));
    expect(btn).toBeEnabled();
  });
  it("defaults the horizon from settings and sends the chosen plans", async () => {
    render(<MrpPage />);
    await userEvent.click(await screen.findByLabelText("Include PP-2026-0001"));
    await waitFor(() => expect(screen.getByLabelText(/planning horizon/i)).toHaveValue("45"));
    await userEvent.click(screen.getByRole("button", { name: /run mrp/i }));
    await waitFor(() => expect(posts("/mrp/run")).toHaveLength(1));
    expect(JSON.parse(posts("/mrp/run")[0][1].body)).toEqual({ planIds: ["pl1"], horizonDays: 45 });
    expect(await screen.findByText("MRP-2026-0001")).toBeInTheDocument();
  });
  it("rejects an invalid horizon without calling the API", async () => {
    render(<MrpPage />);
    await userEvent.click(await screen.findByLabelText("Include PP-2026-0001"));
    const h = screen.getByLabelText(/planning horizon/i);
    await userEvent.clear(h);
    await userEvent.type(h, "0");
    expect(screen.getByRole("button", { name: /run mrp/i })).toBeDisabled();
    expect(posts("/mrp/run")).toHaveLength(0);
  });
  it("shows a server error from the run", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/mrp/run") throw new Error("None of the selected plans start inside the planning horizon");
      if (path === "/settings/mrp") return { data: { horizonDays: 30, defaultLeadTimeDays: 14, urgency: { highDays: 3, mediumDays: 10 }, reorder: { lookbackDays: 90, coverageDays: 30 } }, pagination: null };
      return { data: path.includes("status=confirmed") ? PLANS : [], pagination: null };
    });
    render(<MrpPage />);
    await userEvent.click(await screen.findByLabelText("Include PP-2026-0001"));
    await userEvent.click(screen.getByRole("button", { name: /run mrp/i }));
    expect(await screen.findByText(/inside the planning horizon/)).toBeInTheDocument();
  });
});

describe("plan dialog", () => {
  it("validates before calling the API", async () => {
    render(<PlanDialog plan={null} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
    expect(await screen.findByText("Choose a finished product")).toBeInTheDocument();
    expect(posts("/production-plans")).toHaveLength(0);
  });
  it("rejects a completion date before the start date", async () => {
    render(<PlanDialog plan={null} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText("Finished product"), "p1");
    await userEvent.type(screen.getByLabelText(/Production quantity/), "100");
    await userEvent.type(screen.getByLabelText(/Start date/), "2026-12-10");
    await userEvent.type(screen.getByLabelText(/Expected completion/), "2026-12-01");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
    expect(await screen.findByText(/cannot be before the start date/)).toBeInTheDocument();
  });
  it("rejects zero and non-numeric quantities", async () => {
    render(<PlanDialog plan={null} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText("Finished product"), "p1");
    await userEvent.type(screen.getByLabelText(/Production quantity/), "0");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
    expect(await screen.findByText(/greater than zero/)).toBeInTheDocument();
  });
  it("posts a valid plan", async () => {
    const done = vi.fn();
    render(<PlanDialog plan={null} onClose={vi.fn()} onDone={done} />);
    await userEvent.selectOptions(await screen.findByLabelText("Finished product"), "p1");
    await userEvent.type(screen.getByLabelText(/Production quantity/), "500");
    await userEvent.type(screen.getByLabelText(/Start date/), "2026-12-10");
    await userEvent.type(screen.getByLabelText(/Expected completion/), "2026-12-20");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(JSON.parse(posts("/production-plans")[0][1].body)).toMatchObject({ productId: "p1", quantity: "500", startDate: "2026-12-10", endDate: "2026-12-20" });
  });
});

describe("BOM dialog", () => {
  const open = async () => {
    render(<BomDialog bom={null} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText("Finished product"), "p1");
    await screen.findByRole("option", { name: /BIL-130/ });
  };
  it("requires a component and a quantity", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/Component 1: choose a material/)).toBeInTheDocument();
    expect(posts("/boms")).toHaveLength(0);
  });
  it("accepts up to 6 decimals per unit but not 7", async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Component 1"), "m1");
    await userEvent.type(screen.getByLabelText("Quantity 1"), "0.1234567");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/max 6 decimals/)).toBeInTheDocument();
  });
  it("rejects wastage above 100 and duplicate components", async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Component 1"), "m1");
    await userEvent.type(screen.getByLabelText("Quantity 1"), "1");
    await userEvent.clear(screen.getByLabelText("Wastage 1"));
    await userEvent.type(screen.getByLabelText("Wastage 1"), "101");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/between 0 and 100/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Wastage 1"));
    await userEvent.type(screen.getByLabelText("Wastage 1"), "2");
    await userEvent.click(screen.getByRole("button", { name: /add component/i }));
    await userEvent.selectOptions(screen.getByLabelText("Component 2"), "m1");
    await userEvent.type(screen.getByLabelText("Quantity 2"), "1");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/listed twice/)).toBeInTheDocument();
  });
  it("a product cannot be a component of itself", async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Type 1"), "product");
    expect(within(screen.getByLabelText("Component 1")).queryByRole("option", { name: /TMT12/ })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Component 1")).getByRole("option", { name: /BIL-IH/ })).toBeInTheDocument();
  });
  it("posts materials and sub-products in the shape the API expects", async () => {
    const done = vi.fn();
    render(<BomDialog bom={null} onClose={vi.fn()} onDone={done} />);
    await userEvent.selectOptions(await screen.findByLabelText("Finished product"), "p1");
    await screen.findByRole("option", { name: /BIL-130/ });
    await userEvent.selectOptions(screen.getByLabelText("Component 1"), "m1");
    await userEvent.type(screen.getByLabelText("Quantity 1"), "1.02");
    await userEvent.clear(screen.getByLabelText("Wastage 1"));
    await userEvent.type(screen.getByLabelText("Wastage 1"), "5");
    await userEvent.click(screen.getByRole("button", { name: /add component/i }));
    await userEvent.selectOptions(screen.getByLabelText("Type 2"), "product");
    await userEvent.selectOptions(screen.getByLabelText("Component 2"), "p2");
    await userEvent.type(screen.getByLabelText("Quantity 2"), "0.5");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const body = JSON.parse(posts("/boms")[0][1].body);
    expect(body.items).toEqual([
      { materialId: "m1", subProductId: null, quantity: "1.02", wastagePercent: "5" },
      { materialId: null, subProductId: "p2", quantity: "0.5", wastagePercent: "0" },
    ]);
    expect(body.items[0]).not.toHaveProperty("unit"); // the server takes units from the catalogue
  });
});
