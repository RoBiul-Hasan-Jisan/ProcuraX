import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const apiUpload = vi.fn();
const apiBlob = vi.fn();
const saveBlob = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a), apiUpload: (...a: unknown[]) => apiUpload(...a), apiBlob: (...a: unknown[]) => apiBlob(...a), saveBlob: (...a: unknown[]) => saveBlob(...a),
  filenameFromDisposition: (h: string | null) => h,
}));
let perms: string[] = ["notifications:view", "reports:view", "reports:financial", "suppliers:evaluate", "quotations:compare"];
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ can: (...p: string[]) => p.some((x) => perms.includes(x)), user: { id: "me1" } }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useParams: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...r}>{children}</a> }));

import ReportsPage from "@/app/(app)/reports/page";
import SupplierEvaluationPage from "@/app/(app)/suppliers/evaluation/page";
import { DocumentsPanel } from "@/features/documents/DocumentsPanel";
import { NotificationCenter } from "@/features/notifications/NotificationCenter";
import { ReportTable, formatCell } from "@/features/reports/ReportTable";
import { formatBytes, precheckFile, safeInternalLink, timeAgo } from "@/lib/utils/operations";
import { normalizedShares, validateWeights } from "@/lib/utils/weights";

const ok = (data: unknown, pagination: unknown = null) => ({ success: true, message: "", data, pagination });
beforeEach(() => { vi.clearAllMocks(); perms = ["notifications:view", "reports:view", "reports:financial", "suppliers:evaluate", "quotations:compare"]; });

describe("safeInternalLink", () => {
  it("allows in-app paths only", () => {
    expect(safeInternalLink("/procurement/requisitions/abc")).toBe("/procurement/requisitions/abc");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "\\\\evil", "/ok\nx", "relative/path", "", null, undefined]) expect(safeInternalLink(bad as string)).toBeNull();
  });
});

