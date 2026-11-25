import {
  canTransitionRisk, detectAbnormalConsumption, detectDelayedPo, detectDuplicateInvoices, detectDuplicateRequisitions, detectHighQuotation, detectPriceIncrease,
  detectQualityDeterioration, detectRepeatedMismatch, detectSupplierDelivery, detectUnusualAdjustment, median, normaliseInvoiceNumber, robustZ,
} from '../src/domain/risk';
import { toDaily, weeklyTotals } from '../src/domain/series';
import { classify, findMaterialMention, INTENTS, SUGGESTED_QUESTIONS } from '../src/domain/assistantIntents';

const M = { id: 'm1', name: 'HMS Scrap', sku: 'SCR-HMS' };
const S = { id: 's1', name: 'Alpha Steel' };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('statistics', () => {
  it('median handles odd, even and empty', () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); expect(median([])).toBeNaN(); });
  it('robust z needs a long enough baseline and some spread', () => {
    expect(robustZ([1, 2, 3], 10)).toBeNull();
    expect(robustZ(Array(10).fill(5), 9)).toBeNull(); // MAD = 0: no score rather than infinity
    const z = robustZ([10, 11, 9, 10, 12, 10, 11, 9, 10, 11], 30)!;
    expect(z).toBeGreaterThan(3.5);
  });
  it('robust z is not distorted by one earlier outlier (median, not mean)', () => {
    const base = [10, 11, 9, 10, 12, 10, 11, 9, 10, 500];
    expect(robustZ(base, 30)!).toBeGreaterThan(3.5);
  });
});

describe('weekly series', () => {
  const end = d('2026-11-01');
  it('buckets end on the end date and treat missing days as zero', () => {
    const r = weeklyTotals([{ date: end, value: 3 }, { date: d('2026-10-05'), value: 3 }], end); // 27 days earlier: bucket complete
    expect(r.weeks).toEqual([3, 0, 0, 3]);
  });
  it('drops a partially covered oldest bucket and ignores records after the end', () => {
    const r = weeklyTotals([{ date: end, value: 3 }, { date: d('2026-10-11'), value: 3 }, { date: d('2026-11-09'), value: 999 }], end);
    expect(r.weeks).toEqual([0, 0, 3]);
    expect(r.weeks.includes(999)).toBe(false);
  });
  it('returns nothing for no data and sums same-day records', () => {
    expect(weeklyTotals([], end).weeks).toEqual([]);
    expect(toDaily([{ date: d('2026-10-01'), value: 2 }, { date: d('2026-10-01'), value: 3 }])).toEqual([{ date: '2026-10-01', value: 5 }]);
  });
});

describe('abnormal consumption', () => {
  const base = [10, 11, 9, 10, 12, 10, 11, 9, 10];
  it('fires on a spike and states the threshold', () => {
    const c = detectAbnormalConsumption({ material: M, weeks: [...base, 40], lastWeekStart: '2026-10-26' })!;
    expect(c.category).toBe('abnormal_consumption'); expect(c.reason).toContain('threshold 3.5'); expect(c.evidence.latestWeek).toBe(40);
    expect(c.dedupeKey).toBe('consumption:m1:2026-10-26');
  });
  it('stays quiet for normal variation, short history and flat history', () => {
    expect(detectAbnormalConsumption({ material: M, weeks: [...base, 12], lastWeekStart: 'x' })).toBeNull();
    expect(detectAbnormalConsumption({ material: M, weeks: [10, 11, 90], lastWeekStart: 'x' })).toBeNull();
    expect(detectAbnormalConsumption({ material: M, weeks: [...Array(10).fill(10), 50], lastWeekStart: 'x' })).toBeNull();
  });
  it('flags an unusually low week too, with a different next step', () => {
    const c = detectAbnormalConsumption({ material: M, weeks: [...base, 0], lastWeekStart: 'x' })!;
    expect(c.title).toContain('low'); expect(c.recommendedAction).toContain('paused');
  });
});

