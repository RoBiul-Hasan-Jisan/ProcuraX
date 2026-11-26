/**
 * Idempotent seed of the procure-to-pay WORKFLOW demo data (see demoWorkflow.ts for the scenarios).
 *
 * Every record is looked up by a natural key before it is created (requisition externalRef, RFQ per requisition,
 * quotation per RFQ+supplier, PO per RFQ, receipt per PO+delivery note, invoice per supplier+invoice number,
 * notification per recipient+dedupeKey), so running the seed twice changes nothing. Stock is changed only when a
 * receipt is created, and only if its ledger entry does not exist yet.
 *
 * The records are written directly (not through the services) so that they can be dated in the past and so that the
 * seed does not need a signed-in user per step. They follow the same rules the services apply: same totals
 * (computeQuotationCost), same three-way match (matchInvoice), same status chain.
 */
import { ApprovalHistory } from '../src/models/ApprovalHistory';
import { ApprovalRequest } from '../src/models/ApprovalRequest';
import { Department } from '../src/models/Department';
import { DemandForecast } from '../src/models/Forecast';
import { GoodsReceipt } from '../src/models/GoodsReceipt';
import { Invoice } from '../src/models/Invoice';
import { Material } from '../src/models/Material';
import { MRPRun } from '../src/models/MRPRun';
import { Notification } from '../src/models/Notification';
import { nextNumber } from '../src/models/Counter';
import { ProductionPlan } from '../src/models/ProductionPlan';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { RFQ } from '../src/models/RFQ';
import { StockLevel } from '../src/models/StockLevel';
import { StockMovement } from '../src/models/StockMovement';
import { Supplier } from '../src/models/Supplier';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { User } from '../src/models/User';
import { Warehouse } from '../src/models/Warehouse';
import { buildApprovalSteps, DEFAULT_APPROVAL_CONFIG } from '../src/domain/approval';
import { matchInvoice } from '../src/domain/invoiceMatch';
import { Decimal, computeQuotationCost, dec, toD128 } from '../src/domain/money';
import { DEFAULT_ROLE_PERMISSIONS, type RoleName } from '../src/utils/permissions';
import type { UserContext } from '../src/types/express';
import { runMrp } from '../src/services/mrpService';
import { scan as scanRisks } from '../src/services/riskService';
import { runDemandForecast, runPriceForecast } from '../src/services/forecastingService';
import { DEMO_EMAILS, DEMO_SUPPLIER_USER_LINKS } from './demoData';
import {
  DEMO_REQUISITIONS, acceptedQty, approvalOutcome, demoMaterial, hasAward, hasPo, hasRfq, isIssued, poStatusFor, quotedUnitPrice, requisitionStatusFor, requisitionTotal, rfqStatusFor,
  type DemoRequisition,
} from './demoWorkflow';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);
const tax = '5'; // demo tax rate % on every quotation

export interface WorkflowSummary { skipped: string | null; requisitions: number; rfqs: number; quotations: number; purchaseOrders: number; receipts: number; invoices: number; notifications: number }

