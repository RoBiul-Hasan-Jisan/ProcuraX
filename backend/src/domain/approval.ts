import { dec, type DecimalInput } from './money';
import type { RoleName } from '../utils/permissions';
import type { RequisitionStatus } from './requisitionStatus';

export type StepStatus = 'pending' | 'approved' | 'rejected' | 'modification_requested';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'modification_requested' | 'cancelled';
export type ApprovalAction = 'approve' | 'reject' | 'request_modification';

export interface ApprovalStep {
  order: number;
  role: RoleName;
  label: string;
  status: StepStatus;
}

export interface ApprovalConfig {
  /** Estimated totals at or above this amount also need Finance Officer budget approval. */
  financeThreshold: string;
  currency: string;
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = { financeThreshold: '1000000', currency: 'BDT' };

/**
 * Builds the multilevel chain: Department Manager -> Procurement Manager -> Finance Officer (budget, when
 * total >= threshold). A requester who is themselves a Department Manager skips the department step
 * (nobody may approve their own request) and goes straight to Procurement.
 */
export function buildApprovalSteps(input: {
  requesterRole: RoleName | null;
  estimatedTotal: DecimalInput;
  config: ApprovalConfig;
}): ApprovalStep[] {
  const roles: { role: RoleName; label: string }[] = [];
  if (input.requesterRole !== 'department_manager') {
    roles.push({ role: 'department_manager', label: 'Department approval' });
  }
  roles.push({ role: 'procurement_manager', label: 'Procurement review' });
  if (dec(input.estimatedTotal).gte(dec(input.config.financeThreshold))) {
    roles.push({ role: 'finance_officer', label: 'Budget approval' });
  }
  return roles.map((r, i) => ({ ...r, order: i + 1, status: 'pending' as const }));
}

export interface DecisionContext {
  request: { status: RequestStatus; currentStep: number; steps: ApprovalStep[] };
  requisition: { requestedBy: string; department: string };
  user: { id: string; role: RoleName | null; departmentId: string | null };
  action: ApprovalAction;
  comment?: string;
}

/** Returns an error message when the decision is not allowed, otherwise null. */
export function validateDecision(ctx: DecisionContext): string | null {
  const { request, requisition, user, action } = ctx;
  if (request.status !== 'pending') return 'This approval request is no longer pending';
  const step = request.steps.find((s) => s.order === request.currentStep);
  if (!step || step.status !== 'pending') return 'This approval step has already been decided';
  if (user.role !== step.role) return 'You are not the approver for the current step';
  if (user.id === requisition.requestedBy) return 'You cannot approve your own requisition';
  if (step.role === 'department_manager' && user.departmentId !== requisition.department) {
    return 'You can only decide requisitions from your own department';
  }
  if (action !== 'approve' && !(ctx.comment ?? '').trim()) return 'A comment is required to reject or request changes';
  return null;
}

export interface DecisionOutcome {
  stepStatus: StepStatus;
  requestStatus: RequestStatus;
  nextStep: number;
  requisitionStatus: RequisitionStatus;
}

export function applyDecision(request: { currentStep: number; steps: ApprovalStep[] }, action: ApprovalAction): DecisionOutcome {
  if (action === 'reject') {
    return { stepStatus: 'rejected', requestStatus: 'rejected', nextStep: request.currentStep, requisitionStatus: 'Rejected' };
  }
  if (action === 'request_modification') {
    return {
      stepStatus: 'modification_requested', requestStatus: 'modification_requested',
      nextStep: request.currentStep, requisitionStatus: 'Modification Requested',
    };
  }
  const last = request.currentStep >= Math.max(...request.steps.map((s) => s.order));
  return last
    ? { stepStatus: 'approved', requestStatus: 'approved', nextStep: request.currentStep, requisitionStatus: 'Approved' }
    : { stepStatus: 'approved', requestStatus: 'pending', nextStep: request.currentStep + 1, requisitionStatus: 'Under Review' };
}
