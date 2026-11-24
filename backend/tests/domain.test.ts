import { computeLandedCost, dec, str } from '../src/domain/money';
import { applyDecision, buildApprovalSteps, validateDecision, DEFAULT_APPROVAL_CONFIG, type ApprovalStep } from '../src/domain/approval';
import { canTransition, isCancellable, isEditable } from '../src/domain/requisitionStatus';
import { validateQuotationWindow } from '../src/domain/quotationRules';
import { DEFAULT_WEIGHTS, MIN_HISTORY_ORDERS, normalizeWeights, scoreQuotations, type ScoringInput } from '../src/domain/scoring';

describe('landed cost (decimal arithmetic)', () => {
  it('sums material + transport + additional + tax exactly', () => {
    const r = computeLandedCost({ quantity: 100, unitPrice: '65000.10', transportCost: '12000', additionalCharges: '500.55', taxRatePercent: 5 });
    expect(r.materialCost.toFixed(2)).toBe('6500010.00');
    expect(r.taxAmount.toFixed(2)).toBe('325000.50');
    expect(r.totalLandedCost.toFixed(2)).toBe('6837511.05');
  });
  it('avoids binary floating point error (0.1 + 0.2 style)', () => {
    const r = computeLandedCost({ quantity: 1, unitPrice: '0.1', transportCost: '0.2' });
    expect(r.totalLandedCost.toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3); // the float path would be wrong
  });
  it('rounds half-up to 2dp per component', () => {
    expect(computeLandedCost({ quantity: 1, unitPrice: '10.005' }).materialCost.toFixed(2)).toBe('10.01');
  });
  it('rejects zero quantity and negative price', () => {
    expect(() => computeLandedCost({ quantity: 0, unitPrice: 1 })).toThrow();
    expect(() => computeLandedCost({ quantity: 1, unitPrice: -1 })).toThrow();
  });
  it('formats API strings', () => {
    expect(str(dec('12.3'))).toBe('12.30');
  });
});

