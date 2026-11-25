/**
 * Rule-based question classifier. No model is involved: each intent is a set of keyword patterns and the best
 * scoring intent wins. A question that matches nothing is reported as "unknown", never guessed.
 */
export const INTENTS = [
  'below_reorder', 'best_delivery_supplier', 'best_quotation', 'spend_this_month', 'delayed_pos', 'next_month_requirements',
  'price_increase_reason', 'department_spend', 'invoice_mismatches', 'urgent_materials',
] as const;
export type Intent = (typeof INTENTS)[number];

const RULES: Record<Intent, RegExp[]> = {
  below_reorder: [/reorder/, /below.*(reorder|minimum|safety)/, /(low|critical).*stock/, /running (low|out)/],
  best_delivery_supplier: [/deliver\w*.*(reliab|best|on.?time)/, /(reliab|on.?time).*supplier/, /best.*supplier.*deliver/, /supplier.*(reliab|on.?time)/],
  best_quotation: [/best.*(quotation|quote|bid)/, /(quotation|quote|bid).*best/, /(cheapest|lowest).*(quotation|quote|bid)/, /overall.*quotation/],
  spend_this_month: [/(spend|spent|expenditure|procurement cost).*(month|this)/, /how much.*(spend|spent)/, /month.*(spend|spent)/],
  delayed_pos: [/delay\w*.*(purchase order|po\b|order)/, /(overdue|late).*(purchase order|po\b|order)/, /(purchase order|po\b).*(delay|overdue|late)/],
  next_month_requirements: [/(next|coming) month.*(require|need|demand)/, /(require|need|demand).*next month/, /what materials will be (required|needed)/, /(forecast|predict).*(demand|consumption|requirement)/],
  price_increase_reason: [/why.*price/, /price.*(increase|increased|rise|risen|went up|up)/, /(increase|rise).*price/],
  department_spend: [/department.*(spend|expenditure|highest)/, /(spend|expenditure).*department/, /which department/],
  invoice_mismatches: [/invoice.*(mismatch|dispute|discrepan|problem)/, /(mismatch|discrepan).*invoice/, /which invoices/],
  urgent_materials: [/urgent/, /(need|require).*(immediately|now|asap)/, /(order|procure).*(first|soon|now)/],
};

export interface Classification { intent: Intent | 'unknown'; score: number }

export function classify(question: string): Classification {
  const q = question.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  let best: Classification = { intent: 'unknown', score: 0 };
  for (const intent of INTENTS) {
    const score = RULES[intent].filter((r) => r.test(q)).length;
    // Strictly greater: on a tie the earlier (more specific) intent in INTENTS keeps the question.
    if (score > best.score) best = { intent, score };
  }
  return best;
}

/** Longest material name or SKU mentioned in the question, so "HMS Scrap" beats "Scrap". */
export function findMaterialMention<T extends { name: string; sku: string }>(question: string, materials: T[]): T | null {
  const q = question.toLowerCase();
  const clean = (s: string) => s.replace(/^\[demo\]\s*/i, '').toLowerCase();
  const hits = materials.filter((m) => q.includes(m.sku.toLowerCase()) || (clean(m.name).length >= 3 && q.includes(clean(m.name))));
  return hits.sort((a, b) => Math.max(clean(b.name).length, b.sku.length) - Math.max(clean(a.name).length, a.sku.length))[0] ?? null;
}

export const SUGGESTED_QUESTIONS = [
  'Which materials are below their reorder points?',
  'Which supplier has the best delivery reliability?',
  'Which purchase orders are delayed?',
  'Which materials require urgent procurement?',
  'Which invoices have mismatches?',
  'How much did we spend on procurement this month?',
  'Which department has the highest procurement expenditure?',
  'What materials will be required next month?',
  'Which supplier provides the best overall quotation?',
];
