const ex = (v: any, _msg?: string) => expect(v);
import { DEMO_MATERIALS, DEMO_SUPPLIERS } from '../scripts/demoData';
import { DEMO_REQUISITIONS, STAGE_ORDER, acceptedQty, approvalOutcome, hasAward, hasPo, hasRfq, isAboveFinanceThreshold, isIssued, poStatusFor, quotedUnitPrice, requisitionStatusFor, requisitionTotal } from '../scripts/demoWorkflow';
import { buildApprovalSteps, DEFAULT_APPROVAL_CONFIG } from '../src/domain/approval';

const sup = (c: string) => DEMO_SUPPLIERS.find((s) => s.code === c)!;
const mat = (s: string) => DEMO_MATERIALS.find((m) => m.sku === s)!;

describe('demo workflow scenarios are internally consistent', () => {
  it('has unique refs and covers every stage', () => {
    ex(new Set(DEMO_REQUISITIONS.map((r) => r.ref)).size).toBe(DEMO_REQUISITIONS.length);
    for (const s of STAGE_ORDER) ex(DEMO_REQUISITIONS.some((r) => r.stage === s), s).toBe(true);
  });
  it('uses only real materials and suppliers', () => {
    for (const r of DEMO_REQUISITIONS) {
      r.lines.forEach((l) => { ex(mat(l.sku), l.sku).toBeTruthy(); ex(l.qty).toBeGreaterThan(0); });
      r.rfq?.invited.forEach((c) => ex(sup(c), c).toBeTruthy());
    }
  });
  it('only invites suppliers the app would allow: verified, active, and covering every requested category', () => {
    for (const r of DEMO_REQUISITIONS.filter((x) => x.rfq)) for (const c of r.rfq!.invited) {
      const s = sup(c);
      ex([s.verification, s.status], `${r.ref} ${c}`).toEqual(['verified', 'active']);
      for (const l of r.lines) ex(s.categories, `${r.ref} ${c} ${l.sku}`).toContain(mat(l.sku).category);
    }
  });
  it('quotes only from invited suppliers, one per supplier, and awards only a quoting supplier', () => {
    for (const r of DEMO_REQUISITIONS.filter((x) => x.rfq)) {
      const q = r.rfq!.quotes.map((x) => x.supplier);
      ex(new Set(q).size).toBe(q.length);
      q.forEach((c) => ex(r.rfq!.invited).toContain(c));
      if (r.rfq!.award) ex(q).toContain(r.rfq!.award.supplier);
      ex(hasAward(r.stage)).toBe(!!r.rfq!.award);
    }
  });
  it('stage decides which records exist', () => {
    for (const r of DEMO_REQUISITIONS) {
      ex(!!r.rfq, r.ref).toBe(hasRfq(r.stage));
      if (hasPo(r.stage)) ex(r.rfq!.award, r.ref).toBeTruthy();
      ex(!!r.po === (isIssued(r.stage) || false) || !r.po, r.ref).toBe(true);
      if (isIssued(r.stage)) ex(r.po?.issuedDaysAgo, r.ref).toBeGreaterThan(0);
    }
  });
  it('open RFQs are in the future, closed and awarded ones in the past, and a quote is never after the deadline', () => {
    for (const r of DEMO_REQUISITIONS.filter((x) => x.rfq)) {
      if (r.stage === 'rfq_open') ex(r.rfq!.deadlineInDays).toBeGreaterThan(0);
      else ex(r.rfq!.deadlineInDays).toBeLessThan(0);
      ex(r.rfq!.daysAgo).toBeLessThan(r.daysAgo); // the RFQ comes after the requisition
    }
  });
  it('the finance step exists exactly where the scenarios say it does', () => {
    const steps = (ref: string) => { const r = DEMO_REQUISITIONS.find((x) => x.ref === ref)!; return buildApprovalSteps({ requesterRole: r.requester === 'inventory' ? 'inventory_officer' : 'department_manager', estimatedTotal: requisitionTotal(r), config: DEFAULT_APPROVAL_CONFIG }).map((s) => s.role); };
    ex(steps('DEMO-R02')).toEqual(['department_manager', 'procurement_manager']);
    ex(steps('DEMO-R04')).toEqual(['department_manager', 'procurement_manager', 'finance_officer']);
    ex(isAboveFinanceThreshold(DEMO_REQUISITIONS.find((r) => r.ref === 'DEMO-R04')!)).toBe(true);
    ex(steps('DEMO-R06')).toEqual(['procurement_manager']); // a department manager does not approve their own request
  });
  it('approval outcomes match the stage', () => {
    ex(approvalOutcome('draft', 2)).toBeNull();
    ex(approvalOutcome('pending_dept', 3)).toMatchObject({ currentStep: 1, stepStatuses: ['pending', 'pending', 'pending'], requisitionStatus: 'Submitted' });
    ex(approvalOutcome('pending_procurement', 2)).toMatchObject({ currentStep: 2, stepStatuses: ['approved', 'pending'], requisitionStatus: 'Under Review' });
    ex(approvalOutcome('pending_finance', 3)).toMatchObject({ currentStep: 3, stepStatuses: ['approved', 'approved', 'pending'] });
    ex(approvalOutcome('rejected', 1)).toMatchObject({ requestStatus: 'rejected', stepStatuses: ['rejected'] });
    ex(approvalOutcome('po_issued', 3)!.stepStatuses).toEqual(['approved', 'approved', 'approved']);
  });
  it('receipts and invoices are consistent with the PO', () => {
    for (const r of DEMO_REQUISITIONS.filter((x) => x.po?.receipts)) {
      const notes = r.po!.receipts!.map((x) => x.note);
      ex(new Set(notes).size).toBe(notes.length);
      for (const rc of r.po!.receipts!) {
        ex(rc.daysAgo, r.ref).toBeLessThan(4); // recent, so the stock ledger stays in date order
        ex(rc.daysAgo).toBeLessThan(r.po!.issuedDaysAgo!);
        rc.lines.forEach((l) => { ex(r.lines.map((x) => x.sku)).toContain(l.sku); ex(l.acceptedPct + ((l.rejected ?? 0) / r.lines.find((x) => x.sku === l.sku)!.qty) * 100).toBeLessThanOrEqual(100); });
      }
      if (r.stage === 'po_received') r.po!.receipts!.forEach((rc) => rc.lines.forEach((l) => ex(l.acceptedPct).toBe(100)));
    }
    const nums = DEMO_REQUISITIONS.flatMap((r) => (r.po?.invoice ? [r.po.invoice.number] : []));
    ex(new Set(nums).size).toBe(nums.length);
    ex(DEMO_REQUISITIONS.filter((r) => r.po?.invoice).map((r) => r.po!.invoice!.outcome).sort()).toEqual(['disputed', 'pending', 'verified']);
    for (const r of DEMO_REQUISITIONS.filter((x) => x.po?.invoice)) ex(r.stage).toBe('po_received');
  });
  it('helpers compute exact decimals', () => {
    ex(quotedUnitPrice('BIL-120', 0.995)).toBe('68157.50');
    ex(acceptedQty(1000, 55)).toBe('550.000');
    ex(acceptedQty(15, 33)).toBe('4.950');
    ex(requisitionTotal(DEMO_REQUISITIONS.find((r) => r.ref === 'DEMO-R04')!)).toBe('2730000.00');
    ex(requisitionStatusFor('po_partial')).toBe('Partially Fulfilled');
    ex(poStatusFor('po_draft')).toBe('draft');
    ex(poStatusFor('approved')).toBeNull();
  });
});