export async function seedWorkflow(): Promise<WorkflowSummary> {
  const out: WorkflowSummary = { skipped: null, requisitions: 0, rfqs: 0, quotations: 0, purchaseOrders: 0, receipts: 0, invoices: 0, notifications: 0 };

  // Demo users must already exist (the main seed creates them). Without them there is nobody to attribute the records to.
  const byRole: Partial<Record<RoleName, any>> = {};
  for (const role of ['inventory_officer', 'department_manager', 'procurement_manager', 'finance_officer'] as RoleName[]) byRole[role] = await User.findOne({ email: DEMO_EMAILS[role] }).lean();
  const missing = Object.entries(byRole).filter(([, u]) => !u).map(([r]) => r);
  if (missing.length) {
    out.skipped = `demo users missing (${missing.join(', ')}). Check the Firebase Admin credentials in backend/.env and run the seed again.`;
    console.log(`Workflow demo data skipped: ${out.skipped}`);
    return out;
  }
  const inv = byRole.inventory_officer, dm = byRole.department_manager, pm = byRole.procurement_manager, fin = byRole.finance_officer;
  const prod: any = await Department.findOne({ code: 'PROD' }).lean();
  const suppliers = new Map<string, any>((await Supplier.find({ isDemoData: true }).lean()).map((s: any) => [s.supplierCode, s]));
  const materials = new Map<string, any>((await Material.find({ isDemoData: true }).lean()).map((m: any) => [m.sku, m]));
  const warehouses = new Map<string, any>((await Warehouse.find({ isDemoData: true }).lean()).map((w: any) => [w.code, w]));
  if (!prod || suppliers.size === 0 || materials.size === 0 || warehouses.size === 0) { out.skipped = 'master data missing'; console.log('Workflow demo data skipped: master data missing.'); return out; }

  const actorFor = (role: string) => (role === 'department_manager' ? dm : role === 'finance_officer' ? fin : pm);
  const created: Record<string, { req: any; rfq?: any; po?: any }> = {};

  for (const r of DEMO_REQUISITIONS) {
    const requester = r.requester === 'inventory' ? inv : dm;
    const requesterRole: RoleName = r.requester === 'inventory' ? 'inventory_officer' : 'department_manager';
    const chainLength = buildApprovalSteps({ requesterRole, estimatedTotal: requisitionTotal(r), config: DEFAULT_APPROVAL_CONFIG }).length;
    const outcome = approvalOutcome(r.stage, chainLength);
    const reqStatus = outcome ? outcome.requisitionStatus : 'Draft';

    // ---- requisition
    let req: any = await PurchaseRequisition.findOne({ externalRef: r.ref });
    if (!req) {
      req = await PurchaseRequisition.create({
        externalRef: r.ref, number: await nextNumber('PR'), requestedBy: requester._id, requestedByName: requester.displayName, department: prod._id,
        items: r.lines.map((l) => {
          const m = demoMaterial(l.sku); const doc = materials.get(l.sku);
          return { material: doc._id, materialName: m.name, sku: m.sku, category: m.category, quantity: toD128(l.qty), unit: m.unit, estimatedUnitPrice: toD128(m.avgPrice), lineTotal: toD128(new Decimal(m.avgPrice).mul(l.qty).toFixed(2)) };
        }),
        estimatedTotal: toD128(requisitionTotal(r)), requiredDate: ahead(r.requiredInDays), priority: r.priority, reason: r.reason, status: reqStatus as any,
        submittedAt: outcome ? ago(r.daysAgo) : undefined, approvedAt: outcome?.requestStatus === 'approved' ? ago(Math.max(0, r.daysAgo - 1)) : undefined,
        isDemoData: true, createdAt: ago(r.daysAgo + 0.3),
      });
      out.requisitions++;
    }
    created[r.ref] = { req };
    if (outcome) await ensureApproval(req, r, requester, requesterRole, outcome, actorFor);

    if (!hasRfq(r.stage) || !r.rfq) continue;
    const rfq = await ensureRfq(req, r, pm, suppliers, materials, out);
    created[r.ref].rfq = rfq;
    if (!hasPo(r.stage)) continue;
    const po = await ensurePo(req, rfq, r, pm, out);
    created[r.ref].po = po;
    if (!po || !r.po) continue;
    for (const spec of r.po.receipts ?? []) await ensureReceipt(po, spec, r, inv, warehouses, materials, out);
    if (r.po.invoice) await ensureInvoice(po, r, r.po.invoice, pm, fin, out);
  }

  out.notifications = await seedNotifications(created, { inv, dm, pm, fin });
  console.log(`Workflow demo data: ${out.requisitions} new requisition(s), ${out.rfqs} RFQ(s), ${out.quotations} quotation(s), ${out.purchaseOrders} PO(s), ${out.receipts} receipt(s), ${out.invoices} invoice(s), ${out.notifications} notification(s).`);
  return out;
}

