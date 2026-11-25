import { Schema, model } from 'mongoose';
import { DOCUMENT_ENTITIES } from '../domain/documents';

/** Metadata only. The bytes live in the storage adapter under `key`. */
const schema = new Schema(
  {
    entityType: { type: String, enum: DOCUMENT_ENTITIES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    entityNumber: { type: String, default: '' },
    name: { type: String, required: true },            // display name only, never a path
    key: { type: String, required: true, unique: true }, // server-generated storage key
    mimeType: { type: String, required: true },          // from the detected content, not from the browser
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    description: { type: String, default: '', maxlength: 300 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, required: true },
    deletedAt: { type: Date, default: null },
    deletedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
schema.index({ entityType: 1, entityId: 1, deletedAt: 1, createdAt: -1 });
export const DocumentFile = model('DocumentFile', schema);
