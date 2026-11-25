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

import { CONSUMPTION_SPIKE_SKU, PRICE_JUMP, PRICE_OBSERVATIONS, consumptionHistory, priceHistory, DEMO_BOMS, DEMO_PLANS, DEMO_PRODUCTS, DEMO_RESERVATIONS, LEAD_TIME_BY_CATEGORY, SUPPLIER_CAPACITY } from '../scripts/demoData';
import { explodeBom, type Bom } from '../src/domain/bom';

describe('Phase 4 demo data', () => {
  const skus = new Set(DEMO_MATERIALS.map((m) => m.sku));
  const prodCodes = new Set(DEMO_PRODUCTS.map((p) => p.code));
  it('every BOM component exists and every BOM belongs to a known product', () => {
    for (const b of DEMO_BOMS) {
      expect(prodCodes.has(b.product)).toBe(true);
      for (const i of b.items) {
        expect(Boolean(i.sku) !== Boolean(i.product)).toBe(true);
        if (i.sku) expect(skus.has(i.sku)).toBe(true);
        if (i.product) expect(prodCodes.has(i.product)).toBe(true);
        expect(i.quantity).toMatch(/^\d+(\.\d{1,6})?$/);
        expect(Number(i.wastage)).toBeGreaterThanOrEqual(0);
        expect(Number(i.wastage)).toBeLessThanOrEqual(100);
      }
    }
  });
  it('has unique product/version pairs and a multi-level example', () => {
    const keys = DEMO_BOMS.map((b) => `${b.product}:${b.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEMO_BOMS.some((b) => b.items.some((i) => i.product))).toBe(true);
    expect(DEMO_PRODUCTS.some((p) => p.intermediate)).toBe(true);
  });
  it('demonstrates BOM versioning: plans before and after the v2 date use different wastage', () => {
    const idOf = (code: string) => `P:${code}`;
    const boms: Bom[] = DEMO_BOMS.map((b) => ({ id: `${b.product}${b.version}`, number: `BOM-${b.product}-${b.version}`, product: idOf(b.product), version: b.version, status: b.status, effectiveFrom: new Date(b.effectiveFrom),
      items: b.items.map((i) => ({ material: i.sku ?? null, subProduct: i.product ? idOf(i.product) : null, quantity: i.quantity, wastagePercent: i.wastage })) }));
    const before = explodeBom(idOf('TMT-12'), 100, new Date('2026-06-01'), boms).requirements.find((r) => r.material === 'BIL-130')!;
    const after = explodeBom(idOf('TMT-12'), 100, new Date('2026-11-01'), boms).requirements.find((r) => r.material === 'BIL-130')!;
    expect(before.adjusted.toFixed()).toBe('104');
    expect(after.adjusted.toFixed()).toBe('103');
  });
  it('the multi-level product explodes to raw materials with no issues', () => {
    const idOf = (code: string) => `P:${code}`;
    const boms: Bom[] = DEMO_BOMS.map((b) => ({ id: `${b.product}${b.version}`, number: `B-${b.product}-${b.version}`, product: idOf(b.product), version: b.version, status: b.status, effectiveFrom: new Date(b.effectiveFrom),
      items: b.items.map((i) => ({ material: i.sku ?? null, subProduct: i.product ? idOf(i.product) : null, quantity: i.quantity, wastagePercent: i.wastage })) }));
    const r = explodeBom(idOf('TMT-10I'), 300, new Date('2026-12-01'), boms);
    expect(r.issues).toEqual([]);
    expect(r.requirements.find((x) => x.material === 'SCR-HMS')!.gross.toFixed()).toBe('336.96'); // 300 x 1.04 billet x 1.08 scrap
    expect(r.requirements.every((x) => skus.has(x.material))).toBe(true);
  });
  it('plans point at real products and include one outside the default horizon', () => {
    for (const p of DEMO_PLANS) { expect(prodCodes.has(p.product)).toBe(true); expect(Number(p.quantity)).toBeGreaterThan(0); expect(p.durationDays).toBeGreaterThanOrEqual(0); }
    expect(new Set(DEMO_PLANS.map((p) => p.ref)).size).toBe(DEMO_PLANS.length);
    expect(DEMO_PLANS.some((p) => p.startInDays > 30)).toBe(true);
    expect(DEMO_PLANS.some((p) => p.startInDays < 10)).toBe(true);
  });
  it('reservations reference real materials and plans', () => {
    const refs = new Set(DEMO_PLANS.map((p) => p.ref));
    for (const r of DEMO_RESERVATIONS) { expect(skus.has(r.sku)).toBe(true); if (r.plan) expect(refs.has(r.plan)).toBe(true); }
  });
  it('lead times cover every category and capacities reference real materials', () => {
    for (const c of DEMO_CATEGORIES) expect(LEAD_TIME_BY_CATEGORY[c.code]).toBeGreaterThan(0);
    for (const sku of Object.keys(SUPPLIER_CAPACITY)) expect(skus.has(sku)).toBe(true);
  });
  it('consumption history is positive, spans a year and keeps the opening-stock ledger non-negative', () => {
    DEMO_MATERIALS.forEach((m, i) => {
      const h = consumptionHistory(m);
      expect(h).toHaveLength(52);
      expect(h[h.length - 1].daysAgo).toBe(361);
      expect(h[0].daysAgo).toBe(4);
      expect(new Set(h.map((x) => Math.floor(x.daysAgo / 7))).size).toBe(52); // exactly one issue in every 7-day bucket ending today
      const total = h.reduce((a, x) => a + x.quantity, 0);
      const open = Number(openingStock(m, i).quantity);
      let bal = open + total; // the seed writes an earlier opening balance of (opening + total consumption)
      for (const x of [...h].sort((a, b) => b.daysAgo - a.daysAgo)) { bal -= x.quantity; expect(bal).toBeGreaterThanOrEqual(open); }
      expect(bal).toBe(open);
    });
  });
});

describe('Phase 5 demo data', () => {
  it('price history has enough observations for a trend, ordered oldest first, all positive', () => {
    for (const m of DEMO_MATERIALS) {
      const h = priceHistory(m);
      expect(h).toHaveLength(PRICE_OBSERVATIONS);
      expect(h.every((x, i) => i === 0 || x.daysAgo < h[i - 1].daysAgo)).toBe(true);
      expect(h[0].daysAgo - h[h.length - 1].daysAgo).toBeGreaterThanOrEqual(60);
      for (const x of h) { expect(Number(x.price)).toBeGreaterThan(0); expect(x.price).toMatch(/^\d+\.\d{2}$/); }
    }
  });
  it('the planted price jump and consumption spike are found by the detectors, and ordinary materials are not flagged', () => {
    const { detectPriceIncrease, detectAbnormalConsumption } = require('../src/domain/risk');
    const asObs = (m: any) => priceHistory(m).map((p) => ({ date: new Date(Date.now() - p.daysAgo * 864e5), price: Number(p.price) }));
    const jumped = DEMO_MATERIALS.filter((m) => detectPriceIncrease({ material: { id: m.sku, name: m.name }, observations: asObs(m) }));
    expect(jumped.map((m) => m.sku)).toEqual(Object.keys(PRICE_JUMP));
    const weeksOf = (m: any) => consumptionHistory(m).sort((a, b) => b.daysAgo - a.daysAgo).map((x) => x.quantity);
    const spiked = DEMO_MATERIALS.filter((m) => detectAbnormalConsumption({ material: { id: m.sku, name: m.name }, weeks: weeksOf(m), lastWeekStart: 'x' }));
    expect(spiked.map((m) => m.sku)).toEqual([CONSUMPTION_SPIKE_SKU]);
  });
  it('the demo history is enough for the ML service to evaluate every model (needs 30+ weeks)', () => {
    expect(consumptionHistory(DEMO_MATERIALS[0]).length).toBeGreaterThanOrEqual(30);
  });
});

