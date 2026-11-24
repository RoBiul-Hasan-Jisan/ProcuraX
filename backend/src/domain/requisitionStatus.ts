export const REQUISITION_STATUSES = [
  'Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Modification Requested',
  'RFQ Created', 'Ordered', 'Partially Fulfilled', 'Completed', 'Cancelled',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

/** Valid state machine. Anything not listed is rejected. */
const TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Under Review', 'Approved', 'Rejected', 'Modification Requested', 'Cancelled'],
  'Under Review': ['Under Review', 'Approved', 'Rejected', 'Modification Requested', 'Cancelled'],
  Approved: ['RFQ Created', 'Cancelled'],
  Rejected: [],
  'Modification Requested': ['Submitted', 'Cancelled'],
  'RFQ Created': ['Ordered', 'Approved'], // back to Approved only if an RFQ is cancelled
  Ordered: ['Partially Fulfilled', 'Completed'],
  'Partially Fulfilled': ['Completed'],
  Completed: [],
  Cancelled: [],
};

export const canTransition = (from: RequisitionStatus, to: RequisitionStatus) => TRANSITIONS[from]?.includes(to) ?? false;
/** Only these states allow the requester to edit the content. */
export const isEditable = (s: RequisitionStatus) => s === 'Draft' || s === 'Modification Requested';
export const isCancellable = (s: RequisitionStatus) => canTransition(s, 'Cancelled');
