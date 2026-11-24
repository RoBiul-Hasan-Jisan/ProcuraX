import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    supplierCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    contactPerson: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    registrationNumber: { type: String, default: '' },
    taxId: { type: String, default: '' },
    materialCategories: [{ type: Schema.Types.ObjectId, ref: 'MaterialCategory' }],
    paymentTerms: { type: String, default: 'Net 30' },
    paymentTermsDays: { type: Number, default: 30, min: 0 },
    // Restricted: only returned to users holding suppliers:bank (and the supplier themselves).
    bankInfo: {
      bankName: { type: String, default: '' },
      accountName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
    },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    status: { type: String, enum: ['active', 'inactive', 'blocked'], default: 'active', index: true },
    // Recorded performance history. Updated from goods receipts / deliveries in Phase 3; seeded in demo data.
    history: {
      completedOrders: { type: Number, default: 0, min: 0 },
      onTimeDeliveries: { type: Number, default: 0, min: 0 },
      unitsReceived: { type: Number, default: 0, min: 0 },
      unitsAccepted: { type: Number, default: 0, min: 0 },
    },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ companyName: 'text', supplierCode: 'text' });
export const Supplier = model('Supplier', schema);
