import { Schema, model } from 'mongoose';

const dec = { type: Schema.Types.Decimal128 };
const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    lines: [
      {
        material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
        materialName: String, unit: String,
        acceptedQty: { ...dec, required: true },
        rejectedQty: { ...dec, required: true },
        rejectionReason: { type: String, default: '' },
        _id: false,
      },
    ],
    deliveryNote: { type: String, default: '' },
    notes: { type: String, default: '' },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedByName: String,
    receivedAt: { type: Date, default: Date.now },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const GoodsReceipt = model('GoodsReceipt', schema);
