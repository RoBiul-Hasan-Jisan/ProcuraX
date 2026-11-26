/**
 * Synthetic DEMO WORKFLOW scenarios: one requisition at every stage of the procure-to-pay chain, so each screen has
 * something to test (approvals, create-RFQ, quote, compare, award, PO, receive goods, invoices, reports).
 * Kept free of database imports so it can be unit-tested. Everything is fictional.
 *
 * Quantities and prices are derived from the demo catalogue (average price x a per-supplier factor), so amounts look plausible.
 */
import { DEMO_MATERIALS, DEMO_SUPPLIERS } from './demoData';
import { DEFAULT_APPROVAL_CONFIG } from '../src/domain/approval';
import { Decimal } from '../src/domain/money';

export type Stage =
  | 'draft' | 'pending_dept' | 'pending_procurement' | 'pending_finance' | 'modification' | 'rejected'
  | 'approved' | 'rfq_open' | 'rfq_closed' | 'awarded' | 'po_draft' | 'po_issued' | 'po_partial' | 'po_received';

/** Order in which a requisition moves forward; used to decide which records a scenario needs. */
export const STAGE_ORDER: Stage[] = ['draft', 'pending_dept', 'pending_procurement', 'pending_finance', 'modification', 'rejected', 'approved', 'rfq_open', 'rfq_closed', 'awarded', 'po_draft', 'po_issued', 'po_partial', 'po_received'];
const idx = (s: Stage) => STAGE_ORDER.indexOf(s);
export const hasRfq = (s: Stage) => idx(s) >= idx('rfq_open');
export const hasAward = (s: Stage) => idx(s) >= idx('awarded');
export const hasPo = (s: Stage) => idx(s) >= idx('po_draft');
export const isIssued = (s: Stage) => idx(s) >= idx('po_issued');
export const isApprovedOrBeyond = (s: Stage) => idx(s) >= idx('approved');

export interface DemoQuote { supplier: string; factor: number; transportPct: number; days: number }
export interface DemoReceipt { daysAgo: number; warehouse: string; note: string; lines: { sku: string; acceptedPct: number; rejected?: number; reason?: string }[] }
export interface DemoInvoice { number: string; daysAgo: number; priceFactor: number; outcome: 'pending' | 'verified' | 'disputed'; comment?: string }
export interface DemoRfq { daysAgo: number; deadlineInDays: number; invited: string[]; quotes: DemoQuote[]; award?: { supplier: string; justification: string } }
export interface DemoPo { issuedDaysAgo?: number; receipts?: DemoReceipt[]; invoice?: DemoInvoice }
export interface DemoRequisition {
  ref: string; requester: 'inventory' | 'deptmanager'; daysAgo: number; priority: 'Low' | 'Medium' | 'High' | 'Urgent'; requiredInDays: number; reason: string;
  lines: { sku: string; qty: number }[]; stage: Stage; comment?: string; rfq?: DemoRfq; po?: DemoPo;
}