async function ensureApproval(req: any, r: DemoRequisition, requester: any, requesterRole: RoleName, outcome: NonNullable<ReturnType<typeof approvalOutcome>>, actorFor: (role: string) => any) {
  if (await ApprovalRequest.exists({ requisition: req._id, cycle: 1 })) return;
  const chain = buildApprovalSteps({ requesterRole, estimatedTotal: requisitionTotal(r), config: DEFAULT_APPROVAL_CONFIG });
  const t0 = ago(r.daysAgo);
  const steps = chain.map((s, i) => {
    const st = outcome.stepStatuses[i];
    const decided = st !== 'pending';
    const actor = decided ? actorFor(s.role) : null;
    return {
      order: s.order, role: s.role, label: s.label, status: st, decidedBy: actor?._id ?? null, decidedByName: actor?.displayName ?? '', decidedAt: decided ? new Date(t0.getTime() + (i + 1) * 3_600_000 * 5) : null,
      comment: decided && st !== 'approved' ? (r.comment ?? '') : '',
    };
  });
  const request: any = await ApprovalRequest.create({ requisition: req._id, cycle: 1, status: outcome.requestStatus, currentStep: outcome.currentStep, steps, isDemoData: true, createdAt: t0 });
  const history: any[] = [{ requisition: req._id, approvalRequest: request._id, action: 'submitted', step: 0, stepLabel: 'Submitted', actor: requester._id, actorName: requester.displayName, actorRole: requesterRole, comment: '', at: t0 }];
  for (const s of steps) {
    if (s.status === 'pending') continue;
    history.push({ requisition: req._id, approvalRequest: request._id, action: s.status === 'approved' ? 'approved' : s.status, step: s.order, stepLabel: s.label, actor: s.decidedBy, actorName: s.decidedByName, actorRole: s.role, comment: s.comment, at: s.decidedAt });
  }
  await ApprovalHistory.insertMany(history);
}

async function ensureRfq(req: any, r: DemoRequisition, pm: any, suppliers: Map<string, any>, materials: Map<string, any>, out: WorkflowSummary) {
  const spec = r.rfq!;
  let rfq: any = await RFQ.findOne({ requisition: req._id, status: { $ne: 'cancelled' } });
  if (!rfq) {
    rfq = await RFQ.create({
      number: await nextNumber('RFQ'), requisition: req._id,
      items: r.lines.map((l) => { const m = demoMaterial(l.sku); return { material: materials.get(l.sku)._id, materialName: m.name, sku: m.sku, quantity: toD128(l.qty), unit: m.unit, technicalSpecs: m.specs }; }),
      deliveryLocation: 'Main raw-material yard', deadline: ahead(spec.deadlineInDays), paymentTerms: 'Net 30', deliveryRequirements: 'DEMO: deliver to Plant Gate 1 during working hours.',
      requiredDate: req.requiredDate, invitedSuppliers: spec.invited.map((c) => suppliers.get(c)._id), status: (rfqStatusFor(r.stage) === 'awarded' ? 'closed' : rfqStatusFor(r.stage)) as any, createdBy: pm._id, isDemoData: true, createdAt: ago(spec.daysAgo),
    });
    out.rfqs++;
  }
  if (!req.rfq) await PurchaseRequisition.updateOne({ _id: req._id }, { $set: { rfq: rfq._id } });

  const items = r.lines.map((l) => ({ sku: l.sku, qty: l.qty }));
  for (const q of spec.quotes) {
    const sup = suppliers.get(q.supplier);
    if (await SupplierQuotation.exists({ rfq: rfq._id, supplier: sup._id })) continue;
    const lines = items.map((i) => ({ quantity: i.qty, unitPrice: quotedUnitPrice(i.sku, q.factor) }));
    const base = lines.reduce((a, l) => a.plus(new Decimal(l.quantity).mul(l.unitPrice)), new Decimal(0));
    const cost = computeQuotationCost({ lines, transportCost: base.mul(q.transportPct).div(100).toDecimalPlaces(2), additionalCharges: 0, taxRatePercent: tax });
    const awarded = !!spec.award && spec.award.supplier === q.supplier;
    await SupplierQuotation.create({
      rfq: rfq._id, supplier: sup._id,
      lines: items.map((i, n) => { const m = demoMaterial(i.sku); return { material: materials.get(i.sku)._id, materialName: m.name, quantity: toD128(i.qty), unit: m.unit, unitPrice: toD128(lines[n].unitPrice), lineTotal: toD128(cost.lines[n].lineTotal) }; }),
      materialCost: toD128(cost.materialCost), transportCost: toD128(cost.transportCost), additionalCharges: toD128(0), taxRatePercent: toD128(tax), taxAmount: toD128(cost.taxAmount), totalLandedCost: toD128(cost.totalLandedCost),
      deliveryDays: q.days, paymentTerms: sup.paymentTerms, paymentTermsDays: sup.paymentTermsDays, validUntil: ahead(25), notes: 'DEMO quotation', status: spec.award ? (awarded ? 'awarded' : 'not_selected') : 'submitted',
      submittedAt: ago(Math.max(0.2, spec.daysAgo - 1)), isDemoData: true,
    });
    out.quotations++;
  }
  // The award is recorded exactly as a person would: a chosen quotation, a justification, and who chose it.
  if (spec.award && !rfq.award?.quotation) {
    const sup = suppliers.get(spec.award.supplier);
    const quote: any = await SupplierQuotation.findOne({ rfq: rfq._id, supplier: sup._id }).lean();
    const all: any[] = await SupplierQuotation.find({ rfq: rfq._id }).lean();
    const cheapest = all.reduce((a, b) => (dec(b.totalLandedCost).lt(dec(a.totalLandedCost)) ? b : a));
    await RFQ.updateOne({ _id: rfq._id }, { $set: { status: 'awarded', award: { quotation: quote._id, supplier: sup._id, awardedBy: pm._id, awardedByName: pm.displayName, awardedAt: new Date(new Date(rfq.deadline).getTime() + 3 * 3_600_000), justification: spec.award.justification, overrodeTopRank: String(cheapest._id) !== String(quote._id) } } });
    rfq = await RFQ.findById(rfq._id);
  }
  return rfq;
}

