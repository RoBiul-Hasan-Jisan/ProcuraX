import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
import { QuotationForm } from "@/features/rfq/QuotationForm";
import type { Rfq } from "@/types/procurement";

const rfq: Rfq = {
  id: "rfq1", number: "RFQ-2026-0001", status: "open", deadline: new Date(Date.now() + 5 * 864e5).toISOString(), requiredDate: new Date(Date.now() + 30 * 864e5).toISOString(),
  deliveryLocation: "Yard", paymentTerms: "Net 30", deliveryRequirements: "",
  items: [{ materialId: "m1", materialName: "Steel Billets 150mm", sku: "BIL-150", quantity: "100.000", unit: "MT", technicalSpecs: "" }],
};

const fill = async () => {
  await userEvent.type(screen.getByLabelText("Unit price (BDT)"), "65000.10");
  await userEvent.clear(screen.getByLabelText("Transportation cost")); await userEvent.type(screen.getByLabelText("Transportation cost"), "12000");
  await userEvent.clear(screen.getByLabelText("Additional charges")); await userEvent.type(screen.getByLabelText("Additional charges"), "500.55");
  await userEvent.clear(screen.getByLabelText("Tax rate (%)")); await userEvent.type(screen.getByLabelText("Tax rate (%)"), "5");
  await userEvent.type(screen.getByLabelText("Delivery time (days)"), "10");
  await userEvent.type(screen.getByLabelText("Quotation valid until"), "2031-06-30");
};

describe("supplier quotation form", () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it("states that the quotation is confidential and quantities are fixed", () => {
    render(<QuotationForm rfq={rfq} existing={null} onSaved={vi.fn()} />);
    expect(screen.getByText(/confidential/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument(); // suppliers cannot change quantity
  });

  it("previews the exact total landed cost matching the server formula", async () => {
    render(<QuotationForm rfq={rfq} existing={null} onSaved={vi.fn()} />);
    await fill();
    await waitFor(() => expect(screen.getByText("BDT 6,837,511.05")).toBeInTheDocument());
    expect(screen.getByText("BDT 325,000.50")).toBeInTheDocument(); // 5% tax on material cost
  });

  it("refuses a zero price and does not call the API", async () => {
    render(<QuotationForm rfq={rfq} existing={null} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Unit price (BDT)"), "0");
    await userEvent.click(screen.getByRole("button", { name: /submit quotation/i }));
    expect(await screen.findByText("Unit price must be greater than zero")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("submits prices only (no quantity, no supplier id) to the RFQ-scoped endpoint", async () => {
    apiFetch.mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    render(<QuotationForm rfq={rfq} existing={null} onSaved={onSaved} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: /submit quotation/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/rfqs/rfq1/quotation");
    expect(apiFetch.mock.calls[0][1].method).toBe("PUT");
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body.lines).toEqual([{ materialId: "m1", unitPrice: "65000.10" }]);
    expect(body).not.toHaveProperty("supplierId");
    expect(body.deliveryDays).toBe(10);
  });

  it("surfaces a deadline error from the server", async () => {
    apiFetch.mockRejectedValue(new Error("The submission deadline has passed"));
    render(<QuotationForm rfq={rfq} existing={null} onSaved={vi.fn()} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: /submit quotation/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("deadline has passed");
  });
});
