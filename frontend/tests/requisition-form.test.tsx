import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn() }) }));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const MATERIALS = [
  { id: "m1", sku: "BIL-150", name: "Steel Billets 150mm", unit: "MT", averagePurchasePrice: "65000.0000", currency: "BDT", active: true },
  { id: "m2", sku: "FER-MN", name: "Ferro Manganese", unit: "MT", averagePurchasePrice: null, currency: "BDT", active: true },
];
vi.mock("@/hooks/useApi", async (orig) => ({ ...(await orig<typeof import("@/hooks/useApi")>()), useApi: () => ({ data: MATERIALS, loading: false, error: null, reload: vi.fn(), pagination: null }) }));

import { RequisitionForm } from "@/features/requisitions/RequisitionForm";

const fillValid = async () => {
  await userEvent.selectOptions(screen.getByLabelText("Material"), "m2");
  await userEvent.type(screen.getByLabelText(/Quantity/), "10");
  await userEvent.type(screen.getByLabelText("Est. unit price"), "120.50");
  fireEvent.change(screen.getByLabelText("Required delivery date"), { target: { value: "2031-01-15" } });
  await userEvent.type(screen.getByLabelText("Reason for purchase"), "Melt shop restock");
};

describe("requisition form", () => {
  beforeEach(() => { apiFetch.mockReset(); push.mockReset(); });

  it("blocks an empty submission and explains every problem", async () => {
    render(<RequisitionForm />);
    await userEvent.click(screen.getByRole("button", { name: /save and submit/i }));
    expect(await screen.findByText("Choose a material")).toBeInTheDocument();
    expect(screen.getByText("Enter a quantity greater than zero")).toBeInTheDocument();
    expect(screen.getByText("Required date is required")).toBeInTheDocument();
    expect(screen.getByText(/give a reason/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity and a past date", async () => {
    render(<RequisitionForm />);
    await userEvent.selectOptions(screen.getByLabelText("Material"), "m2");
    await userEvent.type(screen.getByLabelText(/Quantity/), "0");
    await userEvent.type(screen.getByLabelText("Est. unit price"), "5");
    fireEvent.change(screen.getByLabelText("Required delivery date"), { target: { value: "2020-01-01" } });
    await userEvent.type(screen.getByLabelText("Reason for purchase"), "Restock");
    await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByText("Enter a quantity greater than zero")).toBeInTheDocument();
    expect(screen.getByText("Required date must be in the future")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("prefills the estimated price from the material's average price and shows an exact line total", async () => {
    render(<RequisitionForm />);
    await userEvent.selectOptions(screen.getByLabelText("Material"), "m1");
    expect(screen.getByLabelText("Est. unit price")).toHaveValue("65000");
    await userEvent.type(screen.getByLabelText(/Quantity/), "3");
    await waitFor(() => expect(screen.getAllByText("BDT 195,000.00").length).toBeGreaterThan(0));
  });

  it("does not allow the same material twice", async () => {
    render(<RequisitionForm />);
    await userEvent.click(screen.getByRole("button", { name: /add line/i }));
    const selects = screen.getAllByLabelText("Material");
    await userEvent.selectOptions(selects[0], "m2");
    await userEvent.selectOptions(selects[1], "m2");
    for (const q of screen.getAllByLabelText(/Quantity/)) await userEvent.type(q, "1");
    for (const p of screen.getAllByLabelText("Est. unit price")) await userEvent.type(p, "1");
    fireEvent.change(screen.getByLabelText("Required delivery date"), { target: { value: "2031-01-15" } });
    await userEvent.type(screen.getByLabelText("Reason for purchase"), "Restock");
    await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByText("Each material can appear only once")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("saves a draft without submitting it", async () => {
    apiFetch.mockResolvedValue({ data: { id: "r1" } });
    render(<RequisitionForm />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/procurement/requisitions/r1"));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe("/requisitions");
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ priority: "Medium", reason: "Melt shop restock", requiredDate: "2031-01-15T00:00:00.000Z" });
    expect(body.items).toEqual([{ materialId: "m2", quantity: "10", estimatedUnitPrice: "120.50" }]);
  });

  it("saves then submits for approval", async () => {
    apiFetch.mockResolvedValue({ data: { id: "r1" } });
    render(<RequisitionForm />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: /save and submit/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch.mock.calls[1][0]).toBe("/requisitions/r1/submit");
  });

  it("shows a server error and stays on the page", async () => {
    apiFetch.mockRejectedValue(new Error("Your account has no department."));
    render(<RequisitionForm />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no department");
    expect(push).not.toHaveBeenCalled();
  });
});