async function ensurePo(req: any, rfq: any, r: DemoRequisition, pm: any, out: WorkflowSummary) {
  let po: any = await PurchaseOrder.findOne({ rfq: rfq._id, status: { $ne: 'cancelled' } });
  if (po) return po;
  const quote: any = await SupplierQuotation.findOne({ rfq: rfq._id, status: 'awarded' }).lean();
  if (!quote) return null;
  const status = poStatusFor(r.stage)!;
  const issuedAt = isIssued(r.stage) ? ago(r.po?.issuedDaysAgo ?? 5) : undefined;
  const receipts = r.po?.receipts ?? [];
  const accepted = (sku: string) => receipts.flatMap((x) => x.lines).filter((l) => l.sku === sku).reduce((a, l) => a.plus(acceptedQty(r.lines.find((x) => x.sku === sku)!.qty, l.acceptedPct)), new Decimal(0));
  const rejected = (sku: string) => receipts.flatMap((x) => x.lines).filter((l) => l.sku === sku).reduce((a, l) => a.plus(l.rejected ?? 0), new Decimal(0));
  const skus = new Map(rfq.items.map((i: any) => [String(i.material), i.sku]));
  po = await PurchaseOrder.create({
    number: await nextNumber('PO'), rfq: rfq._id, requisition: req._id, quotation: quote._id, supplier: quote.supplier,
    lines: quote.lines.map((l: any) => { const sku = skus.get(String(l.material)) as string; return { material: l.material, materialName: l.materialName, sku, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, acceptedQty: toD128(accepted(sku).toFixed(3)), rejectedQty: toD128(rejected(sku).toFixed(3)), invoicedQty: toD128(0) }; }),
    currency: quote.currency, materialCost: quote.materialCost, transportCost: quote.transportCost, additionalCharges: quote.additionalCharges, taxRatePercent: quote.taxRatePercent, taxAmount: quote.taxAmount, totalAmount: quote.totalLandedCost,
    paymentTerms: quote.paymentTerms, paymentTermsDays: quote.paymentTermsDays, deliveryLocation: rfq.deliveryLocation, deliveryDays: quote.deliveryDays,
    expectedDeliveryDate: issuedAt ? new Date(issuedAt.getTime() + quote.deliveryDays * DAY) : undefined, issuedAt, status,
    receiptSeq: receipts.length, lastReceiptAt: receipts.length ? ago(Math.min(...receipts.map((x) => x.daysAgo))) : undefined,
    createdBy: pm._id, isDemoData: true, createdAt: issuedAt ? new Date(issuedAt.getTime() - 0.5 * DAY) : ago(2),
  });
  out.purchaseOrders++;
  return po;
}

