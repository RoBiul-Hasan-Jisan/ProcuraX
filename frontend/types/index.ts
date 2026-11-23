export type RoleName =
  | "system_admin"
  | "procurement_manager"
  | "department_manager"
  | "inventory_officer"
  | "finance_officer"
  | "supplier"
  | "management";

export type AccountStatus = "pending" | "active" | "suspended";

export interface AppUser {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  role: RoleName | null;
  roleLabel: string | null;
  status: AccountStatus;
  departmentId: string | null;
  supplierId: string | null;
}

export interface SessionPayload {
  user: AppUser;
  permissions: string[];
}

export const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "system_admin", label: "System Administrator" },
  { value: "procurement_manager", label: "Procurement Manager" },
  { value: "department_manager", label: "Department Manager" },
  { value: "inventory_officer", label: "Inventory Officer" },
  { value: "finance_officer", label: "Finance Officer" },
  { value: "supplier", label: "Supplier" },
  { value: "management", label: "Management / Executive" },
];
