export interface RfqLike {
  status: 'open' | 'closed' | 'awarded' | 'cancelled';
  deadline: Date;
  invitedSuppliers: string[];
}

/** Returns an error message if the supplier may not submit/update a quotation now, otherwise null. */
export function validateQuotationWindow(rfq: RfqLike, supplierId: string | null, now = new Date()): string | null {
  if (!supplierId) return 'Your account is not linked to a supplier record';
  if (!rfq.invitedSuppliers.includes(supplierId)) return 'You were not invited to this RFQ';
  if (rfq.status !== 'open') return 'This RFQ is no longer open for quotations';
  if (now.getTime() > rfq.deadline.getTime()) return 'The submission deadline has passed';
  return null;
}
