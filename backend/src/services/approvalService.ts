import { ApprovalRequest } from '../models/ApprovalRequest';
import { ApprovalHistory } from '../models/ApprovalHistory';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { applyDecision, validateDecision, type ApprovalAction } from '../domain/approval';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { getRequisition, presentRequisition } from './requisitionService';
import { notify } from './notifier';
import { audit } from './auditService';

const HISTORY_ACTION = { approve: 'approved', reject: 'rejected', request_modification: 'modification_requested' } as const;

/** Pending approvals the current user is the approver for. */
export async function listMyPending(user: UserContext) {
  if (!user.role) return [];
  const requests = await ApprovalRequest.find({
    status: 'pending',
    steps: { $elemMatch: { role: user.role, status: 'pending' } },
  }).sort({ createdAt: 1 }).lean();
  const mine = requests.filter((r) => r.steps.find((s: any) => s.order === r.currentStep)?.role === user.role);
  const reqs = await PurchaseRequisition.find({ _id: { $in: mine.map((m) => m.requisition) } }).populate('department', 'name').lean();
  const byId = new Map(reqs.map((r) => [String(r._id), r]));
  return mine
    .map((m) => ({ m, r: byId.get(String(m.requisition)) }))
    .filter(({ r }) => {
      if (!r) return false;
      if (String(r.requestedBy) === user.id) return false;
      if (user.role === 'department_manager') return String((r.department as any)?._id ?? r.department) === user.departmentId;
      return true;
    })
    .map(({ m, r }) => ({
      approvalId: String(m._id), step: m.currentStep,
      stepLabel: m.steps.find((s: any) => s.order === m.currentStep)?.label,
      requisition: presentRequisition(r),
    }));
}

export async function decide(user: UserContext, requisitionId: string, action: ApprovalAction, comment = '') {
  const requisition = await PurchaseRequisition.findById(requisitionId).lean();
  if (!requisition) throw notFound('Requisition not found');
  const request = await ApprovalRequest.findOne({ requisition: requisitionId }).sort({ cycle: -1 });
  if (!request) throw badRequest('This requisition has not been submitted for approval');

  const plain = { status: request.status as any, currentStep: request.currentStep, steps: request.steps.map((s: any) => ({ order: s.order, role: s.role, label: s.label, status: s.status })) };
  const err = validateDecision({
    request: plain,
    requisition: { requestedBy: String(requisition.requestedBy), department: String(requisition.department) },
    user: { id: user.id, role: user.role, departmentId: user.departmentId },
    action, comment,
  });
  if (err) throw (/approver|department|own/.test(err) ? forbidden(err) : conflict(err));

  const outcome = applyDecision(plain, action);
  const step = request.currentStep;
  const now = new Date();

  // Atomic gate: matches only if this exact step is STILL pending, so a double-click or two
  // approvers racing cannot both record a decision for the same step.
  const updated = await ApprovalRequest.findOneAndUpdate(
    { _id: request._id, status: 'pending', currentStep: step, steps: { $elemMatch: { order: step, status: 'pending' } } },
    {
      $set: {
        'steps.$.status': outcome.stepStatus, 'steps.$.decidedBy': user.id, 'steps.$.decidedByName': user.displayName,
        'steps.$.decidedAt': now, 'steps.$.comment': comment, status: outcome.requestStatus, currentStep: outcome.nextStep,
      },
    },
    { new: true },
  );
  if (!updated) throw conflict('This approval step was already decided');

  const reqUpdate: Record<string, unknown> = { status: outcome.requisitionStatus };
  if (outcome.requisitionStatus === 'Approved') reqUpdate.approvedAt = now;
  await PurchaseRequisition.updateOne({ _id: requisitionId }, { $set: reqUpdate });
  const stepInfo = plain.steps.find((s) => s.order === step)!;
  await ApprovalHistory.create({
    requisition: requisitionId, approvalRequest: request._id, action: HISTORY_ACTION[action], step, stepLabel: stepInfo.label,
    actor: user.id, actorName: user.displayName, actorRole: user.role, comment, at: now,
  });

  await audit(user, { action: 'approval.decided', entityType: 'PurchaseRequisition', entityId: requisitionId, entityNumber: requisition.number ?? '', summary: `${action} at step "${stepInfo.label}"${comment ? `: ${comment}` : ''}`, before: { status: requisition.status }, after: { status: outcome.requisitionStatus, decision: action } });
  if (outcome.requestStatus === 'pending') await notify.approvalNeeded(requisition, updated.steps.find((s: any) => s.order === outcome.nextStep)!.role);
  else await notify.requisitionDecided(requisition, outcome.requisitionStatus);
  return getRequisition(user, requisitionId);
}