describe('price increase', () => {
  const series = (last: number) => ({ material: M, observations: [100, 101, 99, 100, 102, 100, last].map((price, i) => ({ date: new Date(Date.UTC(2026, i, 1)), price })) });
  it.each([[105, null], [111, 'medium'], [125, 'high'], [150, 'critical']])('price %s -> %s', (p, sev) => {
    const c = detectPriceIncrease(series(p as number));
    if (sev === null) expect(c).toBeNull(); else expect(c!.severity).toBe(sev);
  });
  it('ignores falling prices and short histories', () => {
    expect(detectPriceIncrease(series(60))).toBeNull();
    expect(detectPriceIncrease({ material: M, observations: [{ date: d('2026-01-01'), price: 1 }, { date: d('2026-02-01'), price: 9 }] })).toBeNull();
  });
});

describe('high quotation', () => {
  const q = (unitPrice: number, averagePrice: number | null = 100) => ({ quotationId: 'q1', rfqNumber: 'RFQ-1', supplier: S, material: M, unitPrice, averagePrice, peerPrices: [100, 104] });
  it.each([[119, null], [120, 'medium'], [140, 'high'], [170, 'critical']])('unit price %s -> %s', (p, sev) => {
    const c = detectHighQuotation(q(p as number));
    if (sev === null) expect(c).toBeNull(); else expect(c!.severity).toBe(sev);
  });
  it('needs an average price to compare with, and carries peer evidence', () => {
    expect(detectHighQuotation(q(500, null))).toBeNull();
    expect(detectHighQuotation(q(150))!.evidence.peerQuoteMedian).toBe(102);
  });
});

describe('duplicate requisitions', () => {
  const r = (id: string, day: string, over: any = {}) => ({ id, number: id, department: 'd1', requestedBy: 'A', createdAt: d(day), status: 'Submitted', items: [{ material: 'm1', quantity: 10 }, { material: 'm2', quantity: 5 }], ...over });
  it('flags the same department, items and quantities within 7 days (line order irrelevant)', () => {
    const out = detectDuplicateRequisitions([r('R1', '2026-11-01'), r('R2', '2026-11-05', { items: [{ material: 'm2', quantity: 5 }, { material: 'm1', quantity: 10 }] })]);
    expect(out).toHaveLength(1); expect(out[0].category).toBe('duplicate_requisition');
  });
  it.each([
    ['outside the window', r('R2', '2026-11-20')], ['different quantity', r('R2', '2026-11-03', { items: [{ material: 'm1', quantity: 11 }, { material: 'm2', quantity: 5 }] })],
    ['different department', r('R2', '2026-11-03', { department: 'd2' })], ['cancelled', r('R2', '2026-11-03', { status: 'Cancelled' })],
  ])('does not flag: %s', (_n, other) => { expect(detectDuplicateRequisitions([r('R1', '2026-11-01'), other as any])).toEqual([]); });
});

describe('duplicate invoices', () => {
  const inv = (id: string, invoiceNumber: string, total = 1000, date = '2026-10-01', sup = S) => ({ id, number: `I-${id}`, invoiceNumber, supplier: sup, total, invoiceDate: d(date), status: 'pending_verification', matchOk: true });
  it('normalises formatting so INV-0012, inv 12 and 12 are the same number', () => {
    expect(normaliseInvoiceNumber('INV-0012')).toBe('12'); expect(normaliseInvoiceNumber('inv 12')).toBe('12'); expect(normaliseInvoiceNumber('12')).toBe('12');
    expect(normaliseInvoiceNumber('A-100')).not.toBe(normaliseInvoiceNumber('A-1000'));
  });
  it('same number with different formatting is high', () => {
    const o = detectDuplicateInvoices([inv('a', 'INV-0012', 500), inv('b', 'inv 12', 900, '2026-10-09')]);
    expect(o).toHaveLength(1); expect(o[0].severity).toBe('high');
  });
  it('same total and date but a different number is medium', () => { expect(detectDuplicateInvoices([inv('a', 'X-1'), inv('b', 'X-2')])[0].severity).toBe('medium'); });
  it('different suppliers or different totals/dates are not duplicates', () => {
    expect(detectDuplicateInvoices([inv('a', 'INV-1'), inv('b', 'INV-1', 1000, '2026-10-01', { id: 's2', name: 'Other' })])).toEqual([]);
    expect(detectDuplicateInvoices([inv('a', 'X-1', 1000), inv('b', 'X-2', 1001)])).toEqual([]);
  });
});

