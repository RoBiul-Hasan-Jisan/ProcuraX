import { Schema, model } from 'mongoose';

/** Current balance per material per warehouse. Only changed together with a StockMovement (see inventoryService). */
const schema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    quantity: { type: Schema.Types.Decimal128, required: true, default: 0 },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ material: 1, warehouse: 1 }, { unique: true });
export const StockLevel = model('StockLevel', schema);
