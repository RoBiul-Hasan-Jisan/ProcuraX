import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../src/utils/permissions';

describe('default permission matrix', () => {
  const has = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, p: string) => (DEFAULT_ROLE_PERMISSIONS[role] as string[]).includes(p);

  it('suppliers can submit quotations but never see comparison, award or internal data', () => {
    expect(has('supplier', 'quotations:submit')).toBe(true);
    for (const p of ['quotations:compare', 'rfq:manage', 'suppliers:view', 'requisitions:view', 'materials:view', 'reports:financial']) {
      expect(has('supplier', p)).toBe(false);
    }
  });
  it('only procurement and admin can manage RFQs', () => {
    const holders = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter((r) => has(r as any, 'rfq:manage'));
    expect(holders.sort()).toEqual(['procurement_manager', 'system_admin']);
  });
  it('bank details are restricted to finance and admin', () => {
    const holders = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter((r) => has(r as any, 'suppliers:bank'));
    expect(holders.sort()).toEqual(['finance_officer', 'system_admin']);
  });
  it('every approver in the chain holds the approve permission', () => {
    for (const r of ['department_manager', 'procurement_manager', 'finance_officer'] as const) expect(has(r, 'requisitions:approve')).toBe(true);
    for (const r of ['inventory_officer', 'management', 'supplier'] as const) expect(has(r, 'requisitions:approve')).toBe(false);
  });
  it('every default permission is a declared permission', () => {
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
});