async function ensureReceipt(po: any, spec: NonNullable<NonNullable<DemoRequisition['po']>['receipts']>[number], r: DemoRequisition, inv: any, warehouses: Map<string, any>, materials: Map<string, any>, out: WorkflowSummary) {
  const wh = warehouses.get(spec.warehouse);
  let receipt: any = await GoodsReceipt.findOne({ purchaseOrder: po._id, deliveryNote: spec.note });
  if (!receipt) {
    const lines = spec.lines.map((l) => {
      const m = demoMaterial(l.sku);
      return { material: materials.get(l.sku)._id, materialName: m.name, unit: m.unit, acceptedQty: toD128(acceptedQty(r.lines.find((x) => x.sku === l.sku)!.qty, l.acceptedPct)), rejectedQty: toD128(new Decimal(l.rejected ?? 0).toFixed(3)), rejectionReason: l.reason ?? '' };
    });
    receipt = await GoodsReceipt.create({
      number: await nextNumber('GR'), purchaseOrder: po._id, supplier: po.supplier, warehouse: wh._id, lines, deliveryNote: spec.note, notes: 'DEMO receipt',
      receivedBy: inv._id, receivedByName: inv.displayName, receivedAt: ago(spec.daysAgo), isDemoData: true, createdAt: ago(spec.daysAgo),
    });
    out.receipts++;
  }
  // Stock: add the accepted quantity once per receipt line. The ledger entry is the "already done" marker, so a crash between
  // the receipt and the stock update is repaired by the next run, and a re-run never doubles stock.
  for (const l of receipt.lines) {
    if (dec(l.acceptedQty).lte(0)) continue;
    if (await StockMovement.exists({ 'reference.id': receipt._id, material: l.material, type: 'receipt' })) continue;
    const level: any = await StockLevel.findOneAndUpdate({ material: l.material, warehouse: wh._id }, { $inc: { quantity: l.acceptedQty }, $setOnInsert: { isDemoData: true } }, { upsert: true, returnDocument: 'after' });
    await StockMovement.create({
      material: l.material, warehouse: wh._id, type: 'receipt', delta: l.acceptedQty, balanceAfter: level.quantity, reason: `Goods receipt ${receipt.number}`,
      reference: { kind: 'GoodsReceipt', id: receipt._id, number: receipt.number }, performedBy: inv._id, performedByName: inv.displayName, isDemoData: true, createdAt: receipt.receivedAt,
    });
  }
}

