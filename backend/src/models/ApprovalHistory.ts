import { Schema, model } from 'mongoose';

/** Append-only record of every approval-related action. */
const schema = new Schema(
  {
    requisition: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true, index: true },
    approvalRequest: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    action: { type: String, enum: ['submitted', 'approved', 'rejected', 'modification_requested', 'resubmitted', 'cancelled'], required: true },
    step: Number,
    stepLabel: String,
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, default: null },
    comment: { type: String, default: '' },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);
export const ApprovalHistory = model('ApprovalHistory', schema);
