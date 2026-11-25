export const PLAN_STATUSES = ['planned', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

const TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  planned: ['confirmed', 'cancelled'],
  confirmed: ['planned', 'in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const canPlanTransition = (from: PlanStatus, to: PlanStatus) => TRANSITIONS[from]?.includes(to) ?? false;
export const isPlanEditable = (s: PlanStatus) => s === 'planned' || s === 'confirmed';
/**
 * Plans that still need material. An in-progress plan is counted at its FULL quantity because consumption against a plan
 * is not tracked per plan; stock already issued for it has left on-hand, so stock is never double counted but demand may be
 * slightly overstated until the plan is marked completed.
 */
export const COUNTS_FOR_MRP: PlanStatus[] = ['planned', 'confirmed', 'in_progress'];
