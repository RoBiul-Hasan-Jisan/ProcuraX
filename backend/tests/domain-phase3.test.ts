import { canPoTransition, canReceiveAgainst, statusAfterReceipt, validateReceipt } from '../src/domain/purchaseOrder';
import { signedDelta, stockStatus, shortfallToReorderPoint } from '../src/domain/inventory';
import { matchInvoice } from '../src/domain/invoiceMatch';

describe('PO state machine', () => {
  it('allows the normal path', () => {
    expect(canPoTransition('draft', 'issued')).toBe(true);
    expect(canPoTransition('issued', 'partially_received')).toBe(true);
    expect(canPoTransition('partially_received', 'received')).toBe(true);
    expect(canPoTransition('partially_received', 'closed')).toBe(true);
  });
  it('blocks shortcuts and terminal states', () => {
    expect(canPoTransition('draft', 'received')).toBe(false);
    expect(canPoTransition('received', 'issued')).toBe(false);
    expect(canPoTransition('cancelled', 'issued')).toBe(false);
    expect(canPoTransition('partially_received', 'cancelled')).toBe(false); // receipts make a PO uncancellable
  });
  it('receives only against issued / partially received', () => {
    expect(['draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled'].filter((s) => canReceiveAgainst(s as any))).toEqual(['issued', 'partially_received']);
  });
});

describe('goods receipt validation', () => {
  const po = [{ material: 'a', quantity: '100', acceptedQty: '40' }, { material: 'b', quantity: '10', acceptedQty: '0' }];
  it('accepts a valid partial receipt', () => {
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '60', rejectedQty: '0' }])).toEqual([]);
  });
  it('rejects over-receipt against the remaining quantity', () => {
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '60.001', rejectedQty: '0' }])[0]).toMatch(/exceeds the remaining/);
  });
  it('rejected goods do not use up the ordered quantity but need a reason', () => {
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '60', rejectedQty: '5', rejectionReason: 'cracks' }])).toEqual([]);
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '0', rejectedQty: '5' }])[0]).toMatch(/reason/);
  });
  it('rejects unknown materials, duplicates, negatives and empty receipts', () => {
    expect(validateReceipt(po, [{ material: 'zzz', acceptedQty: '1', rejectedQty: '0' }]).join()).toMatch(/not on the purchase order/);
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '1', rejectedQty: '0' }, { material: 'a', acceptedQty: '1', rejectedQty: '0' }]).join()).toMatch(/more than once/);
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '-1', rejectedQty: '0' }]).join()).toMatch(/negative/);
    expect(validateReceipt(po, [{ material: 'a', acceptedQty: '0', rejectedQty: '0' }]).join()).toMatch(/Nothing was received/);
  });
  it('is exact with decimals (0.1 + 0.2 style quantities)', () => {
    expect(validateReceipt([{ material: 'a', quantity: '0.3', acceptedQty: '0.1' }], [{ material: 'a', acceptedQty: '0.2', rejectedQty: '0' }])).toEqual([]);
  });
  it('status flips to received only when every line is complete', () => {
    expect(statusAfterReceipt([{ material: 'a', quantity: '10', acceptedQty: '10' }, { material: 'b', quantity: '5', acceptedQty: '4.999' }])).toBe('partially_received');
    expect(statusAfterReceipt([{ material: 'a', quantity: '10', acceptedQty: '10' }, { material: 'b', quantity: '5', acceptedQty: '5' }])).toBe('received');
  });
});

