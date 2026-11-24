import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
import { InvoiceDialog } from "@/features/purchasing/InvoiceDialog";
import { ReceiptDialog } from "@/features/purchasing/ReceiptDialog";
import { StockActionDialog } from "@/features/purchasing/StockActionDialog";
import { cmp, remaining } from "@/lib/utils/decimal";
import type { PurchaseOrder, StockRow } from "@/types/purchasing";

const po: PurchaseOrder = {
  id: "po1", number: "PO-2026-0001", status: "partially_received", currency: "BDT", rfqId: "r", rfqNumber: "RFQ-1", requisitionId: "q", requisitionNumber: "PR-1",
  supplier: { id: "s1", name: "Alpha Steel" },
  lines: [{ materialId: "m1", materialName: "Steel Billets 150mm", sku: "BIL-150", unit: "MT", quantity: "100.000", unitPrice: "100.00", lineTotal: "10000.00", acceptedQty: "40.000", rejectedQty: "0.000", invoicedQty: "10.000" }],
  materialCost: "10000.00", transportCost: "500.00", additionalCharges: "0.00", taxRatePercent: "5", taxAmount: "500.00", totalAmount: "11000.00",
  paymentTerms: "Net 30", paymentTermsDays: 30, deliveryLocation: "Yard", deliveryDays: 10, expectedDeliveryDate: null, issuedAt: null, lastReceiptAt: null, closeReason: null, createdAt: "",
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/warehouses") return { data: [{ id: "w1", code: "WH-1", name: "Main", location: "", active: true }, { id: "w2", code: "WH-2", name: "Yard", location: "", active: true }], pagination: null };
    return { data: { id: "x" }, pagination: null };
  });
});
const posts = (p: string) => apiFetch.mock.calls.filter((c) => c[0] === p && c[1]?.method === "POST");

describe("decimal helpers", () => {
  it("compares exactly and never goes negative", () => {
    expect(cmp("0.3", "0.30")).toBe(0);
    expect(cmp("100.0001", "100")).toBe(1);
    expect(remaining("100", "40.5")).toBe("59.5");
    expect(remaining("0.3", "0.1")).toBe("0.2"); // no float drift
    expect(remaining("5", "9")).toBe("0");
  });
});

describe("goods receipt dialog", () => {
  const open = async () => {
    render(<ReceiptDialog orders={[po]} initialPoId="po1" onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText("Receiving warehouse"), "w1");
  };
  it("shows what is still outstanding", async () => {
    await open();
    expect(screen.getByText("60 MT")).toBeInTheDocument(); // 100 ordered - 40 accepted
  });
  it("blocks accepting more than outstanding and does not call the API", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Accepted Steel Billets 150mm"), "60.001");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));
    expect(await screen.findByText(/exceeds the 60 still outstanding/)).toBeInTheDocument();
    expect(posts("/goods-receipts")).toHaveLength(0);
  });
  it("requires a reason for rejected goods", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Rejected Steel Billets 150mm"), "5");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));
    expect(await screen.findByText(/give a reason/)).toBeInTheDocument();
    expect(posts("/goods-receipts")).toHaveLength(0);
  });
  it("requires a warehouse", async () => {
    render(<ReceiptDialog orders={[po]} initialPoId="po1" onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("Accepted Steel Billets 150mm"), "5");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));
    expect(await screen.findByText("Choose a warehouse")).toBeInTheDocument();
  });
  it("submits exactly the entered quantities", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Accepted Steel Billets 150mm"), "50");
    await userEvent.type(screen.getByLabelText("Rejected Steel Billets 150mm"), "2.5");
    await userEvent.type(screen.getByLabelText("Reason Steel Billets 150mm"), "Surface cracks");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));
    await waitFor(() => expect(posts("/goods-receipts")).toHaveLength(1));
    const body = JSON.parse(posts("/goods-receipts")[0][1].body);
    expect(body).toMatchObject({ purchaseOrderId: "po1", warehouseId: "w1", lines: [{ materialId: "m1", acceptedQty: "50", rejectedQty: "2.5", rejectionReason: "Surface cracks" }] });
  });
  it("surfaces a server rejection", async () => {
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/warehouses") return { data: [{ id: "w1", code: "WH-1", name: "Main", location: "", active: true }], pagination: null };
      if (init?.method === "POST") throw new Error("This purchase order was changed by someone else. Reload and try again.");
      return { data: null, pagination: null };
    });
    await open();
    await userEvent.type(screen.getByLabelText("Accepted Steel Billets 150mm"), "5");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));
    expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
  });
});

