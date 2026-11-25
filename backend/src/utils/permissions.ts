/**
 * Role and permission definitions.
 * These are the DEFAULTS. They are seeded into the `roles` collection at startup and
 * the database copy is what the middleware enforces, so administrators can tune them later.
 */
export const ROLES = [
  'system_admin',
  'procurement_manager',
  'department_manager',
  'inventory_officer',
  'finance_officer',
  'supplier',
  'management',
] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  system_admin: 'System Administrator',
  procurement_manager: 'Procurement Manager',
  department_manager: 'Department Manager',
  inventory_officer: 'Inventory Officer',
  finance_officer: 'Finance Officer',
  supplier: 'Supplier',
  management: 'Management / Executive',
};

export const PERMISSIONS = [
  'dashboard:view',
  'users:manage',
  'departments:manage',
  'settings:manage',
  'audit:view',
  'requisitions:view',
  'requisitions:create',
  'requisitions:approve',
  'rfq:manage',
  'rfq:view_assigned',
  'quotations:submit',
  'quotations:compare',
  'purchase_orders:manage',
  'purchase_orders:view',
  'purchase_orders:view_assigned',
  'goods_receipts:manage',
  'invoices:verify',
  'inventory:view',
  'inventory:manage',
  'materials:manage',
  'warehouses:manage',
  'suppliers:view',
  'suppliers:manage',
  'suppliers:evaluate',
  'suppliers:self',
  'suppliers:bank',
  'materials:view',
  'mrp:view',
  'mrp:run',
  'production:manage',
  'forecasting:view',
  'intelligence:view',
  'risks:review',
  'reports:view',
  'reports:financial',
  'notifications:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  system_admin: ALL,
  procurement_manager: [
    'dashboard:view', 'materials:view', 'requisitions:view', 'requisitions:approve', 'rfq:manage', 'quotations:compare',
    'purchase_orders:manage', 'purchase_orders:view', 'suppliers:view', 'suppliers:manage',
    'suppliers:evaluate', 'inventory:view', 'mrp:view', 'mrp:run', 'forecasting:view',
    'intelligence:view', 'risks:review', 'reports:view', 'reports:financial', 'notifications:view',
  ],
  department_manager: [
    'dashboard:view', 'materials:view', 'requisitions:view', 'requisitions:create', 'requisitions:approve',
    'purchase_orders:view', 'inventory:view', 'reports:view', 'notifications:view',
  ],
  inventory_officer: [
    'dashboard:view', 'materials:view', 'requisitions:view', 'requisitions:create',
    'inventory:view', 'inventory:manage', 'materials:manage',
    'warehouses:manage', 'goods_receipts:manage', 'purchase_orders:view', 'mrp:view',
    'production:manage', 'forecasting:view', 'reports:view', 'notifications:view',
  ],
  finance_officer: [
    'dashboard:view', 'materials:view', 'requisitions:view', 'requisitions:approve', 'quotations:compare',
    'purchase_orders:view', 'invoices:verify', 'suppliers:view', 'suppliers:bank', 'reports:view',
    'reports:financial', 'notifications:view',
  ],
  supplier: [
    'rfq:view_assigned', 'quotations:submit', 'purchase_orders:view_assigned',
    'suppliers:self', 'notifications:view',
  ],
  management: [
    'dashboard:view', 'materials:view', 'requisitions:view', 'purchase_orders:view', 'inventory:view',
    'suppliers:view', 'mrp:view', 'forecasting:view', 'intelligence:view', 'reports:view',
    'reports:financial', 'notifications:view',
  ],
};

/** Bump when DEFAULT_ROLE_PERMISSIONS gains permissions; startup merges the additions into stored roles. */
export const DEFAULTS_VERSION = 3;
