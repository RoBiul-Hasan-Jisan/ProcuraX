import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { sendSuccess } from '../utils/apiResponse';
import {
  approvalSettingsBody, awardBody, cancelBody, comparisonQuery, decisionBody, idParam, listRequisitionsQuery, listRfqsQuery,
  quotationBody, requisitionBody, rfqBody, weightsBody,
} from '../validators/schemas';
import * as requisitions from '../services/requisitionService';
import * as approvals from '../services/approvalService';
import * as rfqs from '../services/rfqService';
import * as quotations from '../services/quotationService';
import { audit } from '../services/auditService';
import * as comparison from '../services/comparisonService';
import { getSetting, putSetting } from '../models/Setting';
import { DEFAULT_APPROVAL_CONFIG } from '../domain/approval';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/requisitions', '/approvals', '/rfqs', '/quotation-comparisons', '/settings'], ...protectedChain);
const id = (res: any) => validated<any>(res, 'params').id as string;

/* Requisitions */
r.get('/requisitions', requirePermission('requisitions:view', 'requisitions:create'), validate(listRequisitionsQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await requisitions.listRequisitions(req.user!, q);
  sendSuccess(res, items, 'Requisitions retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/requisitions', requirePermission('requisitions:create'), validate(requisitionBody), async (req, res) => {
  sendSuccess(res, await requisitions.createRequisition(req.user!, validated(res, 'body')), 'Draft requisition created', 201);
});
r.get('/requisitions/:id', requirePermission('requisitions:view', 'requisitions:create'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await requisitions.getRequisition(req.user!, id(res)));
});
r.patch('/requisitions/:id', requirePermission('requisitions:create'), validate(idParam, 'params'), validate(requisitionBody), async (req, res) => {
  sendSuccess(res, await requisitions.updateRequisition(req.user!, id(res), validated(res, 'body')), 'Requisition updated');
});
r.post('/requisitions/:id/submit', requirePermission('requisitions:create'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await requisitions.submitRequisition(req.user!, id(res)), 'Requisition submitted for approval');
});
r.post('/requisitions/:id/cancel', requirePermission('requisitions:create', 'rfq:manage', 'users:manage'), validate(idParam, 'params'), validate(cancelBody), async (req, res) => {
  sendSuccess(res, await requisitions.cancelRequisition(req.user!, id(res), validated<any>(res, 'body').reason), 'Requisition cancelled');
});

/* Approvals */
r.get('/approvals', requirePermission('requisitions:approve'), async (req, res) => {
  sendSuccess(res, await approvals.listMyPending(req.user!), 'Pending approvals retrieved');
});
r.post('/approvals/:id/decision', requirePermission('requisitions:approve'), validate(idParam, 'params'), validate(decisionBody), async (req, res) => {
  const b = validated<any>(res, 'body');
  sendSuccess(res, await approvals.decide(req.user!, id(res), b.action, b.comment), 'Decision recorded');
});

/* RFQs (managers see everything; suppliers see only RFQs addressed to them) */
r.get('/rfqs', requirePermission('rfq:manage', 'rfq:view_assigned'), validate(listRfqsQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await rfqs.listRfqs(req.user!, q);
  sendSuccess(res, items, 'RFQs retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/rfqs', requirePermission('rfq:manage'), validate(rfqBody), async (req, res) => {
  sendSuccess(res, await rfqs.createRfq(req.user!, validated(res, 'body')), 'RFQ created', 201);
});
r.get('/rfqs/:id', requirePermission('rfq:manage', 'rfq:view_assigned'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await rfqs.getRfq(req.user!, id(res)));
});
r.post('/rfqs/:id/close', requirePermission('rfq:manage'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await rfqs.closeRfq(req.user!, id(res)), 'RFQ closed');
});
r.post('/rfqs/:id/cancel', requirePermission('rfq:manage'), validate(idParam, 'params'), validate(cancelBody), async (req, res) => {
  sendSuccess(res, await rfqs.cancelRfq(req.user!, id(res), validated<any>(res, 'body').reason), 'RFQ cancelled');
});

/* Supplier's own quotation for an RFQ */
r.get('/rfqs/:id/quotation', requirePermission('quotations:submit'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await quotations.getMyQuotation(req.user!, id(res)));
});
r.put('/rfqs/:id/quotation', requirePermission('quotations:submit'), validate(idParam, 'params'), validate(quotationBody), async (req, res) => {
  sendSuccess(res, await quotations.submitQuotation(req.user!, id(res), validated(res, 'body')), 'Quotation saved');
});
r.delete('/rfqs/:id/quotation', requirePermission('quotations:submit'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await quotations.withdrawQuotation(req.user!, id(res)), 'Quotation withdrawn');
});

/* Comparison and manual award (never reachable by suppliers) */
r.get('/quotation-comparisons/:id', requirePermission('quotations:compare', 'rfq:manage'), validate(idParam, 'params'), validate(comparisonQuery, 'query'), async (_req, res) => {
  const q = validated<Record<string, number | undefined>>(res, 'query');
  const given = Object.values(q).some((v) => v !== undefined);
  const base = await comparison.getScoringWeights();
  const weights = given ? { ...base, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) } : undefined;
  sendSuccess(res, await comparison.getComparison(id(res), weights as any));
});
r.post('/quotation-comparisons/:id/award', requirePermission('rfq:manage'), validate(idParam, 'params'), validate(awardBody), async (req, res) => {
  const b = validated<any>(res, 'body');
  sendSuccess(res, await comparison.awardRfq(req.user!, id(res), b.quotationId, b.justification), 'Supplier selected');
});

/* Configuration */
r.get('/settings/scoring', requirePermission('quotations:compare', 'rfq:manage'), async (_req, res) => {
  sendSuccess(res, await comparison.getScoringWeights());
});
r.put('/settings/scoring', requirePermission('suppliers:evaluate'), validate(weightsBody), async (req, res) => {
  const before = await comparison.getScoringWeights();
  const after = await comparison.setScoringWeights(validated(res, 'body'));
  await audit(req.user!, { action: 'scoring_weights.updated', entityType: 'Setting', entityId: 'scoring', summary: 'Changed supplier scoring weights', before, after });
  sendSuccess(res, after, 'Scoring weights updated');
});
r.get('/settings/approval', requirePermission('settings:manage', 'rfq:manage'), async (_req, res) => {
  sendSuccess(res, await getSetting('approval', DEFAULT_APPROVAL_CONFIG));
});
r.put('/settings/approval', requirePermission('settings:manage'), validate(approvalSettingsBody), async (_req, res) => {
  const v = validated<any>(res, 'body');
  await putSetting('approval', v);
  sendSuccess(res, v, 'Approval settings updated');
});

export default r;