describe("invoice dialog", () => {
  const open = async () => {
    render(<InvoiceDialog orders={[po]} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Purchase order"), "po1");
  };
  it("defaults to the accepted, not-yet-invoiced quantity at the PO price and previews the total", async () => {
    await open();
    expect(screen.getByLabelText("Billed Steel Billets 150mm")).toHaveValue("30"); // 40 accepted - 10 invoiced
    expect(screen.getByLabelText("Price Steel Billets 150mm")).toHaveValue("100.00");
    // 30 x 100 = 3000.00 ; tax 5% = 150.00 ; transport 500.00
    expect(screen.getByText("BDT 3,650.00")).toBeInTheDocument();
  });
  it("tells the person the server recomputes the total", async () => {
    await open();
    expect(screen.getByText(/server recomputes/i)).toBeInTheDocument();
  });
  it("needs the supplier's invoice number", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /record invoice/i }));
    expect(await screen.findByText(/invoice number/i)).toBeInTheDocument();
    expect(posts("/invoices")).toHaveLength(0);
  });
  it("posts lines and charges but never a total", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Supplier invoice no."), "INV-77");
    await userEvent.click(screen.getByRole("button", { name: /record invoice/i }));
    await waitFor(() => expect(posts("/invoices")).toHaveLength(1));
    const body = JSON.parse(posts("/invoices")[0][1].body);
    expect(body).toMatchObject({ purchaseOrderId: "po1", invoiceNumber: "INV-77", lines: [{ materialId: "m1", quantity: "30", unitPrice: "100.00" }], transportCost: "500.00", taxRatePercent: "5" });
    expect(body).not.toHaveProperty("totalAmount");
  });
});

describe("stock action dialog", () => {
  const row: StockRow = { materialId: "m1", sku: "BIL-150", name: "Steel Billets 150mm", unit: "MT", total: "80.000", status: "ok", safetyStock: 10, minimumStock: 20, reorderPoint: 50, shortfallToReorderPoint: "0.000", byWarehouse: [{ warehouseId: "w1", code: "WH-1", quantity: "80.000" }] };
  it("blocks issuing more than the warehouse holds", async () => {
    render(<StockActionDialog action="issue" row={row} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Quantity/), "80.5");
    await userEvent.type(screen.getByLabelText("Reason"), "Melt shop");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText(/Only 80.000 MT is held/)).toBeInTheDocument();
    expect(posts("/stock/issues")).toHaveLength(0);
  });
  it("requires a reason", async () => {
    render(<StockActionDialog action="issue" row={row} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Quantity/), "5");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("A reason is required")).toBeInTheDocument();
  });
  it("posts a valid issue", async () => {
    const done = vi.fn();
    render(<StockActionDialog action="issue" row={row} onClose={vi.fn()} onDone={done} />);
    await userEvent.type(screen.getByLabelText(/Quantity/), "5");
    await userEvent.type(screen.getByLabelText("Reason"), "Melt shop heat 2411");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(JSON.parse(posts("/stock/issues")[0][1].body)).toMatchObject({ materialId: "m1", warehouseId: "w1", quantity: "5", reason: "Melt shop heat 2411" });
  });
  it("a transfer needs a different destination", async () => {
    render(<StockActionDialog action="transfer" row={row} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Quantity/), "5");
    await userEvent.type(screen.getByLabelText("Reason"), "Rebalance");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText(/different destination/)).toBeInTheDocument();
  });
});
