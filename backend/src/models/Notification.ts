import { Schema, model } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'requisition_submitted', 'approval_requested', 'requisition_approved', 'requisition_rejected', 'modification_requested', 'rfq_published', 'quotation_submitted',
  'supplier_awarded', 'purchase_order_issued', 'goods_received', 'invoice_verified', 'invoice_disputed', 'low_stock', 'critical_stock',
  'delayed_delivery', 'supplier_performance', 'risk_alert',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const schema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    /** Front-end path of the related record, only ever a relative path. */
    link: { type: String, default: '' },
    entity: { kind: String, id: String, number: String },
    dedupeKey: { type: String, default: null },
    readAt: { type: Date, default: null },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ recipient: 1, createdAt: -1 });
schema.index({ recipient: 1, readAt: 1 });
schema.index({ recipient: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const Notification = model('Notification', schema);