describe('approval chain', () => {
  const cfg = DEFAULT_APPROVAL_CONFIG;
  it('builds dept -> procurement for small requisitions', () => {
    const steps = buildApprovalSteps({ requesterRole: 'inventory_officer', estimatedTotal: '999999.99', config: cfg });
    expect(steps.map((s) => s.role)).toEqual(['department_manager', 'procurement_manager']);
  });
  it('adds finance at/above the threshold', () => {
    const steps = buildApprovalSteps({ requesterRole: 'inventory_officer', estimatedTotal: '1000000', config: cfg });
    expect(steps.map((s) => s.role)).toEqual(['department_manager', 'procurement_manager', 'finance_officer']);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3]);
  });
  it('skips the department step when the requester is a department manager', () => {
    const steps = buildApprovalSteps({ requesterRole: 'department_manager', estimatedTotal: 10, config: cfg });
    expect(steps.map((s) => s.role)).toEqual(['procurement_manager']);
  });
  it('honours a configured threshold', () => {
    const steps = buildApprovalSteps({ requesterRole: 'inventory_officer', estimatedTotal: 600, config: { ...cfg, financeThreshold: '500' } });
    expect(steps.at(-1)?.role).toBe('finance_officer');
  });

  const steps: ApprovalStep[] = [
    { order: 1, role: 'department_manager', label: 'd', status: 'pending' },
    { order: 2, role: 'procurement_manager', label: 'p', status: 'pending' },
  ];
  const base = {
    request: { status: 'pending' as const, currentStep: 1, steps },
    requisition: { requestedBy: 'u-req', department: 'dept-1' },
    user: { id: 'u-mgr', role: 'department_manager' as const, departmentId: 'dept-1' },
    action: 'approve' as const,
  };
  it('allows the right approver', () => expect(validateDecision(base)).toBeNull());
  it('blocks the wrong role', () => expect(validateDecision({ ...base, user: { ...base.user, role: 'finance_officer' } })).toMatch(/not the approver/));
  it('blocks admins from approving', () => expect(validateDecision({ ...base, user: { ...base.user, role: 'system_admin' } })).not.toBeNull());
  it('blocks self-approval', () => expect(validateDecision({ ...base, user: { ...base.user, id: 'u-req' } })).toMatch(/own requisition/));
  it('blocks a manager from another department', () => expect(validateDecision({ ...base, user: { ...base.user, departmentId: 'dept-2' } })).toMatch(/own department/));
  it('blocks deciding a step twice', () => {
    const decided = { ...base, request: { ...base.request, steps: [{ ...steps[0], status: 'approved' as const }, steps[1]] } };
    expect(validateDecision(decided)).toMatch(/already been decided/);
  });
  it('blocks decisions on a non-pending request', () => expect(validateDecision({ ...base, request: { ...base.request, status: 'rejected' } })).toMatch(/no longer pending/));
  it('requires a comment to reject or request changes', () => {
    expect(validateDecision({ ...base, action: 'reject' })).toMatch(/comment is required/);
    expect(validateDecision({ ...base, action: 'request_modification', comment: '  ' })).toMatch(/comment is required/);
    expect(validateDecision({ ...base, action: 'reject', comment: 'over budget' })).toBeNull();
  });

  it('advances to the next step then approves at the last', () => {
    expect(applyDecision({ currentStep: 1, steps }, 'approve')).toMatchObject({ requestStatus: 'pending', nextStep: 2, requisitionStatus: 'Under Review' });
    expect(applyDecision({ currentStep: 2, steps }, 'approve')).toMatchObject({ requestStatus: 'approved', requisitionStatus: 'Approved' });
  });
  it('reject / modification end the request with the right requisition status', () => {
    expect(applyDecision({ currentStep: 1, steps }, 'reject').requisitionStatus).toBe('Rejected');
    expect(applyDecision({ currentStep: 1, steps }, 'request_modification').requisitionStatus).toBe('Modification Requested');
  });
});

describe('requisition state machine', () => {
  it('permits the happy path', () => {
    expect(canTransition('Draft', 'Submitted')).toBe(true);
    expect(canTransition('Submitted', 'Under Review')).toBe(true);
    expect(canTransition('Approved', 'RFQ Created')).toBe(true);
  });
  it('forbids shortcuts and revival', () => {
    expect(canTransition('Draft', 'Approved')).toBe(false);
    expect(canTransition('Rejected', 'Approved')).toBe(false);
    expect(canTransition('Rejected', 'RFQ Created')).toBe(false);
    expect(canTransition('Cancelled', 'Draft')).toBe(false);
  });
  it('limits editing and cancelling', () => {
    expect(isEditable('Draft')).toBe(true);
    expect(isEditable('Modification Requested')).toBe(true);
    expect(isEditable('Approved')).toBe(false);
    expect(isCancellable('Approved')).toBe(true);
    expect(isCancellable('RFQ Created')).toBe(false);
    expect(isCancellable('Completed')).toBe(false);
  });
});

describe('quotation window', () => {
  const rfq = { status: 'open' as const, deadline: new Date('2026-12-01T00:00:00Z'), invitedSuppliers: ['s1', 's2'] };
  const now = new Date('2026-11-30T00:00:00Z');
  it('allows invited suppliers before the deadline', () => expect(validateQuotationWindow(rfq, 's1', now)).toBeNull());
  it('rejects uninvited suppliers', () => expect(validateQuotationWindow(rfq, 's9', now)).toMatch(/not invited/));
  it('rejects unlinked accounts', () => expect(validateQuotationWindow(rfq, null, now)).toMatch(/not linked/));
  it('rejects after the deadline', () => expect(validateQuotationWindow(rfq, 's1', new Date('2026-12-02'))).toMatch(/deadline/));
  it('rejects closed or awarded RFQs', () => {
    expect(validateQuotationWindow({ ...rfq, status: 'closed' }, 's1', now)).toMatch(/no longer open/);
    expect(validateQuotationWindow({ ...rfq, status: 'awarded' }, 's1', now)).toMatch(/no longer open/);
  });
});

