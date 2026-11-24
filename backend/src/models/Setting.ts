import { Schema, model } from 'mongoose';

/** Generic key/value configuration (approval thresholds, scoring weights, ...). */
const schema = new Schema({ key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed }, { timestamps: true });
export const Setting = model('Setting', schema);

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const doc = await Setting.findOne({ key }).lean();
  return (doc?.value as T | undefined) ?? fallback;
}
export async function putSetting(key: string, value: unknown): Promise<void> {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}
