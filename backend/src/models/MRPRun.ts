import { Schema, model } from 'mongoose';

/** A saved MRP run. `inputs` is the full snapshot the calculation used, so any past run can be reviewed exactly as calculated. */
const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    runDate: { type: Date, required: true },
    horizonDays: { type: Number, required: true },
    plans: [{ type: Schema.Types.ObjectId, ref: 'ProductionPlan' }],
    inputs: Schema.Types.Mixed,
    issues: [{ plan: String, message: String }],
    summary: Schema.Types.Mixed,
    status: { type: String, enum: ['completed', 'completed_with_issues'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
export const MRPRun = model('MRPRun', schema);
