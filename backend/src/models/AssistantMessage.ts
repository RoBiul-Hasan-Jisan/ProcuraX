import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    question: { type: String, required: true },
    intent: { type: String, required: true },
    answer: { type: Schema.Types.Mixed, required: true }, // the structured answer returned to the user
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ user: 1, createdAt: -1 });
export const AssistantMessage = model('AssistantMessage', schema);
