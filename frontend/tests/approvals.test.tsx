import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const auth = { permissions: ["requisitions:approve"] as string[] };
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ can: (...p: string[]) => p.some((x) => auth.permissions.includes(x)) }) }));

let pending: unknown[] | null = [];
const reload = vi.fn();
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useApi: () => ({ data: pending, loading: false, error: null, reload, pagination: null }),
}));

import ApprovalsPage from "@/app/(app)/procurement/approvals/page";

const item = {
  approvalId: "a1", step: 1, stepLabel: "Department approval",
  requisition: {
    id: "r1", number: "PR-2026-0007", status: "Submitted", priority: "High", requestedBy: { id: "u9", name: "Rafi Ahmed" }, department: { id: "d1", name: "Production" },
    items: [{ id: "i1", materialId: "m1", materialName: "Steel Billets 150mm", sku: "BIL-150", category: "Steel Billets", quantity: "50", unit: "MT", estimatedUnitPrice: "65000.00", lineTotal: "3250000.00" }],
    currency: "BDT", estimatedTotal: "3250000.00", requiredDate: "2027-01-10T00:00:00.000Z", reason: "Melt shop restock", rfqId: null, createdAt: "", submittedAt: null,
  },
};

beforeEach(() => { apiFetch.mockReset(); reload.mockReset(); auth.permissions = ["requisitions:approve"]; pending = [item]; });

describe("approvals inbox", () => {
  it("lists what is waiting for the user", () => {
    render(<ApprovalsPage />);
    expect(screen.getByText("PR-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Rafi Ahmed")).toBeInTheDocument();
    expect(screen.getByText("BDT 3,250,000.00")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is pending", () => {
    pending = [];
    render(<ApprovalsPage />);
    expect(screen.getByText(/Nothing is waiting for your approval/)).toBeInTheDocument();
  });

  it("denies users without the approve permission", () => {
    auth.permissions = ["requisitions:view"];
    render(<ApprovalsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/do not have permission/i);
  });

  it("requires a comment before rejecting or requesting changes, but not for approving", async () => {
    render(<ApprovalsPage />);
    await userEvent.click(screen.getByText("Rafi Ahmed"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Request changes" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeEnabled();
    await userEvent.type(within(dialog).getByLabelText("Comment"), "Over budget");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("sends the decision and refreshes the list", async () => {
    apiFetch.mockResolvedValue({ data: {} });
    render(<ApprovalsPage />);
    await userEvent.click(screen.getByText("Rafi Ahmed"));
    await userEvent.type(screen.getByLabelText("Comment"), "Not justified");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/approvals/r1/decision");
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ action: "reject", comment: "Not justified" });
  });

  it("shows the server's message when the step was already decided by someone else", async () => {
    apiFetch.mockRejectedValue(new Error("This approval step was already decided"));
    render(<ApprovalsPage />);
    await userEvent.click(screen.getByText("Rafi Ahmed"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already decided");
    expect(reload).not.toHaveBeenCalled();
  });
});