async function ensureInvoice(po: any, r: DemoRequisition, spec: NonNullable<NonNullable<DemoRequisition['po']>['invoice']>, pm: any, fin: any, out: WorkflowSummary) {
  if (await Invoice.exists({ supplier: po.supplier, invoiceNumber: spec.number })) return;
  const fresh: any = await PurchaseOrder.findById(po._id).lean();
  const lines = fresh.lines.filter((l: any) => dec(l.acceptedQty).gt(0)).map((l: any) => ({ material: String(l.material), materialName: l.materialName, quantity: dec(l.acceptedQty), unitPrice: dec(l.unitPrice).mul(spec.priceFactor).toDecimalPlaces(2) }));
  const input = { lines: lines.map((l: any) => ({ material: l.material, quantity: l.quantity, unitPrice: l.unitPrice })), transportCost: fresh.transportCost, additionalCharges: fresh.additionalCharges, taxRatePercent: fresh.taxRatePercent };
  const cost = computeQuotationCost({ lines: input.lines, transportCost: input.transportCost, additionalCharges: input.additionalCharges, taxRatePercent: input.taxRatePercent });
  const match = matchInvoice({ lines: fresh.lines.map((l: any) => ({ material: String(l.material), unitPrice: l.unitPrice, acceptedQty: l.acceptedQty })), transportCost: fresh.transportCost, additionalCharges: fresh.additionalCharges, taxRatePercent: fresh.taxRatePercent }, input, {});
  if (spec.outcome === 'verified' && !match.ok) throw new Error(`Demo invoice ${spec.number} is meant to be verified but does not match: ${match.issues[0]}`);
  const invoiceDate = ago(spec.daysAgo);
  const decision = spec.outcome === 'pending' ? undefined : { by: fin._id, byName: fin.displayName, at: new Date(invoiceDate.getTime() + 3_600_000 * 6), comment: spec.comment ?? '' };
  await Invoice.create({
    number: await nextNumber('INV'), invoiceNumber: spec.number, purchaseOrder: po._id, supplier: po.supplier,
    lines: lines.map((l: any, i: number) => ({ material: l.material, materialName: l.materialName, quantity: toD128(l.quantity), unitPrice: toD128(l.unitPrice), lineTotal: toD128(cost.lines[i].lineTotal) })),
    materialCost: toD128(cost.materialCost), transportCost: toD128(cost.transportCost), additionalCharges: toD128(cost.additionalCharges), taxRatePercent: fresh.taxRatePercent, taxAmount: toD128(cost.taxAmount), totalAmount: toD128(cost.totalLandedCost),
    invoiceDate, dueDate: new Date(invoiceDate.getTime() + (fresh.paymentTermsDays ?? 0) * DAY), match: { ...match, checkedAt: invoiceDate },
    status: spec.outcome === 'pending' ? 'pending_verification' : spec.outcome, decision, recordedBy: pm._id, isDemoData: true, createdAt: invoiceDate,
  });
  if (spec.outcome === 'verified') for (const l of lines) await PurchaseOrder.updateOne({ _id: po._id, 'lines.material': l.material }, { $inc: { 'lines.$.invoicedQty': toD128(l.quantity) } });
  out.invoices++;
}

