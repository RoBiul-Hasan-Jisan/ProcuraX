import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEnabled, visibleNavigation } from "@/lib/navigation";

const canWith = (perms: string[]) => (...req: string[]) => req.length === 0 || req.some((p) => perms.includes(p));
const labels = (perms: string[]) => visibleNavigation(canWith(perms)).flatMap((s) => s.items.map((i) => i.label));

describe("role-based navigation", () => {
  it("shows a supplier only supplier-relevant pages", () => {
    const l = labels(["rfq:view_assigned", "quotations:submit", "purchase_orders:view_assigned", "notifications:view"]);
    expect(l).toContain("Request for Quotation");
    expect(l).toContain("Purchase Orders");
    expect(l).not.toContain("Stock Overview");
    expect(l).not.toContain("Supplier Directory");
    expect(l).not.toContain("User Management");
  });

  it("hides user management from non-admins", () => {
    expect(labels(["dashboard:view", "rfq:manage"])).not.toContain("User Management");
  });

  it("shows user management to holders of users:manage", () => {
    expect(labels(["users:manage"])).toContain("User Management");
  });

  it("always keeps Overview visible", () => {
    expect(labels([])).toEqual(["Overview"]);
  });

  it("drops sections that end up empty", () => {
    const sections = visibleNavigation(canWith(["users:manage"])).map((s) => s.label);
    expect(sections).not.toContain("Procurement");
  });

  it("only enables pages that exist in the current phase", () => {
    const all = visibleNavigation(canWith(["users:manage", "requisitions:view", "purchase_orders:view", "production:manage", "forecasting:view"])).flatMap((s) => s.items);
    expect(isEnabled(all.find((i) => i.label === "User Management")!)).toBe(true);
    expect(isEnabled(all.find((i) => i.label === "Purchase Requisitions")!)).toBe(true); // Phase 2
    expect(isEnabled(all.find((i) => i.label === "Purchase Orders")!)).toBe(true); // Phase 3
    expect(isEnabled(all.find((i) => i.label === "Production Planning")!)).toBe(true); // Phase 4
    expect(isEnabled(all.find((i) => i.label === "Demand Forecasting")!)).toBe(true); // Phase 5
  });

  it("Phase 5 and Phase 6 pages are enabled", () => {
    const all = visibleNavigation(canWith(["intelligence:view", "suppliers:view", "suppliers:evaluate", "reports:view", "notifications:view", "audit:view"])).flatMap((s) => s.items);
    for (const l of ["AI Procurement Assistant", "Risk Detection", "Forecast Analytics", "Supplier Performance", "Supplier Evaluation", "Reports", "Notifications", "Audit Logs"]) expect(isEnabled(all.find((i) => i.label === l)!), l).toBe(true);
    expect(all.map((i) => i.label)).not.toContain("Supplier Intelligence"); // folded into Supplier Performance
  });

  it("audit logs are only listed for holders of audit:view", () => {
    expect(labels(["reports:view", "notifications:view"])).not.toContain("Audit Logs");
    expect(labels(["audit:view"])).toContain("Audit Logs");
  });

  it("every enabled navigation page exists in the app", () => {
    const all = visibleNavigation(() => true).flatMap((s) => s.items).filter(isEnabled);
    for (const i of all) {
      const dir = i.href === "/overview" ? "overview" : i.href.replace(/^\//, "");
      expect(fs.existsSync(path.join(process.cwd(), "app/(app)", dir, "page.tsx")), `${i.label} -> ${i.href}`).toBe(true);
    }
  });

  it("gives suppliers their RFQ and profile pages but no internal procurement pages", () => {
    const l = labels(["rfq:view_assigned", "quotations:submit", "suppliers:self", "notifications:view"]);
    expect(l).toContain("Request for Quotation");
    expect(l).toContain("My Supplier Profile");
    expect(l).not.toContain("Quotation Comparison");
    expect(l).not.toContain("Purchase Requisitions");
    expect(l).not.toContain("Supplier Directory");
    expect(l).not.toContain("Material Catalogue");
  });

  it("shows the comparison page only to those allowed to compare quotations", () => {
    expect(labels(["quotations:compare"])).toContain("Quotation Comparison");
    expect(labels(["requisitions:view"])).not.toContain("Quotation Comparison");
  });
});