export const DEMO_REQUISITIONS: DemoRequisition[] = [
  // ---- Requisition and approval stages ----
  { ref: 'DEMO-R01', requester: 'inventory', daysAgo: 1, priority: 'Low', requiredInDays: 30, stage: 'draft', reason: 'DEMO draft: top-up of burnt lime for the next campaign. Edit and submit it to test the approval chain.', lines: [{ sku: 'CON-LIME', qty: 120 }] },
  { ref: 'DEMO-R02', requester: 'inventory', daysAgo: 2, priority: 'Medium', requiredInDays: 21, stage: 'pending_dept', reason: 'DEMO waiting for the Department Manager: bearings for the finishing mill.', lines: [{ sku: 'SPR-BRG', qty: 10 }, { sku: 'SPR-GRB', qty: 4 }] },
  { ref: 'DEMO-R03', requester: 'inventory', daysAgo: 4, priority: 'High', requiredInDays: 14, stage: 'pending_procurement', reason: 'DEMO waiting for Procurement review: gear oil for the mill gearboxes.', lines: [{ sku: 'LUB-GRB', qty: 2500 }, { sku: 'LUB-GRS', qty: 400 }] },
  { ref: 'DEMO-R04', requester: 'inventory', daysAgo: 5, priority: 'Urgent', requiredInDays: 20, stage: 'pending_finance', reason: 'DEMO waiting for Finance budget approval (total is above the finance threshold): graphite electrodes for the EAF.', lines: [{ sku: 'CON-ELE', qty: 3 }] },
  { ref: 'DEMO-R05', requester: 'inventory', daysAgo: 6, priority: 'Medium', requiredInDays: 25, stage: 'modification', comment: 'Please split this into two deliveries and confirm the spec with QA.', reason: 'DEMO sent back for changes: aluminium shot for deoxidation.', lines: [{ sku: 'FER-ALSH', qty: 10 }] },
  { ref: 'DEMO-R06', requester: 'deptmanager', daysAgo: 9, priority: 'Low', requiredInDays: 40, stage: 'rejected', comment: 'Not budgeted this quarter. Resubmit in the next cycle.', reason: 'DEMO rejected: a second variable frequency drive as a spare.', lines: [{ sku: 'ELE-VFD', qty: 1 }] },
  // ---- Approved, waiting for an RFQ (fills the "Create RFQ" requisition list) ----
  { ref: 'DEMO-R07', requester: 'deptmanager', daysAgo: 8, priority: 'High', requiredInDays: 18, stage: 'approved', reason: 'DEMO approved, no RFQ yet: silico manganese for the melt shop.', lines: [{ sku: 'FER-SIMN', qty: 40 }] },
  { ref: 'DEMO-R08', requester: 'inventory', daysAgo: 7, priority: 'Medium', requiredInDays: 22, stage: 'approved', reason: 'DEMO approved, no RFQ yet: hydraulic oil and grease for the maintenance block.', lines: [{ sku: 'LUB-HYD', qty: 6000 }, { sku: 'LUB-GRS', qty: 800 }] },
  // ---- RFQ open: supplier logins can submit quotations ----
  { ref: 'DEMO-R09', requester: 'deptmanager', daysAgo: 10, priority: 'High', requiredInDays: 16, stage: 'rfq_open', reason: 'DEMO RFQ open: heavy melting scrap. One quotation already received (sealed until the deadline).', lines: [{ sku: 'SCR-HMS', qty: 1800 }],
    rfq: { daysAgo: 3, deadlineInDays: 4, invited: ['SUP-0001', 'SUP-0002', 'SUP-0008'], quotes: [{ supplier: 'SUP-0002', factor: 0.985, transportPct: 1.5, days: 7 }] } },
  { ref: 'DEMO-R10', requester: 'inventory', daysAgo: 8, priority: 'Medium', requiredInDays: 20, stage: 'rfq_open', reason: 'DEMO RFQ open, no quotes yet: 130mm billets for the rolling mill.', lines: [{ sku: 'BIL-130', qty: 300 }],
    rfq: { daysAgo: 2, deadlineInDays: 5, invited: ['SUP-0001', 'SUP-0002'], quotes: [] } },
  // ---- RFQ closed: compare quotations and award (a human decision) ----
  { ref: 'DEMO-R11', requester: 'deptmanager', daysAgo: 14, priority: 'High', requiredInDays: 12, stage: 'rfq_closed', reason: 'DEMO ready to compare and award: shredded scrap, three quotations.', lines: [{ sku: 'SCR-SHR', qty: 1200 }],
    rfq: { daysAgo: 8, deadlineInDays: -2, invited: ['SUP-0001', 'SUP-0002', 'SUP-0008'], quotes: [
      { supplier: 'SUP-0001', factor: 1.01, transportPct: 1.2, days: 6 }, { supplier: 'SUP-0002', factor: 0.99, transportPct: 1.8, days: 9 }, { supplier: 'SUP-0008', factor: 0.955, transportPct: 2.5, days: 12 }] } },
  // ---- Awarded, then purchase orders ----
  { ref: 'DEMO-R12', requester: 'inventory', daysAgo: 18, priority: 'Medium', requiredInDays: 15, stage: 'awarded', reason: 'DEMO awarded, purchase order not created yet: bundled scrap.', lines: [{ sku: 'SCR-BND', qty: 900 }],
    rfq: { daysAgo: 12, deadlineInDays: -6, invited: ['SUP-0001', 'SUP-0002'], quotes: [{ supplier: 'SUP-0001', factor: 1.0, transportPct: 1.4, days: 8 }, { supplier: 'SUP-0002', factor: 0.975, transportPct: 1.6, days: 10 }], award: { supplier: 'SUP-0002', justification: 'Lowest landed cost and acceptable delivery time.' } } },
  { ref: 'DEMO-R13', requester: 'deptmanager', daysAgo: 20, priority: 'Medium', requiredInDays: 12, stage: 'po_draft', reason: 'DEMO draft purchase order waiting to be issued: refractory gunning mass.', lines: [{ sku: 'REF-GUN', qty: 45 }],
    rfq: { daysAgo: 15, deadlineInDays: -9, invited: ['SUP-0004'], quotes: [{ supplier: 'SUP-0004', factor: 1.02, transportPct: 1.0, days: 12 }], award: { supplier: 'SUP-0004', justification: 'Only qualified supplier for this refractory grade.' } } },
  { ref: 'DEMO-R14', requester: 'inventory', daysAgo: 22, priority: 'High', requiredInDays: 14, stage: 'po_issued', reason: 'DEMO issued, goods not received yet: high carbon ferro manganese. Record a receipt against it.', lines: [{ sku: 'FER-HCMN', qty: 50 }],
    rfq: { daysAgo: 17, deadlineInDays: -11, invited: ['SUP-0003'], quotes: [{ supplier: 'SUP-0003', factor: 1.0, transportPct: 1.1, days: 14 }], award: { supplier: 'SUP-0003', justification: 'Single qualified ferro-alloy supplier.' } }, po: { issuedDaysAgo: 5 } },
  { ref: 'DEMO-R15', requester: 'deptmanager', daysAgo: 35, priority: 'Urgent', requiredInDays: 5, stage: 'po_issued', reason: 'DEMO LATE delivery: 120mm billets, expected date has passed (shows in the Delayed Delivery report).', lines: [{ sku: 'BIL-120', qty: 400 }],
    rfq: { daysAgo: 30, deadlineInDays: -24, invited: ['SUP-0001', 'SUP-0002'], quotes: [{ supplier: 'SUP-0001', factor: 0.995, transportPct: 1.3, days: 10 }, { supplier: 'SUP-0002', factor: 1.01, transportPct: 1.3, days: 12 }], award: { supplier: 'SUP-0001', justification: 'Best price and delivery time.' } }, po: { issuedDaysAgo: 21 } },
  { ref: 'DEMO-R16', requester: 'inventory', daysAgo: 28, priority: 'High', requiredInDays: 10, stage: 'po_partial', reason: 'DEMO partially received: heavy melting scrap, first truck delivered with some rejected material.', lines: [{ sku: 'SCR-HMS', qty: 1000 }],
    rfq: { daysAgo: 23, deadlineInDays: -17, invited: ['SUP-0001', 'SUP-0002'], quotes: [{ supplier: 'SUP-0002', factor: 0.99, transportPct: 1.5, days: 8 }, { supplier: 'SUP-0001', factor: 1.015, transportPct: 1.5, days: 7 }], award: { supplier: 'SUP-0002', justification: 'Lowest landed cost.' } },
    po: { issuedDaysAgo: 12, receipts: [{ daysAgo: 2, warehouse: 'WH-MAIN', note: 'DEMO-DN-1001', lines: [{ sku: 'SCR-HMS', acceptedPct: 55, rejected: 20, reason: 'Oversize and contaminated pieces' }] }] } },
  // ---- Fully received, with invoices in every state ----
  { ref: 'DEMO-R17', requester: 'inventory', daysAgo: 30, priority: 'Medium', requiredInDays: 10, stage: 'po_received', reason: 'DEMO received, invoice waiting for verification (it matches): lime and dolomite.', lines: [{ sku: 'CON-LIME', qty: 200 }, { sku: 'CON-DOL', qty: 120 }],
    rfq: { daysAgo: 26, deadlineInDays: -20, invited: ['SUP-0005'], quotes: [{ supplier: 'SUP-0005', factor: 1.0, transportPct: 1.2, days: 7 }], award: { supplier: 'SUP-0005', justification: 'Sole supplier of both consumables.' } },
    po: { issuedDaysAgo: 18, receipts: [{ daysAgo: 3, warehouse: 'WH-MAIN', note: 'DEMO-DN-1002', lines: [{ sku: 'CON-LIME', acceptedPct: 100 }, { sku: 'CON-DOL', acceptedPct: 100 }] }], invoice: { number: 'DEMO-SUP-INV-5001', daysAgo: 2, priceFactor: 1, outcome: 'pending' } } },
  { ref: 'DEMO-R18', requester: 'deptmanager', daysAgo: 40, priority: 'Medium', requiredInDays: 10, stage: 'po_received', reason: 'DEMO received and invoice verified: magnesia carbon bricks.', lines: [{ sku: 'REF-MGC', qty: 30 }],
    rfq: { daysAgo: 36, deadlineInDays: -30, invited: ['SUP-0004'], quotes: [{ supplier: 'SUP-0004', factor: 0.99, transportPct: 1.0, days: 10 }], award: { supplier: 'SUP-0004', justification: 'Only refractory supplier for this grade.' } },
    po: { issuedDaysAgo: 25, receipts: [{ daysAgo: 3, warehouse: 'WH-MILL', note: 'DEMO-DN-1003', lines: [{ sku: 'REF-MGC', acceptedPct: 100 }] }], invoice: { number: 'DEMO-SUP-INV-5002', daysAgo: 2, priceFactor: 1, outcome: 'verified', comment: 'Matches PO and receipt.' } } },
  { ref: 'DEMO-R19', requester: 'inventory', daysAgo: 38, priority: 'Medium', requiredInDays: 10, stage: 'po_received', reason: 'DEMO received but invoice DISPUTED (billed 6% above the PO price): contactors.', lines: [{ sku: 'ELE-CNT', qty: 15 }],
    rfq: { daysAgo: 34, deadlineInDays: -28, invited: ['SUP-0007'], quotes: [{ supplier: 'SUP-0007', factor: 1.0, transportPct: 1.5, days: 9 }], award: { supplier: 'SUP-0007', justification: 'Only electrical supplier invited for this spare.' } },
    po: { issuedDaysAgo: 24, receipts: [{ daysAgo: 3, warehouse: 'WH-SPR', note: 'DEMO-DN-1004', lines: [{ sku: 'ELE-CNT', acceptedPct: 100 }] }], invoice: { number: 'DEMO-SUP-INV-5003', daysAgo: 1, priceFactor: 1.06, outcome: 'disputed', comment: 'Unit price is 6% above the purchase order. Supplier asked to reissue.' } } },
];