async function seedNotifications(created: Record<string, { req: any; rfq?: any; po?: any }>, u: { inv: any; dm: any; pm: any; fin: any }): Promise<number> {
  const admin: any = await User.findOne({ email: DEMO_EMAILS.system_admin }).lean();
  const supplierUsers = new Map<string, any>();
  for (const l of DEMO_SUPPLIER_USER_LINKS) { const x: any = await User.findOne({ email: l.email }).lean(); if (x) supplierUsers.set(l.supplierCode, x); }
  const num = (ref: string) => created[ref]?.req?.number as string | undefined;
  const reqLink = (ref: string) => `/procurement/requisitions/${created[ref]?.req?._id}`;
  const rfqLink = (ref: string) => `/procurement/rfqs/${created[ref]?.rfq?._id}`;
  const poLink = (ref: string) => `/procurement/purchase-orders/${created[ref]?.po?._id}`;
  type N = { to: any; key: string; type: string; severity?: 'info' | 'warning' | 'critical'; title: string; body: string; link: string; read?: boolean; entity?: { kind: string; id: string; number: string }; daysAgo: number };
  const list: N[] = [];
  const add = (n: N) => { if (n.to) list.push(n); };
  add({ to: u.dm, key: 'DEMO-N-R02', type: 'approval_requested', title: `Approval needed: ${num('DEMO-R02')}`, body: 'A requisition is waiting for the Department approval step.', link: '/procurement/approvals', daysAgo: 2, entity: { kind: 'Requisition', id: String(created['DEMO-R02']?.req?._id), number: num('DEMO-R02') ?? '' } });
  add({ to: u.pm, key: 'DEMO-N-R03', type: 'approval_requested', title: `Approval needed: ${num('DEMO-R03')}`, body: 'A requisition is waiting for Procurement review.', link: '/procurement/approvals', daysAgo: 3 });
  add({ to: u.fin, key: 'DEMO-N-R04', type: 'approval_requested', severity: 'warning', title: `Budget approval needed: ${num('DEMO-R04')}`, body: 'This requisition is above the finance threshold.', link: '/procurement/approvals', daysAgo: 4 });
  add({ to: u.inv, key: 'DEMO-N-R05', type: 'modification_requested', title: `Changes requested on ${num('DEMO-R05')}`, body: 'Please split this into two deliveries and confirm the spec with QA.', link: reqLink('DEMO-R05'), daysAgo: 5 });
  add({ to: u.dm, key: 'DEMO-N-R06', type: 'requisition_rejected', severity: 'warning', title: `Requisition ${num('DEMO-R06')} was rejected`, body: 'Not budgeted this quarter. Resubmit in the next cycle.', link: reqLink('DEMO-R06'), daysAgo: 8, read: true });
  add({ to: u.pm, key: 'DEMO-N-R07', type: 'requisition_approved', title: `Ready for an RFQ: ${num('DEMO-R07')}`, body: 'An approved requisition is waiting for an RFQ.', link: reqLink('DEMO-R07'), daysAgo: 7 });
  add({ to: u.pm, key: 'DEMO-N-R09', type: 'quotation_submitted', title: `A quotation was received for ${created['DEMO-R09']?.rfq?.number}`, body: 'Quotations stay sealed until the deadline.', link: rfqLink('DEMO-R09'), daysAgo: 1, read: true });
  add({ to: u.pm, key: 'DEMO-N-R11', type: 'quotation_submitted', title: `${created['DEMO-R11']?.rfq?.number} is ready to compare`, body: 'The deadline has passed. Compare the quotations and choose a supplier.', link: rfqLink('DEMO-R11'), daysAgo: 2 });
  for (const [code, su] of supplierUsers) {
    if (['SUP-0001', 'SUP-0002'].includes(code)) {
      add({ to: su, key: 'DEMO-N-R09-INV', type: 'rfq_published', title: `You are invited to quote: ${created['DEMO-R09']?.rfq?.number}`, body: 'Submit your quotation before the deadline.', link: rfqLink('DEMO-R09'), daysAgo: 3 });
      add({ to: su, key: 'DEMO-N-R10-INV', type: 'rfq_published', title: `You are invited to quote: ${created['DEMO-R10']?.rfq?.number}`, body: 'Submit your quotation before the deadline.', link: rfqLink('DEMO-R10'), daysAgo: 2 });
    }
  }
  add({ to: supplierUsers.get('SUP-0002'), key: 'DEMO-N-R12', type: 'supplier_awarded', title: `Your quotation was selected: ${created['DEMO-R12']?.rfq?.number}`, body: 'A purchase order will follow.', link: rfqLink('DEMO-R12'), daysAgo: 5 });
  add({ to: supplierUsers.get('SUP-0003'), key: 'DEMO-N-R14', type: 'purchase_order_issued', title: `Purchase order issued: ${created['DEMO-R14']?.po?.number}`, body: 'Please confirm delivery against the expected date.', link: poLink('DEMO-R14'), daysAgo: 5 });
  add({ to: supplierUsers.get('SUP-0001'), key: 'DEMO-N-R15', type: 'purchase_order_issued', title: `Purchase order issued: ${created['DEMO-R15']?.po?.number}`, body: 'Delivery is overdue.', link: poLink('DEMO-R15'), daysAgo: 21, read: true });
  add({ to: u.inv, key: 'DEMO-N-R14-INV', type: 'purchase_order_issued', title: `Expect a delivery: ${created['DEMO-R14']?.po?.number}`, body: 'A purchase order was issued for your requisition.', link: poLink('DEMO-R14'), daysAgo: 5 });
  add({ to: u.inv, key: 'DEMO-N-R15-LATE', type: 'delayed_delivery', severity: 'warning', title: `Delivery overdue: ${created['DEMO-R15']?.po?.number}`, body: 'The expected delivery date has passed.', link: poLink('DEMO-R15'), daysAgo: 1 });
  add({ to: u.fin, key: 'DEMO-N-R17', type: 'goods_received', title: `Goods received: ${created['DEMO-R17']?.po?.number}`, body: 'The supplier invoice is waiting for verification.', link: '/procurement/invoices', daysAgo: 2 });
  add({ to: u.pm, key: 'DEMO-N-R16', type: 'goods_received', title: `Partial delivery: ${created['DEMO-R16']?.po?.number}`, body: 'Part of the delivery was rejected on inspection.', link: poLink('DEMO-R16'), daysAgo: 2 });
  add({ to: admin, key: 'DEMO-N-R19', type: 'invoice_disputed', severity: 'warning', title: `Invoice disputed on ${created['DEMO-R19']?.po?.number}`, body: 'Billed price is above the purchase order.', link: '/procurement/invoices', daysAgo: 1 });
  add({ to: u.fin, key: 'DEMO-N-R19', type: 'invoice_disputed', severity: 'warning', title: `Invoice disputed on ${created['DEMO-R19']?.po?.number}`, body: 'Billed price is above the purchase order.', link: '/procurement/invoices', daysAgo: 1, read: true });

  let made = 0;
  for (const n of list) {
    const res = await Notification.updateOne(
      { recipient: n.to._id, dedupeKey: n.key },
      { $setOnInsert: { recipient: n.to._id, dedupeKey: n.key, type: n.type, severity: n.severity ?? 'info', title: n.title, body: n.body, link: n.link, entity: n.entity, readAt: n.read ? ago(Math.max(0, n.daysAgo - 0.5)) : null, isDemoData: true, createdAt: ago(n.daysAgo) } },
      { upsert: true },
    );
    if (res.upsertedCount) made++;
  }
  return made;
}

