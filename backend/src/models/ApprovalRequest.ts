import { Schema, model } from 'mongoose';

const stepSchema = new Schema(
  {
    order: { type: Number, required: true },
    role: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'modification_requested'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    comment: { type: String, default: '' },
  },
  { _id: false },
);

const schema = new Schema(
  {
    requisition: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true, index: true },
    // Incremented on each resubmission after "Modification Requested"
    cycle: { type: Number, default: 1 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'modification_requested', 'cancelled'], default: 'pending', index: true },
    currentStep: { type: Number, default: 1 },
    steps: [stepSchema],
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ requisition: 1, cycle: 1 }, { unique: true });
export const ApprovalRequest = model('ApprovalRequest', schema);
