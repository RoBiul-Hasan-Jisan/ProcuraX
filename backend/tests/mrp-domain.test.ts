import { explodeBom, selectBom, type Bom } from '../src/domain/bom';
import { planMaterial, urgencyFor, addDays } from '../src/domain/mrp';
import { recommendReorder } from '../src/domain/reorder';

const TODAY = new Date('2026-06-01T00:00:00Z');
const d = (n: number) => addDays(TODAY, n);
const demand = (n: number, adj: string, gross = adj, source = 'PP-1') => ({ date: d(n), gross, adjusted: adj, source, path: [] });
const base = { onHand: '0', reservedOther: '0', safetyStock: '0', receipts: [], leadTimeDays: 7, today: TODAY };

describe('MRP: single material netting (spec formula)', () => {
  it('inventory greater than demand: nothing to buy', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100')], onHand: '500' });
    expect(r.netRequirement).toBe('0');
    expect(r.plannedOrders).toEqual([]);
    expect(r.urgency).toBeNull();
    expect(r.explanation.join(' ')).toMatch(/No procurement needed/);
  });
  it('inventory below demand: buys the exact shortfall', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100')], onHand: '30' });
    expect(r.netRequirement).toBe('70');
  });
  it('Net = adjusted gross + safety - available - scheduled receipts', () => {
    const r = planMaterial({ ...base, demands: [demand(20, '1000')], onHand: '300', safetyStock: '100', receipts: [{ date: d(5), quantity: '200', reference: 'PO-1' }] });
    expect(r.netRequirement).toBe('600'); // 1000 + 100 - 300 - 200
  });
  it('floors at zero when supply exceeds the requirement', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '50')], onHand: '40', receipts: [{ date: d(2), quantity: '500', reference: 'PO-1' }] });
    expect(r.netRequirement).toBe('0');
  });
  it('safety stock increases the requirement, and is protected even when stock covers demand exactly', () => {
    expect(planMaterial({ ...base, demands: [demand(10, '100')], onHand: '100', safetyStock: '25' }).netRequirement).toBe('25');
  });
  it('zero demand produces no requirement even when below safety stock', () => {
    const r = planMaterial({ ...base, demands: [], onHand: '0', safetyStock: '50' });
    expect(r.netRequirement).toBe('0');
    expect(r.plannedOrders).toHaveLength(0);
  });
});

describe('MRP: reserved stock and receipts are not double counted', () => {
  it('subtracts reservations for other purposes from available stock', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100')], onHand: '150', reservedOther: '80' });
    expect(r.available).toBe('70');
    expect(r.netRequirement).toBe('30');
  });
  it('treats over-reserved stock as zero available, never negative', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '10')], onHand: '20', reservedOther: '50' });
    expect(r.available).toBe('0');
    expect(r.netRequirement).toBe('10');
    expect(r.explanation[0]).toMatch(/exceeds on-hand/);
  });
  it('a receipt covers demand once, even when there are several demand dates', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100'), demand(20, '100')], receipts: [{ date: d(5), quantity: '150', reference: 'PO-1' }] });
    expect(r.netRequirement).toBe('50'); // 200 demand - 150 receipt, not 100 - 150 and 100 - 150 separately
  });
  it('stock is used once across multiple plans', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '60', '60', 'PP-1'), demand(12, '60', '60', 'PP-2')], onHand: '100' });
    expect(r.netRequirement).toBe('20');
  });
});

describe('MRP: time phasing', () => {
  it('a receipt arriving after the need date does not cover it', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100')], receipts: [{ date: d(15), quantity: '100', reference: 'PO-LATE' }] });
    expect(r.netRequirement).toBe('100');
    expect(r.lateReceipts.map((x) => x.reference)).toEqual(['PO-LATE']);
  });
  it('a late receipt still covers a later demand date', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100'), demand(30, '100')], receipts: [{ date: d(20), quantity: '100', reference: 'PO-1' }] });
    expect(r.plannedOrders).toHaveLength(1);
    expect(r.plannedOrders[0].quantity).toBe('100'); // first date uncovered; second covered by the receipt
    expect(r.netRequirement).toBe('100');
  });
  it('orders for earlier dates count as supply for later dates', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '100'), demand(30, '100')] });
    expect(r.plannedOrders.map((o) => o.quantity)).toEqual(['100', '100']);
    expect(r.netRequirement).toBe('200');
  });
  it('merges plans needing the same date into one order', () => {
    const r = planMaterial({ ...base, demands: [demand(10, '40', '40', 'PP-1'), demand(10, '60', '60', 'PP-2')] });
    expect(r.plannedOrders).toHaveLength(1);
    expect(r.plannedOrders[0].quantity).toBe('100');
  });
  it('is independent of the order the demands are supplied in', () => {
    const a = planMaterial({ ...base, demands: [demand(10, '100'), demand(30, '50')], onHand: '120' });
    const b = planMaterial({ ...base, demands: [demand(30, '50'), demand(10, '100')], onHand: '120' });
    expect(a.netRequirement).toBe(b.netRequirement);
    expect(a.netRequirement).toBe('30');
  });
});