describe('unusual adjustment', () => {
  const a = (delta: number, balanceAfter: number) => ({ id: 'a1', material: M, delta, balanceAfter, at: d('2026-11-01'), by: 'Ops', reason: 'Stock take' });
  it('measures against the balance BEFORE the adjustment', () => {
    expect(detectUnusualAdjustment(a(-10, 90))).toBeNull(); // 10 of 100
    expect(detectUnusualAdjustment(a(-25, 75))!.severity).toBe('medium'); // 25 of 100
    expect(detectUnusualAdjustment(a(60, 160))!.severity).toBe('high'); // 60 of 100
  });
  it('does not rate a first stock-in against a zero balance', () => { expect(detectUnusualAdjustment(a(100, 100))).toBeNull(); });
  it('keeps the recorded reason in the evidence for the reviewer', () => { expect(detectUnusualAdjustment(a(-30, 70))!.evidence.recordedReason).toBe('Stock take'); });
});

describe('delayed purchase orders', () => {
  const now = d('2026-11-30');
  const po = (expected: string, status = 'issued') => ({ id: 'p1', number: 'PO-1', status, supplier: S, expectedDeliveryDate: d(expected) });
  it.each([['2026-11-30', null], ['2026-11-29', 'low'], ['2026-11-25', 'medium'], ['2026-11-10', 'high'], ['2026-10-20', 'critical']])('expected %s -> %s', (exp, sev) => {
    const c = detectDelayedPo(po(exp), now);
    if (sev === null) expect(c).toBeNull(); else expect(c!.severity).toBe(sev);
  });
  it('ignores orders that are not open and gives each severity band its own alert key', () => {
    expect(detectDelayedPo(po('2026-10-01', 'received'), now)).toBeNull();
    expect(detectDelayedPo(po('2026-10-01', 'draft'), now)).toBeNull();
    expect(detectDelayedPo(po('2026-11-25'), now)!.dedupeKey).not.toBe(detectDelayedPo(po('2026-11-10'), now)!.dedupeKey);
  });
});

describe('supplier quality, delivery and mismatches', () => {
  const rc = (i: number, accepted: number, rejected: number) => ({ id: `r${i}`, at: new Date(Date.UTC(2026, 0, i + 1)), accepted, rejected });
  const good = [0, 1, 2, 3, 4].map((i) => rc(i, 100, 0));
  it('fires when recent acceptance drops well below earlier acceptance', () => {
    const c = detectQualityDeterioration(S, [...good, rc(5, 80, 20), rc(6, 80, 20), rc(7, 80, 20)])!;
    expect(c.severity).toBe('high'); expect(c.evidence.recentAcceptancePercent).toBe(80);
  });
  it('stays quiet with too few receipts, small drops, or a still-high rate', () => {
    expect(detectQualityDeterioration(S, [...good.slice(0, 3), rc(5, 50, 50)])).toBeNull();
    expect(detectQualityDeterioration(S, [...good, rc(5, 98, 2), rc(6, 98, 2), rc(7, 98, 2)])).toBeNull();
  });
  it('delivery: unproven suppliers are never rated; low on-time rates are', () => {
    expect(detectSupplierDelivery({ ...S, completedOrders: 3, onTimeDeliveries: 0 })).toBeNull();
    expect(detectSupplierDelivery({ ...S, completedOrders: 10, onTimeDeliveries: 9 })).toBeNull();
    expect(detectSupplierDelivery({ ...S, completedOrders: 10, onTimeDeliveries: 7 })!.severity).toBe('medium');
    expect(detectSupplierDelivery({ ...S, completedOrders: 10, onTimeDeliveries: 4 })!.severity).toBe('high');
  });
  it('repeated mismatches counts only failed matches inside the window', () => {
    const now = d('2026-11-30');
    const i = (id: string, date: string, ok: boolean | null) => ({ id, number: `I-${id}`, invoiceNumber: id, supplier: S, total: 1, invoiceDate: d(date), status: 'x', matchOk: ok });
    expect(detectRepeatedMismatch(S, [i('1', '2026-11-01', false), i('2', '2026-11-02', false), i('3', '2026-11-03', true)], now)).toBeNull();
    expect(detectRepeatedMismatch(S, [i('1', '2026-11-01', false), i('2', '2026-11-02', false), i('3', '2026-06-03', false)], now)).toBeNull();
    expect(detectRepeatedMismatch(S, ['1', '2', '3'].map((n) => i(n, '2026-11-02', false)), now)!.severity).toBe('medium');
    expect(detectRepeatedMismatch(S, ['1', '2', '3', '4', '5'].map((n) => i(n, '2026-11-02', false)), now)!.severity).toBe('high');
  });
});