describe('quotation scoring', () => {
  const proven = { completedOrders: 20, onTimeDeliveries: 19, unitsReceived: 1000, unitsAccepted: 990 };
  const mk = (id: string, cost: string, days: number, pay: number, history = proven): ScoringInput => ({
    quotationId: id, supplierId: `s-${id}`, supplierName: `Supplier ${id}`, totalLandedCost: dec(cost), deliveryDays: days, paymentTermsDays: pay, history,
  });

  it('normalises weights to 100', () => {
    const n = normalizeWeights({ price: 3, delivery: 2.5, quality: 2, leadTime: 1.5, payment: 1 });
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(n.price).toBeCloseTo(30);
  });
  it('rejects bad weights', () => {
    expect(() => normalizeWeights({ ...DEFAULT_WEIGHTS, price: -1 })).toThrow();
    expect(() => normalizeWeights({ price: 0, delivery: 0, quality: 0, leadTime: 0, payment: 0 })).toThrow();
  });
  it('ranks the cheaper, equally reliable quote first and reports differences', () => {
    const r = scoreQuotations([mk('A', '1000000', 10, 30), mk('B', '900000', 10, 30)]);
    expect(r[0].supplierName).toBe('Supplier B');
    expect(r[0].rank).toBe(1);
    expect(r[0].costDifference.toFixed(2)).toBe('0.00');
    expect(r[1].costDifference.toFixed(2)).toBe('100000.00');
    expect(r[1].costDifferencePercent).toBeCloseTo(11.11, 1);
    expect(r[0].reasons[0]).toMatch(/Lowest/);
  });
  it('does not treat an unproven supplier as reliable', () => {
    const young = { completedOrders: MIN_HISTORY_ORDERS - 1, onTimeDeliveries: MIN_HISTORY_ORDERS - 1, unitsReceived: 400, unitsAccepted: 400 };
    const r = scoreQuotations([mk('A', '1000', 10, 30, young)]);
    expect(r[0].insufficientHistory).toBe(true);
    expect(r[0].scores.delivery).toBe(50); // not 100, despite a perfect (tiny) record
    expect(r[0].scores.quality).toBe(50);
    expect(r[0].reasons.join(' ')).toMatch(/unproven/);
  });
  it('lets a proven supplier beat a slightly cheaper unproven one', () => {
    const young = { completedOrders: 1, onTimeDeliveries: 1, unitsReceived: 10, unitsAccepted: 10 };
    const r = scoreQuotations([mk('cheap', '980000', 10, 30, young), mk('solid', '1000000', 10, 30)]);
    expect(r[0].supplierName).toBe('Supplier solid');
  });
  it('changing weights changes the ranking', () => {
    const inputs = [mk('cheap', '800000', 30, 0), mk('fast', '1000000', 5, 60)];
    expect(scoreQuotations(inputs, { price: 100, delivery: 0, quality: 0, leadTime: 0, payment: 0 })[0].supplierName).toBe('Supplier cheap');
    expect(scoreQuotations(inputs, { price: 0, delivery: 0, quality: 0, leadTime: 100, payment: 0 })[0].supplierName).toBe('Supplier fast');
  });
  it('reports the delivery gap', () => {
    const r = scoreQuotations([mk('A', '1', 12, 30), mk('B', '1', 7, 30)]);
    expect(r.find((x) => x.supplierName === 'Supplier A')?.deliveryDifferenceDays).toBe(5);
  });
  it('handles an empty list and a single quotation', () => {
    expect(scoreQuotations([])).toEqual([]);
    expect(scoreQuotations([mk('A', '1', 1, 1)])).toHaveLength(1);
  });
});