describe('MRP: lead time and urgency', () => {
  it('releases the order lead-time days before the need date', () => {
    const r = planMaterial({ ...base, demands: [demand(30, '10')], leadTimeDays: 10 });
    const o = r.plannedOrders[0];
    expect(o.releaseDate.toISOString().slice(0, 10)).toBe('2026-06-21');
    expect(o.expectedArrival.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(o.late).toBe(false);
  });
  it('when lead time does not fit, orders today, is late and critical', () => {
    const r = planMaterial({ ...base, demands: [demand(5, '10')], leadTimeDays: 14 });
    const o = r.plannedOrders[0];
    expect(o.releaseDate.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(o.late).toBe(true);
    expect(o.daysLate).toBe(9);
    expect(r.urgency).toBe('critical');
    expect(r.explanation.join(' ')).toMatch(/9 day\(s\) too late/);
  });
  it('grades urgency by days until release', () => {
    const o = (rel: number) => urgencyFor({ late: false, releaseDate: d(rel) }, TODAY);
    expect([o(0), o(3), o(4), o(10), o(11)]).toEqual(['high', 'high', 'medium', 'medium', 'low']);
  });
  it('a material takes its most urgent order', () => {
    const r = planMaterial({ ...base, demands: [demand(40, '10'), demand(9, '10')], leadTimeDays: 7 });
    expect(r.urgency).toBe('high'); // release for day 9 is day 2
  });
  it('zero lead time is allowed', () => {
    const r = planMaterial({ ...base, demands: [demand(5, '10')], leadTimeDays: 0 });
    expect(r.plannedOrders[0].late).toBe(false);
  });
});

describe('MRP: supplier capacity and exactness', () => {
  it('flags demand above the supplier single-order capacity and says how many orders', () => {
    const r = planMaterial({ ...base, demands: [demand(30, '1000')], supplierCapacity: '400' });
    expect(r.exceedsSupplierCapacity).toBe(true);
    expect(r.ordersNeededForCapacity).toBe(3);
  });
  it('does not flag when within capacity or unknown', () => {
    expect(planMaterial({ ...base, demands: [demand(30, '300')], supplierCapacity: '400' }).exceedsSupplierCapacity).toBe(false);
    expect(planMaterial({ ...base, demands: [demand(30, '300')] }).exceedsSupplierCapacity).toBe(false);
  });
  it('uses exact decimals (0.1 + 0.2) and rounds suggested orders UP to 3 dp', () => {
    expect(planMaterial({ ...base, demands: [demand(10, '0.1'), demand(10, '0.2')], onHand: '0.3' }).netRequirement).toBe('0');
    expect(planMaterial({ ...base, demands: [demand(10, '1.00041')] }).plannedOrders[0].quantity).toBe('1.001');
  });
});

describe('BOM selection', () => {
  const mk = (over: Partial<Bom>): Bom => ({ id: 'b', number: 'BOM-1', product: 'P', version: 1, status: 'active', effectiveFrom: new Date('2026-01-01'), items: [], ...over });
  it('uses only active BOMs effective on the date, newest effective date first, then highest version', () => {
    const boms = [mk({ id: 'a', version: 1 }), mk({ id: 'b', version: 2, effectiveFrom: new Date('2026-03-01') }), mk({ id: 'c', version: 3, status: 'draft', effectiveFrom: new Date('2026-03-01') }), mk({ id: 'd', version: 4, status: 'obsolete', effectiveFrom: new Date('2026-03-01') })];
    expect(selectBom(boms, 'P', new Date('2026-02-01'))!.id).toBe('a');
    expect(selectBom(boms, 'P', new Date('2026-04-01'))!.id).toBe('b'); // draft/obsolete ignored
    expect(selectBom(boms, 'P', new Date('2025-12-01'))).toBeNull();
    expect(selectBom(boms, 'OTHER', new Date('2026-04-01'))).toBeNull();
  });
  it('breaks effective-date ties by version', () => {
    const boms = [mk({ id: 'a', version: 1 }), mk({ id: 'b', version: 2 })];
    expect(selectBom(boms, 'P', new Date('2026-06-01'))!.id).toBe('b');
  });
});

describe('BOM explosion', () => {
  const on = new Date('2026-06-01');
  const bom = (product: string, items: Bom['items'], over: Partial<Bom> = {}): Bom => ({ id: `id-${product}`, number: `BOM-${product}`, product, version: 1, status: 'active', effectiveFrom: new Date('2026-01-01'), items, ...over });
  it('gross = quantity x BOM quantity; adjusted adds wastage', () => {
    const r = explodeBom('ROD', '500', on, [bom('ROD', [{ material: 'BIL', quantity: '1.02', wastagePercent: '5' }])]);
    expect(r.issues).toEqual([]);
    expect(r.requirements[0].gross.toFixed()).toBe('510');
    expect(r.requirements[0].adjusted.toFixed()).toBe('535.5'); // 510 x 1.05
  });
  it('handles tiny per-unit quantities exactly', () => {
    const r = explodeBom('ROD', '1000', on, [bom('ROD', [{ material: 'REF', quantity: '0.0008', wastagePercent: '0' }])]);
    expect(r.requirements[0].gross.toFixed()).toBe('0.8');
  });
  it('multi-level: the sub-product is produced from its own BOM using the ADJUSTED quantity', () => {
    const boms = [
      bom('ROD', [{ subProduct: 'BILLET', quantity: '1', wastagePercent: '10' }, { material: 'WIRE', quantity: '0.01', wastagePercent: '0' }]),
      bom('BILLET', [{ material: 'SCRAP', quantity: '1.1', wastagePercent: '0' }]),
    ];
    const r = explodeBom('ROD', '100', on, boms);
    const scrap = r.requirements.find((x) => x.material === 'SCRAP')!;
    expect(scrap.gross.toFixed()).toBe('121'); // 100 rod -> 110 billet (10% wastage) -> 110 x 1.1 scrap
    expect(scrap.path.length).toBe(2);
    expect(r.requirements.find((x) => x.material === 'WIRE')!.gross.toFixed()).toBe('1');
  });
  it('reports a missing BOM rather than silently returning nothing', () => {
    const r = explodeBom('ROD', '10', on, []);
    expect(r.requirements).toEqual([]);
    expect(r.issues[0].message).toMatch(/No active BOM/);
  });
  it('reports a missing sub-product BOM but keeps the other components', () => {
    const r = explodeBom('ROD', '10', on, [bom('ROD', [{ subProduct: 'BILLET', quantity: '1', wastagePercent: '0' }, { material: 'WIRE', quantity: '1', wastagePercent: '0' }])]);
    expect(r.requirements.map((x) => x.material)).toEqual(['WIRE']);
    expect(r.issues).toHaveLength(1);
  });
  it('detects circular BOMs', () => {
    const r = explodeBom('A', '1', on, [bom('A', [{ subProduct: 'B', quantity: '1', wastagePercent: '0' }]), bom('B', [{ subProduct: 'A', quantity: '1', wastagePercent: '0' }])]);
    expect(r.issues[0].message).toMatch(/Circular/);
  });
  it('ignores a BOM that is not yet effective', () => {
    const r = explodeBom('ROD', '1', on, [bom('ROD', [{ material: 'X', quantity: '1', wastagePercent: '0' }], { effectiveFrom: new Date('2027-01-01') })]);
    expect(r.issues).toHaveLength(1);
  });
});

describe('reorder planning', () => {
  const base2 = { available: '100', onOrder: '0', safetyStock: '50', configuredReorderPoint: '999', leadTimeDays: 10, today: TODAY };
  it('derives the reorder point from consumption: lead-time demand + safety stock', () => {
    const r = recommendReorder({ ...base2, consumedInLookback: '900' }); // 10/day
    expect(r.averageDailyConsumption).toBe('10');
    expect(r.leadTimeDemand).toBe('100');
    expect(r.reorderPoint).toBe('150');
    expect(r.basis).toBe('consumption');
  });
  it('orders up to reorder point + coverage when position is at or below it', () => {
    const r = recommendReorder({ ...base2, consumedInLookback: '900' });
    expect(r.reorderNow).toBe(true);
    expect(r.suggestedQuantity).toBe('350'); // 150 + 30 x 10 - 100
    expect(r.plannedOrderDate!.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(r.expectedDelivery!.toISOString().slice(0, 10)).toBe('2026-06-11');
  });
  it('counts outstanding purchase orders in the position (no double ordering)', () => {
    const r = recommendReorder({ ...base2, consumedInLookback: '900', onOrder: '500' });
    expect(r.reorderNow).toBe(false);
    expect(r.suggestedQuantity).toBe('0');
  });
  it('falls back to the configured reorder point and says so when there is no consumption', () => {
    const r = recommendReorder({ ...base2, consumedInLookback: '0', configuredReorderPoint: '300' });
    expect(r.basis).toBe('configured');
    expect(r.reorderPoint).toBe('300');
    expect(r.suggestedQuantity).toBe('200');
    expect(r.explanation[0]).toMatch(/No consumption/);
  });
  it('does nothing when no level is configured and there is no history', () => {
    expect(recommendReorder({ ...base2, consumedInLookback: '0', configuredReorderPoint: '0' }).reorderNow).toBe(false);
  });
});
