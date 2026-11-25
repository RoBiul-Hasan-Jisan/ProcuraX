import { Schema, model } from 'mongoose';

/**
 * Append-only. Application code can only create entries: every update, replace and delete path is refused here, and there
 * is no route that edits or removes an entry. This protects against mistakes and ordinary application misuse; it is not a
 * substitute for database permissions (see the README: give the application's database user insert+find only on this collection).
 */
const schema = new Schema(
  {
    at: { type: Date, default: Date.now, immutable: true, index: true },
    actor: { id: { type: String, default: null }, name: { type: String, default: 'System' }, role: { type: String, default: null } },
    action: { type: String, required: true, immutable: true, index: true },
    entityType: { type: String, required: true, immutable: true },
    entityId: { type: String, required: true, immutable: true },
    entityNumber: { type: String, default: '' },
    summary: { type: String, default: '' },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: false },
);
schema.index({ entityType: 1, entityId: 1, at: -1 });
schema.index({ 'actor.id': 1, at: -1 });

const refuse = () => { throw new Error('Audit log entries are append-only and cannot be modified or deleted'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) schema.pre(op as any, refuse);
schema.pre('bulkWrite' as any, refuse);
schema.pre('save', function () { if (!this.isNew) refuse(); });
schema.pre('deleteOne', { document: true, query: false }, refuse);

export const AuditLog = model('AuditLog', schema);