export const WAREHOUSE_FOR_PO = 'WH-MAIN';

// ---------------------------------------------------------------- pure helpers (unit-tested)

const matBySku = new Map(DEMO_MATERIALS.map((m) => [m.sku, m]));
export const demoMaterial = (sku: string) => { const m = matBySku.get(sku); if (!m) throw new Error(`Unknown demo material ${sku}`); return m; };
export const demoSupplier = (code: string) => { const s = DEMO_SUPPLIERS.find((x) => x.code === code); if (!s) throw new Error(`Unknown demo supplier ${code}`); return s; };

/** Quoted unit price: catalogue average x the supplier's factor, 2 decimal places, exact. */
export const quotedUnitPrice = (sku: string, factor: number): string => new Decimal(demoMaterial(sku).avgPrice).mul(new Decimal(String(factor))).toDecimalPlaces(2).toFixed(2);

export function requisitionTotal(r: DemoRequisition): string {
  return r.lines.reduce((a, l) => a.plus(new Decimal(demoMaterial(l.sku).avgPrice).mul(l.qty)), new Decimal(0)).toFixed(2);
}
export const isAboveFinanceThreshold = (r: DemoRequisition) => new Decimal(requisitionTotal(r)).gte(DEFAULT_APPROVAL_CONFIG.financeThreshold);

