import {
  BarChart3, Bell, Boxes, Brain, ClipboardList, Factory, FileText, Gauge, Settings,
  ShieldCheck, Truck, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  /** Visible when the user holds ANY of these permissions. Empty = any signed-in user. */
  permissions: string[];
  /** Delivery phase. Items beyond CURRENT_PHASE render disabled with a phase tag. */
  phase: number;
}
export interface NavSection {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const CURRENT_PHASE = 6;

export const NAVIGATION: NavSection[] = [
  { label: "Overview", icon: Gauge, items: [{ label: "Overview", href: "/overview", permissions: [], phase: 1 }] },
  {
    label: "Procurement", icon: ClipboardList,
    items: [
      { label: "Purchase Requisitions", href: "/procurement/requisitions", permissions: ["requisitions:view", "requisitions:create"], phase: 2 },
      { label: "Approvals", href: "/procurement/approvals", permissions: ["requisitions:approve"], phase: 2 },
      { label: "Request for Quotation", href: "/procurement/rfqs", permissions: ["rfq:manage", "rfq:view_assigned"], phase: 2 },
      { label: "Quotation Comparison", href: "/procurement/comparison", permissions: ["quotations:compare"], phase: 2 },
      { label: "Purchase Orders", href: "/procurement/purchase-orders", permissions: ["purchase_orders:view", "purchase_orders:view_assigned"], phase: 3 },
      { label: "Goods Receipt", href: "/procurement/goods-receipts", permissions: ["goods_receipts:manage"], phase: 3 },
      { label: "Invoice Verification", href: "/procurement/invoices", permissions: ["invoices:verify"], phase: 3 },
    ],
  },
  {
    label: "Inventory", icon: Boxes,
    items: [
      { label: "Stock Overview", href: "/inventory/stock", permissions: ["inventory:view"], phase: 3 },
      { label: "Material Catalogue", href: "/inventory/materials", permissions: ["inventory:view", "materials:manage"], phase: 2 },
      { label: "Warehouse Management", href: "/inventory/warehouses", permissions: ["warehouses:manage"], phase: 3 },
      { label: "Stock Movements", href: "/inventory/movements", permissions: ["inventory:view"], phase: 3 },
      { label: "Reorder Alerts", href: "/inventory/alerts", permissions: ["inventory:view"], phase: 3 },
    ],
  },
  {
    label: "Material Planning", icon: Factory,
    items: [
      { label: "Production Planning", href: "/planning/production", permissions: ["production:manage", "mrp:view"], phase: 4 },
      { label: "Bill of Materials", href: "/planning/bom", permissions: ["production:manage", "mrp:view"], phase: 4 },
      { label: "MRP Calculator", href: "/planning/mrp", permissions: ["mrp:view", "mrp:run"], phase: 4 },
      { label: "Demand Forecasting", href: "/planning/forecasting", permissions: ["forecasting:view"], phase: 5 },
    ],
  },
  {
    label: "Suppliers", icon: Truck,
    items: [
      { label: "Supplier Directory", href: "/suppliers", permissions: ["suppliers:view"], phase: 2 },
      { label: "My Supplier Profile", href: "/supplier-profile", permissions: ["suppliers:self"], phase: 2 },
      { label: "Supplier Evaluation", href: "/suppliers/evaluation", permissions: ["suppliers:evaluate"], phase: 6 },
      { label: "Supplier Performance", href: "/suppliers/performance", permissions: ["suppliers:view"], phase: 5 },
    ],
  },
  {
    label: "Intelligence", icon: Brain,
    items: [
      { label: "AI Procurement Assistant", href: "/intelligence/assistant", permissions: ["intelligence:view"], phase: 5 },
      { label: "Risk Detection", href: "/intelligence/risks", permissions: ["intelligence:view"], phase: 5 },
      { label: "Forecast Analytics", href: "/intelligence/forecasts", permissions: ["intelligence:view"], phase: 5 },
    ],
  },
  { label: "Reports", icon: BarChart3, items: [{ label: "Reports", href: "/reports", permissions: ["reports:view"], phase: 6 }] },
  { label: "Notifications", icon: Bell, items: [{ label: "Notifications", href: "/notifications", permissions: ["notifications:view"], phase: 6 }] },
  { label: "Audit Logs", icon: FileText, items: [{ label: "Audit Logs", href: "/audit-logs", permissions: ["audit:view"], phase: 6 }] },
  { label: "Settings", icon: Settings, items: [{ label: "User Management", href: "/settings", permissions: ["users:manage", "settings:manage"], phase: 1 }] },
];

export const SECTION_ICON_FALLBACK = ShieldCheck;

/** Filters navigation to what the user's (server-provided) permissions allow. */
export function visibleNavigation(can: (...p: string[]) => boolean): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(...item.permissions)),
  })).filter((section) => section.items.length > 0);
}

export function isEnabled(item: NavItem): boolean {
  return item.phase <= CURRENT_PHASE;
}
