/**
 * Notification hook. Phase 6 replaces these bodies with persisted, role-aware notifications.
 * Business services already call them at the right moments so nothing needs rewiring later.
 */
export const notify = {
  async approvalNeeded(_requisition: unknown, _approverRole: string): Promise<void> {},
  async requisitionDecided(_requisition: unknown, _action: string): Promise<void> {},
  async rfqPublished(_rfq: unknown, _supplierIds: string[]): Promise<void> {},
  async quotationSubmitted(_rfq: unknown, _supplierId: string): Promise<void> {},
  async supplierAwarded(_rfq: unknown, _supplierId: string): Promise<void> {},
};