describe('stock movement rules', () => {
  it('signs movements correctly', () => {
    expect(signedDelta('receipt', '5').toFixed()).toBe('5');
    expect(signedDelta('issue', '5').toFixed()).toBe('-5');
    expect(signedDelta('transfer_out', '5').toFixed()).toBe('-5');
    expect(signedDelta('transfer_in', '5').toFixed()).toBe('5');
    expect(signedDelta('adjustment', '5', 'decrease').toFixed()).toBe('-5');
    expect(signedDelta('adjustment', '5', 'increase').toFixed()).toBe('5');
  });
  it('refuses zero, negative and direction-less adjustments', () => {
    expect(() => signedDelta('receipt', '0')).toThrow();
    expect(() => signedDelta('issue', '-1')).toThrow();
    expect(() => signedDelta('adjustment', '1')).toThrow(/direction/);
  });
  const lv = { safetyStock: 100, minimumStock: 150, reorderPoint: 300 };
  it('classifies stock against material levels', () => {
    expect(stockStatus('100', lv)).toBe('critical');
    expect(stockStatus('101', lv)).toBe('low');
    expect(stockStatus('150.5', lv)).toBe('reorder');
    expect(stockStatus('300', lv)).toBe('reorder');
    expect(stockStatus('300.001', lv)).toBe('ok');
    expect(stockStatus('0', lv)).toBe('critical');
  });
  it('ignores unset (0) levels instead of flagging everything', () => {
    expect(stockStatus('0', { safetyStock: 0, minimumStock: 0, reorderPoint: 0 })).toBe('ok');
  });
  it('shortfall never goes negative', () => {
    expect(shortfallToReorderPoint('120', 300).toFixed()).toBe('180');
    expect(shortfallToReorderPoint('400', 300).toFixed()).toBe('0');
  });
});

describe('three-way invoice match', () => {
  const po = { lines: [{ material: 'a', unitPrice: '100', acceptedQty: '50' }], transportCost: '500', additionalCharges: '100', taxRatePercent: '5' };
  const inv = (over: any = {}) => ({ lines: [{ material: 'a', quantity: '50', unitPrice: '100' }], transportCost: '500', additionalCharges: '100', taxRatePercent: '5', ...over });
  it('matches an exact invoice and computes the total itself', () => {
    const r = matchInvoice(po, inv());
    expect(r.ok).toBe(true);
    expect(r.invoiceTotal).toBe('5850.00'); // 5000 + 500 + 100 + 250 tax (5% of material only)
  });
  it('flags price differences without tolerance', () => {
    expect(matchInvoice(po, inv({ lines: [{ material: 'a', quantity: '50', unitPrice: '100.01' }] })).issues[0]).toMatch(/differs from the PO price/);
  });
  it('flags billing more than accepted (not merely ordered)', () => {
    expect(matchInvoice(po, inv({ lines: [{ material: 'a', quantity: '50.001', unitPrice: '100' }] })).issues[0]).toMatch(/exceeds the accepted/);
  });
  it('counts earlier invoices against what can still be billed', () => {
    const r = matchInvoice(po, inv({ lines: [{ material: 'a', quantity: '20', unitPrice: '100' }] }), { a: '40' });
    expect(r.ok).toBe(false);
    expect(matchInvoice(po, inv({ lines: [{ material: 'a', quantity: '10', unitPrice: '100' }] }), { a: '40' }).ok).toBe(true);
  });
  it('flags extra charges, tax rate changes and foreign materials', () => {
    expect(matchInvoice(po, inv({ transportCost: '500.01' })).ok).toBe(false);
    expect(matchInvoice(po, inv({ additionalCharges: '101' })).ok).toBe(false);
    expect(matchInvoice(po, inv({ taxRatePercent: '7.5' })).ok).toBe(false);
    expect(matchInvoice(po, inv({ lines: [{ material: 'x', quantity: '1', unitPrice: '1' }] })).issues.join()).toMatch(/not on the purchase order/);
  });
  it('an invoice for goods never received does not match', () => {
    const none = { ...po, lines: [{ material: 'a', unitPrice: '100', acceptedQty: '0' }] };
    expect(matchInvoice(none, inv()).ok).toBe(false);
  });
  it('allows lower charges than the PO', () => {
    expect(matchInvoice(po, inv({ transportCost: '400' })).ok).toBe(true);
  });
});
