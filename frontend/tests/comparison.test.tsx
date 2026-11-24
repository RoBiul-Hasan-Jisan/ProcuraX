import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("rfq=rfq1"), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const auth = { permissions: ["rfq:manage", "quotations:compare", "suppliers:evaluate"] };
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ can: (...p: string[]) => p.some((x) => auth.permissions.includes(x)) }) }));

const weights = { price: 30, delivery: 25, quality: 20, leadTime: 15, payment: 10 };
const row = (id: string, name: string, rank: number, total: string, over: Record<string, unknown> = {}) => ({
  quotationId: id, supplierId: `s-${id}`, supplierName: name, status: "submitted", verificationStatus: "verified",
  unitPrices: [{ materialId: "m1", materialName: "Steel Billets", unitPrice: "60000.00", averagePurchasePrice: "50000.00", percentVsAverage: 20, flagged: false }],
  materialCost: total, transportCost: "0.00", additionalCharges: "0.00", taxAmount: "0.00", totalLandedCost: total,
  deliveryDays: 10, paymentTerms: "Net 30", validUntil: new Date(Date.now() + 864e5 * 10).toISOString(), expired: false,
  quality: { completedOrders: 20, onTimeRate: 95, qualityAcceptanceRate: 99 },
  evaluation: { scores: { price: 100, delivery: 95, quality: 99, leadTime: 100, payment: 50 }, overall: 90 - rank, rank, insufficientHistory: false, reasons: ["Lowest total landed cost"], costDifference: rank === 1 ? "0.00" : "600000.00", costDifferencePercent: rank === 1 ? 0 : 10, deliveryDifferenceDays: 0 },
  ...over,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let comparison: any;
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useApi: () => ({ data: comparison, loading: false, error: null, reload: vi.fn(), pagination: null }),
}));

import ComparisonPage from "@/app/(app)/procurement/comparison/page";

beforeEach(() => {
  apiFetch.mockReset();
  auth.permissions = ["rfq:manage", "quotations:compare", "suppliers:evaluate"];
  comparison = {
    rfq: { id: "rfq1", number: "RFQ-2026-0001", status: "closed", deadline: new Date().toISOString(), award: null },
    weights, rawWeights: weights, advisory: "Scores and ranks are decision support only. A procurement manager must select the supplier manually.",
    rows: [
      row("qa", "Alpha Steel", 1, "6000000.00"),
      row("qb", "Beta Metals", 2, "6600000.00", { unitPrices: [{ materialId: "m1", materialName: "Steel Billets", unitPrice: "66000.00", averagePurchasePrice: "50000.00", percentVsAverage: 32, flagged: true }] }),
      row("qc", "Gamma New Co", 3, "6700000.00", { evaluation: { scores: { price: 90, delivery: 50, quality: 50, leadTime: 100, payment: 50 }, overall: 70, rank: 3, insufficientHistory: true, reasons: ["Only 1 completed order(s) on record: reliability is unproven"], costDifference: "700000.00", costDifferencePercent: 11.67, deliveryDifferenceDays: 0 } }),
    ],
  };
});

describe("quotation comparison", () => {
  it("states that scoring is advisory and shows suppliers side by side in rank order", () => {
    render(<ComparisonPage />);
    expect(screen.getByText(/must select the supplier manually/i)).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(headers[1]).toContain("Alpha Steel");
    expect(headers[2]).toContain("Beta Metals");
    expect(headers[3]).toContain("Gamma New Co");
  });

  it("shows exact landed costs and the cost difference to the cheapest", () => {
    render(<ComparisonPage />);
    expect(screen.getAllByText("BDT 6,000,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Lowest")).toBeInTheDocument();
    expect(screen.getByText(/\+BDT 600,000.00 \(10%\)/)).toBeInTheDocument();
  });

  it("flags unproven suppliers and explains why", () => {
    render(<ComparisonPage />);
    expect(screen.getByText("Unproven")).toBeInTheDocument();
    expect(screen.getByText(/reliability is unproven/i)).toBeInTheDocument();
  });

  it("flags a unit price far above the material's average", () => {
    render(<ComparisonPage />);
    expect(screen.getByText(/\+32% vs avg/)).toBeInTheDocument();
  });

  it("selecting the top-ranked supplier needs no justification", async () => {
    apiFetch.mockResolvedValue({ data: {} });
    render(<ComparisonPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Select supplier" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Justification")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm selection" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/quotation-comparisons/rfq1/award");
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ quotationId: "qa" });
  });

  it("requires a written justification to pick a lower-ranked supplier", async () => {
    apiFetch.mockResolvedValue({ data: {} });
    render(<ComparisonPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Select supplier" })[1]);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm selection" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Justification"), "short");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Justification"), " but sufficiently long reason");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ quotationId: "qb", justification: expect.stringContaining("sufficiently long") });
  });

  it("warns when selecting a supplier whose history is unproven", async () => {
    render(<ComparisonPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Select supplier" })[2]);
    expect(within(screen.getByRole("dialog")).getByText(/limited delivery history/i)).toBeInTheDocument();
  });

  it("offers no selection buttons to a viewer without rfq:manage (e.g. finance)", () => {
    auth.permissions = ["quotations:compare"];
    render(<ComparisonPage />);
    expect(screen.queryByRole("button", { name: "Select supplier" })).not.toBeInTheDocument();
    expect(screen.getByText("Overall score")).toBeInTheDocument(); // can still review
  });

  it("offers no selection after the RFQ is awarded", () => {
    comparison.rfq.status = "awarded";
    render(<ComparisonPage />);
    expect(screen.queryByRole("button", { name: "Select supplier" })).not.toBeInTheDocument();
    expect(screen.getByText(/has been awarded/i)).toBeInTheDocument();
  });

  it("disables selecting an expired quotation", () => {
    comparison.rows[0].expired = true;
    render(<ComparisonPage />);
    expect(screen.getByRole("button", { name: "Quotation expired" })).toBeDisabled();
  });

  it("lets a manager preview different weights without saving them", async () => {
    render(<ComparisonPage />);
    await userEvent.clear(screen.getByLabelText(/^Price/));
    await userEvent.type(screen.getByLabelText(/^Price/), "80");
    await userEvent.click(screen.getByRole("button", { name: "Preview with these weights" }));
    expect(apiFetch).not.toHaveBeenCalled(); // preview is a read, never a save
  });

  it("only offers 'Save as default' to those allowed to evaluate suppliers", () => {
    auth.permissions = ["rfq:manage", "quotations:compare"];
    render(<ComparisonPage />);
    expect(screen.queryByRole("button", { name: "Save as default" })).not.toBeInTheDocument();
  });

  it("explains the empty state when nobody quoted", () => {
    comparison.rows = [];
    render(<ComparisonPage />);
    expect(screen.getByText(/No quotations were submitted/)).toBeInTheDocument();
  });
});