/** What each approval step should look like for a stage. `steps` is the chain from buildApprovalSteps. */
export function approvalOutcome(stage: Stage, stepCount: number): { requestStatus: 'pending' | 'approved' | 'rejected' | 'modification_requested'; stepStatuses: ('pending' | 'approved' | 'rejected' | 'modification_requested')[]; currentStep: number; requisitionStatus: string } | null {
  if (stage === 'draft') return null;
  const all = (s: 'approved' | 'pending') => Array.from({ length: stepCount }, () => s);
  const upTo = (n: number) => Array.from({ length: stepCount }, (_, i) => (i < n ? 'approved' : 'pending')) as ('approved' | 'pending')[];
  switch (stage) {
    case 'pending_dept': return { requestStatus: 'pending', stepStatuses: all('pending'), currentStep: 1, requisitionStatus: 'Submitted' };
    case 'pending_procurement': return { requestStatus: 'pending', stepStatuses: upTo(1), currentStep: 2, requisitionStatus: 'Under Review' };
    case 'pending_finance': return { requestStatus: 'pending', stepStatuses: upTo(stepCount - 1), currentStep: stepCount, requisitionStatus: 'Under Review' };
    case 'modification': return { requestStatus: 'modification_requested', stepStatuses: ['modification_requested', ...all('pending').slice(1)], currentStep: 1, requisitionStatus: 'Modification Requested' };
    case 'rejected': return { requestStatus: 'rejected', stepStatuses: ['rejected', ...all('pending').slice(1)], currentStep: 1, requisitionStatus: 'Rejected' };
    default: return { requestStatus: 'approved', stepStatuses: all('approved'), currentStep: stepCount, requisitionStatus: requisitionStatusFor(stage) };
  }
}

export function requisitionStatusFor(stage: Stage): string {
  switch (stage) {
    case 'approved': return 'Approved';
    case 'rfq_open': case 'rfq_closed': case 'awarded': case 'po_draft': return 'RFQ Created';
    case 'po_issued': return 'Ordered';
    case 'po_partial': return 'Partially Fulfilled';
    case 'po_received': return 'Completed';
    default: return 'Draft';
  }
}
export function poStatusFor(stage: Stage): 'draft' | 'issued' | 'partially_received' | 'received' | null {
  return stage === 'po_draft' ? 'draft' : stage === 'po_issued' ? 'issued' : stage === 'po_partial' ? 'partially_received' : stage === 'po_received' ? 'received' : null;
}
export function rfqStatusFor(stage: Stage): 'open' | 'closed' | 'awarded' | null {
  return stage === 'rfq_open' ? 'open' : stage === 'rfq_closed' ? 'closed' : hasAward(stage) ? 'awarded' : null;
}
/** Accepted quantity for a receipt line: ordered quantity x percentage, 3 decimal places. */
export const acceptedQty = (orderedQty: number, pct: number) => new Decimal(orderedQty).mul(pct).div(100).toDecimalPlaces(3).toFixed(3);
