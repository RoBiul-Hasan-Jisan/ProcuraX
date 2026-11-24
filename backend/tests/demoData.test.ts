import { DEMO_CATEGORIES, DEMO_MATERIALS, DEMO_SUPPLIERS, DEMO_SUPPLIER_USER_LINKS } from '../scripts/demoData';
import { MIN_HISTORY_ORDERS } from '../src/domain/scoring';

describe('demo dataset meets the spec and is internally consistent', () => {
  const catCodes = new Set(DEMO_CATEGORIES.map((c) => c.code));
  it('has the 10 required steel categories', () => {
    expect(DEMO_CATEGORIES.map((c) => c.name).sort()).toEqual([
      'Consumables', 'Electrical Components', 'Ferroalloys', 'Mechanical Components', 'Packaging Materials',
      'Lubricants', 'Refractory Materials', 'Scrap', 'Spare Parts', 'Steel Billets',
    ].sort());
  });
  it('has at least 30 materials with unique SKUs, valid categories and sane stock levels', () => {
    expect(DEMO_MATERIALS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(DEMO_MATERIALS.map((m) => m.sku)).size).toBe(DEMO_MATERIALS.length);
    for (const m of DEMO_MATERIALS) {
      expect(catCodes.has(m.category)).toBe(true);
      expect(m.reorder).toBeGreaterThanOrEqual(m.safety); // reorder point must not be below safety stock
      expect(m.safety).toBeGreaterThanOrEqual(0);
      expect(m.avgPrice).toMatch(/^\d+(\.\d{1,4})?$/);
    }
  });
  it('has at least 8 suppliers with unique codes, all labelled DEMO', () => {
    expect(DEMO_SUPPLIERS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(DEMO_SUPPLIERS.map((s) => s.code)).size).toBe(DEMO_SUPPLIERS.length);
    for (const s of DEMO_SUPPLIERS) expect(s.name).toMatch(/^\[DEMO\]/);
  });
  it('every category has at least one verified, active supplier to invite', () => {
    for (const code of catCodes) {
      const ok = DEMO_SUPPLIERS.filter((s) => s.verification === 'verified' && s.status === 'active' && s.categories.includes(code));
      expect(ok.length).toBeGreaterThanOrEqual(1);
    }
  });
  it('billets and scrap have several eligible suppliers so competing quotations are possible', () => {
    for (const code of ['BIL', 'SCR']) {
      expect(DEMO_SUPPLIERS.filter((s) => s.verification === 'verified' && s.status === 'active' && s.categories.includes(code)).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('covers the edge cases the workflow must handle', () => {
    expect(DEMO_SUPPLIERS.some((s) => s.history.completedOrders > 0 && s.history.completedOrders < MIN_HISTORY_ORDERS)).toBe(true); // unproven
    expect(DEMO_SUPPLIERS.some((s) => s.verification === 'pending')).toBe(true); // not invitable
    expect(DEMO_SUPPLIERS.some((s) => s.status === 'blocked')).toBe(true); // not invitable
    expect(DEMO_SUPPLIERS.filter((s) => s.history.completedOrders >= MIN_HISTORY_ORDERS).length).toBeGreaterThanOrEqual(5); // proven
  });
  it('supplier history is arithmetically possible', () => {
    for (const { history: h, code } of DEMO_SUPPLIERS) {
      expect(h.onTimeDeliveries).toBeLessThanOrEqual(h.completedOrders);
      expect(h.unitsAccepted).toBeLessThanOrEqual(h.unitsReceived);
      expect(code).toMatch(/^SUP-\d{4}$/);
    }
  });
  it('demo supplier logins point at real, active, verified suppliers', () => {
    for (const l of DEMO_SUPPLIER_USER_LINKS) {
      const s = DEMO_SUPPLIERS.find((x) => x.code === l.supplierCode);
      expect(s).toBeDefined();
      expect(s!.status).toBe('active');
      expect(s!.verification).toBe('verified');
      expect(l.email).toMatch(/@demo\.steelprocure\.example$/);
    }
    expect(new Set(DEMO_SUPPLIER_USER_LINKS.map((l) => l.supplierCode)).size).toBe(DEMO_SUPPLIER_USER_LINKS.length);
  });
});

import { DEMO_WAREHOUSES, openingStock } from '../scripts/demoData';
import { stockStatus } from '../src/domain/inventory';

describe('demo warehouses and opening stock', () => {
  it('has unique warehouse codes and every category has a home warehouse', () => {
    const codes = DEMO_WAREHOUSES.map((w) => w.code);
    expect(new Set(codes).size).toBe(codes.length);
    DEMO_MATERIALS.forEach((m, i) => expect(codes).toContain(openingStock(m, i).warehouse));
  });
  it('is deterministic and positive', () => {
    DEMO_MATERIALS.forEach((m, i) => {
      expect(openingStock(m, i)).toEqual(openingStock(m, i));
      expect(Number(openingStock(m, i).quantity)).toBeGreaterThan(0);
    });
  });
  it('produces every stock status so alerts can be demonstrated', () => {
    const seen = new Set(DEMO_MATERIALS.map((m, i) => stockStatus(openingStock(m, i).quantity, { safetyStock: m.safety, minimumStock: m.min, reorderPoint: m.reorder })));
    expect([...seen].sort()).toEqual(['critical', 'low', 'ok', 'reorder']);
  });
});