const ctxFor = (u: any): UserContext => ({ id: String(u._id), firebaseUid: u.firebaseUid, email: u.email, displayName: u.displayName, role: u.role, status: 'active', departmentId: u.department ? String(u.department) : null, supplierId: u.supplier ? String(u.supplier) : null, permissions: DEFAULT_ROLE_PERMISSIONS[u.role as RoleName] ?? [] });

/**
 * Things the app computes on demand (MRP plan, risk alerts, forecasts). Run once here so those pages are not empty on first use.
 * Each step is independent and guarded, so a failure (for example the forecasting service being unreachable) is reported, not fatal,
 * and a re-run adds nothing that already exists.
 */
export async function seedDerived(): Promise<void> {
  const pm: any = await User.findOne({ email: DEMO_EMAILS.procurement_manager }).lean();
  if (!pm) { console.log('Derived demo data skipped: no procurement manager user.'); return; }
  const ctx = ctxFor(pm);
  const attempt = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); console.log(`${label}: done`); } catch (e: any) { console.log(`${label}: skipped (${e?.message ?? e}). You can run it from the app instead.`); } };

  await attempt('MRP run', async () => {
    if (await MRPRun.estimatedDocumentCount() > 0) return;
    const plans = await ProductionPlan.find({ isDemoData: true, status: { $in: ['planned', 'in_progress'] } }).select('_id').lean();
    if (plans.length) await runMrp(ctx, { planIds: plans.map((p: any) => String(p._id)), horizonDays: 90 });
  });
  await attempt('Risk scan', async () => { await scanRisks(); });
  await attempt('Forecasts', async () => {
    if (await DemandForecast.estimatedDocumentCount() > 0) return;
    for (const sku of ['SCR-SHR', 'SCR-HMS', 'SCR-BND', 'BIL-120', 'CON-LIME', 'FER-SIMN', 'REF-MGC', 'LUB-HYD']) {
      const m: any = await Material.findOne({ sku }).lean();
      if (!m) continue;
      await runDemandForecast(ctx, String(m._id));
      await runPriceForecast(ctx, String(m._id));
    }
  });
}