describe('no alert accuses anyone', () => {
  it('wording avoids accusation words', () => {
    const all = [
      detectAbnormalConsumption({ material: M, weeks: [10, 11, 9, 10, 12, 10, 11, 9, 10, 99], lastWeekStart: 'x' })!,
      detectUnusualAdjustment({ id: 'a', material: M, delta: -60, balanceAfter: 40, at: d('2026-11-01'), by: 'Ops', reason: 'r' })!,
      detectDuplicateInvoices([{ id: 'a', number: 'a', invoiceNumber: '1', supplier: S, total: 1, invoiceDate: d('2026-10-01'), status: '', matchOk: true }, { id: 'b', number: 'b', invoiceNumber: '1', supplier: S, total: 1, invoiceDate: d('2026-10-01'), status: '', matchOk: true }])[0],
    ];
    for (const c of all) expect(`${c.title} ${c.reason} ${c.recommendedAction}`).not.toMatch(/fraud|theft|steal|stole|misconduct|corrupt|guilty|criminal/i);
  });
});

describe('review workflow transitions', () => {
  it('allows the intended path and nothing out of a closed alert', () => {
    expect(canTransitionRisk('open', 'acknowledged')).toBe(true);
    expect(canTransitionRisk('acknowledged', 'investigating')).toBe(true);
    expect(canTransitionRisk('investigating', 'resolved')).toBe(true);
    expect(canTransitionRisk('open', 'resolved')).toBe(false); // must at least be acknowledged
    expect(canTransitionRisk('resolved', 'open')).toBe(false);
    expect(canTransitionRisk('dismissed', 'investigating')).toBe(false);
  });
});

describe('assistant intent classification', () => {
  it.each([
    ['Which materials are below their reorder points?', 'below_reorder'],
    ['Which supplier has the best delivery reliability?', 'best_delivery_supplier'],
    ['Which supplier provides the best overall quotation?', 'best_quotation'],
    ['How much did the company spend on procurement this month?', 'spend_this_month'],
    ['Which purchase orders are delayed?', 'delayed_pos'],
    ['What materials will be required next month?', 'next_month_requirements'],
    ['Why has the price of HMS Scrap increased?', 'price_increase_reason'],
    ['Which department has the highest procurement expenditure?', 'department_spend'],
    ['Which invoices have mismatches?', 'invoice_mismatches'],
    ['Which materials require urgent procurement?', 'urgent_materials'],
  ])('%s -> %s', (q, intent) => { expect(classify(q).intent).toBe(intent); });
  it('every suggested question maps to an intent; only the material-specific price question has no fixed suggestion', () => {
    const got = SUGGESTED_QUESTIONS.map((q) => classify(q).intent);
    expect(got).not.toContain('unknown');
    expect(new Set(got)).toEqual(new Set(INTENTS.filter((i) => i !== 'price_increase_reason'))); // it needs a material name from the user
  });
  it('unrelated or empty questions are unknown, not guessed', () => {
    expect(classify('What is the weather in Dhaka?').intent).toBe('unknown');
    expect(classify('hello').intent).toBe('unknown');
    expect(classify('').intent).toBe('unknown');
  });
  it('finds the longest material mention', () => {
    const mats = [{ name: '[DEMO] Scrap', sku: 'SCR' }, { name: '[DEMO] HMS Scrap', sku: 'SCR-HMS' }];
    expect(findMaterialMention('why did hms scrap rise', mats)!.sku).toBe('SCR-HMS');
    expect(findMaterialMention('why did the price rise', mats)).toBeNull();
  });
});