describe("small helpers", () => {
  it("formats relative time", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(timeAgo("2026-11-26T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-26T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-11-26T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-24T12:00:00Z", now)).toBe("2 d ago");
  });
  it("prechecks uploads without replacing the server check", () => {
    expect(precheckFile({ name: "a.pdf", size: 100 })).toBeNull();
    expect(precheckFile({ name: "a.exe", size: 100 })).toMatch(/not allowed/);
    expect(precheckFile({ name: "noext", size: 100 })).toMatch(/not allowed/);
    expect(precheckFile({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(precheckFile({ name: "a.pdf", size: 11 * 1024 * 1024 })).toMatch(/larger/);
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});

describe("scoring weight helpers", () => {
  const w = (o: Partial<Record<string, string>> = {}) => ({ price: "30", delivery: "25", quality: "20", leadTime: "15", payment: "10", ...o }) as never;
  it("accepts the defaults and rescales to shares that add to 100", () => {
    expect(validateWeights(w())).toBeNull();
    const s = normalizedShares(w({ price: "50", delivery: "50", quality: "0", leadTime: "0", payment: "0" }));
    expect(s.price).toBe("50.0"); expect(s.quality).toBe("0.0");
  });
  it("rejects junk, out-of-range and all-zero weights", () => {
    expect(validateWeights(w({ price: "abc" }))).toMatch(/Price/);
    expect(validateWeights(w({ delivery: "101" }))).toMatch(/Delivery/);
    expect(validateWeights(w({ price: "-1" }))).toMatch(/Price/);
    expect(validateWeights(w({ price: "0", delivery: "0", quality: "0", leadTime: "0", payment: "0" }))).toMatch(/greater than zero/);
  });
});

describe("ReportTable", () => {
  it("formats amounts without recalculating them and bolds the totals row", () => {
    const result = { key: "k", title: "T", generatedAt: "", filters: {}, truncated: false, notes: [],
      columns: [{ key: "a", label: "Name", type: "text" as const }, { key: "b", label: "Total", type: "money" as const }, { key: "c", label: "Share", type: "pct" as const }],
      rows: [{ a: "PO-1", b: "1234.50", c: "12.5" }, { a: "PO-2", b: null, c: null }], totals: { a: "Total", b: "1234.50", c: null } };
    render(<ReportTable result={result} />);
    expect(screen.getByText("BDT 1,234.50", { selector: "tr:nth-child(1) td" })).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    const last = screen.getAllByRole("row").at(-1)!;
    expect(within(last).getByText("Total")).toBeInTheDocument();
    expect(last.className).toMatch(/font-semibold/);
    expect(formatCell(result.columns[1]!, null)).toBe("-");
  });
});

describe("NotificationCenter", () => {
  const items = [
    { _id: "n1", type: "x", title: "New requisition PR-1", body: "Submitted by Ana.", severity: "info", link: "/procurement/requisitions/r1", readAt: null, createdAt: new Date().toISOString() },
    { _id: "n2", type: "x", title: "Low stock", body: "", severity: "warning", link: "https://evil.example", readAt: null, createdAt: new Date().toISOString() },
  ];
  const route = (path: string) => {
    if (path.startsWith("/notifications/unread-count")) return Promise.resolve(ok({ unread: 2 }));
    if (path.startsWith("/notifications?")) return Promise.resolve(ok(items, { unread: 2 }));
    return Promise.resolve(ok({}));
  };
  it("shows the unread count and loads the list when opened", async () => {
    apiFetch.mockImplementation(route);
    render(<NotificationCenter />);
    expect(await screen.findByTestId("unread-badge")).toHaveTextContent("2");
    await userEvent.click(screen.getByRole("button", { name: /Notifications, 2 unread/ }));
    expect(await screen.findByText("New requisition PR-1")).toBeInTheDocument();
  });
  it("marks one read, lowers the count and follows only an in-app link", async () => {
    apiFetch.mockImplementation(route);
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByText("New requisition PR-1"));
    expect(apiFetch).toHaveBeenCalledWith("/notifications/n1/read", { method: "POST" });
    expect(push).toHaveBeenCalledWith("/procurement/requisitions/r1");
    await waitFor(() => expect(screen.getByTestId("unread-badge")).toHaveTextContent("1"));
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ })); // the list closed after following the link
    await userEvent.click(await screen.findByText("Low stock"));
    expect(push).toHaveBeenCalledTimes(1); // the external link was ignored
  });
  it("marks everything read", async () => {
    apiFetch.mockImplementation(route);
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByText("Mark all read"));
    expect(apiFetch).toHaveBeenCalledWith("/notifications/read-all", { method: "POST" });
    await waitFor(() => expect(screen.queryByTestId("unread-badge")).toBeNull());
  });
  it("renders nothing and makes no request without notifications:view", () => {
    perms = [];
    const { container } = render(<NotificationCenter />);
    expect(container).toBeEmptyDOMElement();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("shows an error instead of hanging when the list fails", async () => {
    apiFetch.mockImplementation((p: string) => (p.startsWith("/notifications?") ? Promise.reject(new Error("boom")) : Promise.resolve(ok({ unread: 0 }))));
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("DocumentsPanel", () => {
  const doc = { id: "d1", entityType: "invoice", entityId: "i1", name: "inv.pdf", mimeType: "application/pdf", size: 2048, description: "", uploadedByName: "Ana", uploadedAt: "2026-11-20T00:00:00Z" };
  it("lists documents and downloads through the authenticated helper", async () => {
    apiFetch.mockResolvedValue(ok([doc]));
    apiBlob.mockResolvedValue({ blob: new Blob(["x"]), filename: "inv.pdf" });
    render(<DocumentsPanel entityType="invoice" entityId="i1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Download inv.pdf" }));
    expect(apiBlob).toHaveBeenCalledWith("/documents/d1/download");
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  });
  it("rejects a disallowed file before any request", async () => {
    apiFetch.mockResolvedValue(ok([]));
    render(<DocumentsPanel entityType="invoice" entityId="i1" />);
    await screen.findByText("No documents attached.");
    await userEvent.upload(screen.getByLabelText("Choose a document"), new File(["MZ"], "run.exe", { type: "application/x-msdownload" }), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/);
    expect(apiUpload).not.toHaveBeenCalled();
  });
  it("uploads as multipart with the record and shows the server's message on refusal", async () => {
    apiFetch.mockResolvedValue(ok([]));
    apiUpload.mockRejectedValueOnce(new Error("The file content is not a PDF"));
    render(<DocumentsPanel entityType="purchase_order" entityId="p1" />);
    await screen.findByText("No documents attached.");
    await userEvent.upload(screen.getByLabelText("Choose a document"), new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }));
    const [path, form] = apiUpload.mock.calls[0] as [string, FormData];
    expect(path).toBe("/documents");
    expect(form.get("entityType")).toBe("purchase_order"); expect(form.get("entityId")).toBe("p1"); expect((form.get("file") as File).name).toBe("a.pdf");
    expect(await screen.findByRole("alert")).toHaveTextContent("not a PDF");
  });
  it("hides the upload form when uploading is not allowed", async () => {
    apiFetch.mockResolvedValue(ok([doc]));
    render(<DocumentsPanel entityType="invoice" entityId="i1" canUpload={false} />);
    await screen.findByText("inv.pdf");
    expect(screen.queryByLabelText("Choose a document")).toBeNull();
  });
  it("asks before deleting and does nothing when cancelled", async () => {
    apiFetch.mockResolvedValue(ok([doc]));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DocumentsPanel entityType="invoice" entityId="i1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete inv.pdf" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/documents/d1", { method: "DELETE" });
  });
});

describe("Reports index", () => {
  it("lists what the server returns and marks financial reports", async () => {
    apiFetch.mockResolvedValue(ok([{ key: "purchase-orders", title: "Purchase Order Report", description: "d", financial: true, filters: [] }, { key: "warehouse-stock", title: "Warehouse Stock", description: "d", financial: false, filters: [] }]));
    render(<ReportsPage />);
    expect(await screen.findByText("Purchase Order Report")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Financial report")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Warehouse Stock/ })).toHaveAttribute("href", "/reports/warehouse-stock");
  });
  it("says so when no report is available", async () => {
    apiFetch.mockResolvedValue(ok([]));
    render(<ReportsPage />);
    expect(await screen.findByText(/No reports are available/)).toBeInTheDocument();
  });
});

describe("Supplier Evaluation page", () => {
  const weights = { price: 30, delivery: 25, quality: 20, leadTime: 15, payment: 10 };
  it("saves valid weights as numbers", async () => {
    apiFetch.mockImplementation((p: string, init?: RequestInit) => Promise.resolve(ok(init?.method === "PUT" ? JSON.parse(init.body as string) : weights)));
    render(<SupplierEvaluationPage />);
    const price = await screen.findByLabelText("Price weight");
    await userEvent.clear(price); await userEvent.type(price, "40");
    await userEvent.click(screen.getByRole("button", { name: "Save weights" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/settings/scoring", { method: "PUT", body: JSON.stringify({ price: 40, delivery: 25, quality: 20, leadTime: 15, payment: 10 }) }));
    expect(await screen.findByText(/Weights saved/)).toBeInTheDocument();
  });
  it("blocks invalid input before calling the server", async () => {
    apiFetch.mockResolvedValue(ok(weights));
    render(<SupplierEvaluationPage />);
    const price = await screen.findByLabelText("Price weight");
    await userEvent.clear(price); await userEvent.type(price, "abc");
    expect(screen.getByRole("button", { name: "Save weights" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Price/);
  });
  it("is read-only without suppliers:evaluate", async () => {
    perms = ["quotations:compare"];
    apiFetch.mockResolvedValue(ok(weights));
    render(<SupplierEvaluationPage />);
    expect(await screen.findByLabelText("Price weight")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save weights" })).toBeNull();
  });
});
