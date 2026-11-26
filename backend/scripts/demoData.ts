/**
 * Synthetic DEMO DATA for ProcuraX. All names are fictional; nothing here is real company data.
 * Kept free of database imports so it can be unit-tested.
 */
import type { RoleName } from '../src/utils/permissions';

/** Demo login emails per role. Kept here so the seed and the workflow seed agree. */
export const DEMO_EMAILS: Record<RoleName, string> = {
  system_admin: 'admin@demo.steelprocure.example',
  procurement_manager: 'procurement@demo.steelprocure.example',
  department_manager: 'deptmanager@demo.steelprocure.example',
  inventory_officer: 'inventory@demo.steelprocure.example',
  finance_officer: 'finance@demo.steelprocure.example',
  supplier: 'supplier@demo.steelprocure.example',
  management: 'executive@demo.steelprocure.example',
};

export interface DemoCategory { code: string; name: string; description: string }
export interface DemoMaterial {
  sku: string; name: string; category: string; unit: string; specs: string;
  min: number; safety: number; reorder: number; avgPrice: string;
}
export interface DemoSupplier {
  code: string; name: string; contact: string; categories: string[]; terms: string; days: number;
  verification: 'verified' | 'pending' | 'rejected'; status: 'active' | 'inactive' | 'blocked';
  history: { completedOrders: number; onTimeDeliveries: number; unitsReceived: number; unitsAccepted: number };
  note: string;
}

export const DEMO_CATEGORIES: DemoCategory[] = [
  { code: 'BIL', name: 'Steel Billets', description: 'Continuously cast billets for rolling' },
  { code: 'SCR', name: 'Scrap', description: 'Ferrous scrap for the melt shop' },
  { code: 'FER', name: 'Ferroalloys', description: 'Alloying and deoxidation additions' },
  { code: 'REF', name: 'Refractory Materials', description: 'Furnace, ladle and tundish linings' },
  { code: 'CON', name: 'Consumables', description: 'Electrodes, fluxes and process consumables' },
  { code: 'SPR', name: 'Spare Parts', description: 'Rolling-mill and plant spares' },
  { code: 'LUB', name: 'Lubricants', description: 'Oils and greases' },
  { code: 'PKG', name: 'Packaging Materials', description: 'Bundling and tagging materials' },
  { code: 'ELE', name: 'Electrical Components', description: 'Cables, drives and switchgear' },
  { code: 'MEC', name: 'Mechanical Components', description: 'Pumps, valves and conveyors' },
];

const m = (sku: string, name: string, category: string, unit: string, specs: string, min: number, safety: number, reorder: number, avgPrice: string): DemoMaterial =>
  ({ sku, name, category, unit, specs, min, safety, reorder, avgPrice });

export const DEMO_MATERIALS: DemoMaterial[] = [
  m('BIL-120', 'Steel Billet 120mm sq', 'BIL', 'MT', '120x120mm, 12m, grade per customer spec', 200, 150, 500, '68500'),
  m('BIL-130', 'Steel Billet 130mm sq', 'BIL', 'MT', '130x130mm, 12m', 200, 150, 500, '68200'),
  m('BIL-150', 'Steel Billet 150mm sq', 'BIL', 'MT', '150x150mm, 12m', 250, 200, 600, '67900'),
  m('SCR-HMS', 'Heavy Melting Scrap (HMS 1&2)', 'SCR', 'MT', 'Min 6mm thick, max 1.5m length', 1500, 1000, 3500, '46500'),
  m('SCR-SHR', 'Shredded Scrap', 'SCR', 'MT', 'Density >= 0.9 t/m3, low residuals', 800, 500, 2000, '48800'),
  m('SCR-BND', 'Bundled Scrap', 'SCR', 'MT', 'Bundles 500x500mm', 500, 300, 1200, '47200'),
  m('SCR-RET', 'Plant Return Scrap', 'SCR', 'MT', 'Internal returns, graded', 300, 200, 800, '41000'),
  m('FER-FESI', 'Ferro Silicon 75%', 'FER', 'MT', 'Si 72-78%, 10-50mm', 20, 12, 40, '152000'),
  m('FER-SIMN', 'Silico Manganese 60/14', 'FER', 'MT', 'Mn 60%, Si 14%, 10-80mm', 40, 25, 80, '128000'),
  m('FER-HCMN', 'High Carbon Ferro Manganese', 'FER', 'MT', 'Mn 75%, C 7.5% max', 30, 20, 60, '118000'),
  m('FER-FECR', 'Ferro Chrome (High Carbon)', 'FER', 'MT', 'Cr 60-65%', 10, 6, 20, '168000'),
  m('FER-ALSH', 'Aluminium Shot (deoxidiser)', 'FER', 'MT', 'Al 98% min', 8, 5, 16, '345000'),
  m('REF-MGC', 'Magnesia Carbon Bricks', 'REF', 'MT', 'MgO 80%, C 14%', 25, 15, 50, '212000'),
  m('REF-LDL', 'Ladle Castable', 'REF', 'MT', 'Alumina 85%, low cement', 20, 12, 40, '98000'),
  m('REF-TUN', 'Tundish Nozzle', 'REF', 'EA', 'Zirconia-graphite, 80mm', 60, 40, 120, '14500'),
  m('REF-GUN', 'Gunning Mass', 'REF', 'MT', 'Magnesia based', 30, 20, 60, '64000'),
  m('CON-ELE', 'Graphite Electrode 600mm', 'CON', 'EA', 'UHP, 600mm x 2700mm', 12, 8, 24, '910000'),
  m('CON-LIME', 'Burnt Lime', 'CON', 'MT', 'CaO 90% min', 120, 80, 250, '19500'),
  m('CON-DOL', 'Calcined Dolomite', 'CON', 'MT', 'MgO 30%, CaO 55%', 80, 50, 160, '21000'),
  m('CON-COKE', 'Carbon Injection Coke', 'CON', 'MT', 'Fixed carbon 85% min, 0-3mm', 60, 40, 120, '58000'),
  m('CON-OXY', 'Industrial Oxygen (bulk)', 'CON', 'KNM3', '99.5% purity', 40, 25, 90, '9500'),
  m('SPR-RLR', 'Finishing Mill Roll', 'SPR', 'EA', 'Carbide ring, 300mm OD', 6, 4, 10, '420000'),
  m('SPR-BRG', 'Roller Bearing 22330', 'SPR', 'EA', 'Spherical roller bearing', 20, 12, 40, '38000'),
  m('SPR-GRB', 'Gearbox Seal Kit', 'SPR', 'KIT', 'For 800kW mill gearbox', 10, 6, 20, '24000'),
  m('LUB-HYD', 'Hydraulic Oil ISO VG 68', 'LUB', 'L', 'Anti-wear HM', 3000, 2000, 6000, '285'),
  m('LUB-GRS', 'EP2 Lithium Grease', 'LUB', 'KG', 'NLGI 2, EP', 500, 300, 1000, '420'),
  m('LUB-GRB', 'Gear Oil ISO VG 320', 'LUB', 'L', 'Industrial EP', 2000, 1200, 4000, '310'),
  m('PKG-WIRE', 'Binding Wire 5.5mm', 'PKG', 'MT', 'Annealed, coil', 15, 10, 30, '98000'),
  m('PKG-TAG', 'Product Identification Tags', 'PKG', 'EA', 'Weather-proof, printed', 20000, 12000, 40000, '12'),
  m('PKG-STRP', 'Steel Strapping 19mm', 'PKG', 'MT', 'Painted, 19x0.8mm', 12, 8, 24, '115000'),
  m('ELE-CBL', 'Power Cable 11kV 3C x 240mm2', 'ELE', 'M', 'XLPE armoured', 1000, 600, 2000, '5200'),
  m('ELE-CNT', 'Contactor 400A', 'ELE', 'EA', '3P, 415V coil', 15, 10, 30, '36000'),
  m('ELE-VFD', 'Variable Frequency Drive 160kW', 'ELE', 'EA', '3-phase 415V', 3, 2, 5, '780000'),
  m('MEC-PMP', 'Cooling Water Pump 200m3/h', 'MEC', 'EA', 'End-suction, 45kW', 3, 2, 5, '540000'),
  m('MEC-VLV', 'Pneumatic Control Valve DN100', 'MEC', 'EA', 'With positioner', 8, 5, 15, '86000'),
  m('MEC-CHN', 'Conveyor Chain (per set)', 'MEC', 'SET', 'Heavy duty, 40m', 4, 3, 8, '210000'),
];

const h = (completedOrders: number, onTimeDeliveries: number, unitsReceived: number, unitsAccepted: number) =>
  ({ completedOrders, onTimeDeliveries, unitsReceived, unitsAccepted });

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  { code: 'SUP-0001', name: '[DEMO] Karnaphuli Metals Trading Ltd', contact: 'Demo Contact A', categories: ['BIL', 'SCR'], terms: 'Net 45', days: 45, verification: 'verified', status: 'active', history: h(48, 45, 12000, 11880), note: 'Proven, reliable billets and scrap' },
  { code: 'SUP-0002', name: '[DEMO] Padma Steel Sourcing Ltd', contact: 'Demo Contact B', categories: ['BIL', 'SCR'], terms: 'Net 30', days: 30, verification: 'verified', status: 'active', history: h(36, 31, 9000, 8730), note: 'Competitive price, some late deliveries' },
  { code: 'SUP-0003', name: '[DEMO] Jamuna Ferro Alloys Ltd', contact: 'Demo Contact C', categories: ['FER'], terms: 'Net 30', days: 30, verification: 'verified', status: 'active', history: h(28, 27, 640, 637), note: 'Ferroalloy specialist' },
  { code: 'SUP-0004', name: '[DEMO] Surma Refractories Ltd', contact: 'Demo Contact D', categories: ['REF'], terms: 'Net 60', days: 60, verification: 'verified', status: 'active', history: h(22, 19, 560, 548), note: 'Refractory supplier' },
  { code: 'SUP-0005', name: '[DEMO] Teesta Industrial Supplies Ltd', contact: 'Demo Contact E', categories: ['CON', 'SPR', 'PKG'], terms: 'Net 30', days: 30, verification: 'verified', status: 'active', history: h(40, 36, 8800, 8650), note: 'General industrial supplier' },
  { code: 'SUP-0006', name: '[DEMO] Brahmaputra Lubricants Ltd', contact: 'Demo Contact F', categories: ['LUB'], terms: 'Net 30', days: 30, verification: 'verified', status: 'active', history: h(18, 17, 30000, 29700), note: 'Lubricants' },
  { code: 'SUP-0007', name: '[DEMO] Rupsha Electrical & Mechanical Ltd', contact: 'Demo Contact G', categories: ['ELE', 'MEC'], terms: 'Net 45', days: 45, verification: 'verified', status: 'active', history: h(25, 22, 420, 411), note: 'Electrical and mechanical components' },
  { code: 'SUP-0008', name: '[DEMO] Madhumati Scrap Traders', contact: 'Demo Contact H', categories: ['SCR'], terms: 'Net 15', days: 15, verification: 'verified', status: 'active', history: h(2, 2, 400, 400), note: 'UNPROVEN: only 2 completed orders, scored neutrally' },
  { code: 'SUP-0009', name: '[DEMO] Sundarbans Billet Works', contact: 'Demo Contact I', categories: ['BIL'], terms: 'Net 30', days: 30, verification: 'pending', status: 'active', history: h(0, 0, 0, 0), note: 'Not yet verified: cannot be invited to RFQs' },
  { code: 'SUP-0010', name: '[DEMO] Halda Spares & Services', contact: 'Demo Contact J', categories: ['SPR', 'MEC'], terms: 'Net 30', days: 30, verification: 'verified', status: 'blocked', history: h(14, 8, 300, 255), note: 'BLOCKED after repeated quality and delivery failures' },
];

/** Extra demo supplier logins beyond the main supplier user: DEMO_UID_SUPPLIER_2 -> SUP-0002, _3 -> SUP-0003. */
export const DEMO_SUPPLIER_USER_LINKS: { env: string; supplierCode: string; email: string }[] = [
  { env: 'DEMO_UID_SUPPLIER', supplierCode: 'SUP-0001', email: 'supplier@demo.steelprocure.example' },
  { env: 'DEMO_UID_SUPPLIER_2', supplierCode: 'SUP-0002', email: 'supplier2@demo.steelprocure.example' },
  { env: 'DEMO_UID_SUPPLIER_3', supplierCode: 'SUP-0003', email: 'supplier3@demo.steelprocure.example' },
];

export const DEMO_WAREHOUSES = [
  { code: 'WH-MAIN', name: '[DEMO] Main Raw Material Yard', location: 'Plant Gate 1' },
  { code: 'WH-MILL', name: '[DEMO] Rolling Mill Store', location: 'Mill Bay 3' },
  { code: 'WH-SPR', name: '[DEMO] Spares & Consumables Store', location: 'Maintenance Block' },
];

/** Which warehouse a category is normally kept in. */
const HOME: Record<string, string> = { BIL: 'WH-MAIN', SCR: 'WH-MAIN', FER: 'WH-MAIN', CON: 'WH-MAIN', REF: 'WH-MILL', PKG: 'WH-MILL', SPR: 'WH-SPR', LUB: 'WH-SPR', ELE: 'WH-SPR', MEC: 'WH-SPR' };
// Cycles through healthy, reorder, low and critical so every alert level has demo rows. Fractions of the reorder point.
const FACTORS = [1.8, 1.4, 0.85, 1.2, 0.45, 2.1, 0.25, 1.6, 0.7];

/** Deterministic opening balance so the demo shows every stock status. Returns whole units. */
export function openingStock(m: DemoMaterial, index: number): { warehouse: string; quantity: string } {
  const qty = Math.max(1, Math.round(m.reorder * FACTORS[index % FACTORS.length]));
  return { warehouse: HOME[m.category], quantity: String(qty) };
}

/* ---------- Phase 4: planning demo data ---------- */
export const LEAD_TIME_BY_CATEGORY: Record<string, number> = { BIL: 10, SCR: 7, FER: 21, REF: 28, CON: 12, SPR: 30, LUB: 7, PKG: 10, ELE: 35, MEC: 40 };
/** Largest quantity the preferred supplier can deliver on one order, for the materials where it matters. */
export const SUPPLIER_CAPACITY: Record<string, number> = { 'SCR-HMS': 1500, 'BIL-130': 800, 'FER-SIMN': 60 };

export interface DemoProduct { code: string; name: string; unit: string; intermediate: boolean }
export const DEMO_PRODUCTS: DemoProduct[] = [
  { code: 'TMT-12', name: '[DEMO] TMT Bar 12mm', unit: 'MT', intermediate: false },
  { code: 'TMT-16', name: '[DEMO] TMT Bar 16mm', unit: 'MT', intermediate: false },
  { code: 'TMT-10I', name: '[DEMO] TMT Bar 10mm (integrated route)', unit: 'MT', intermediate: false },
  { code: 'BIL-IH', name: '[DEMO] In-house Billet 130mm', unit: 'MT', intermediate: true },
];

export interface DemoBom {
  product: string; version: number; effectiveFrom: string; status: 'active' | 'draft'; notes: string;
  items: { sku?: string; product?: string; quantity: string; wastage: string }[];
}
// Quantities are per ONE MT of the product. Illustrative values, not real process data.
export const DEMO_BOMS: DemoBom[] = [
  { product: 'TMT-12', version: 1, effectiveFrom: '2026-01-01', status: 'active', notes: 'DEMO: original recipe', items: [
    { sku: 'BIL-130', quantity: '1', wastage: '4' }, { sku: 'FER-SIMN', quantity: '0.013', wastage: '2' }, { sku: 'FER-FESI', quantity: '0.0035', wastage: '2' },
    { sku: 'REF-LDL', quantity: '0.0006', wastage: '0' }, { sku: 'REF-TUN', quantity: '0.003', wastage: '0' }, { sku: 'PKG-WIRE', quantity: '0.003', wastage: '1' }, { sku: 'PKG-TAG', quantity: '4', wastage: '0' } ] },
  { product: 'TMT-12', version: 2, effectiveFrom: '2026-09-01', status: 'active', notes: 'DEMO: lower billet wastage after mill tuning (applies to plans starting on or after 1 Sep 2026)', items: [
    { sku: 'BIL-130', quantity: '1', wastage: '3' }, { sku: 'FER-SIMN', quantity: '0.013', wastage: '2' }, { sku: 'FER-FESI', quantity: '0.0035', wastage: '2' },
    { sku: 'REF-LDL', quantity: '0.0006', wastage: '0' }, { sku: 'REF-TUN', quantity: '0.003', wastage: '0' }, { sku: 'PKG-WIRE', quantity: '0.003', wastage: '1' }, { sku: 'PKG-TAG', quantity: '4', wastage: '0' } ] },
  { product: 'TMT-16', version: 1, effectiveFrom: '2026-01-01', status: 'active', notes: 'DEMO', items: [
    { sku: 'BIL-150', quantity: '1', wastage: '3.5' }, { sku: 'FER-SIMN', quantity: '0.012', wastage: '2' }, { sku: 'LUB-HYD', quantity: '0.8', wastage: '0' },
    { sku: 'PKG-WIRE', quantity: '0.003', wastage: '1' }, { sku: 'PKG-TAG', quantity: '4', wastage: '0' } ] },
  { product: 'TMT-10I', version: 1, effectiveFrom: '2026-01-01', status: 'active', notes: 'DEMO: multi-level, uses in-house billet', items: [
    { product: 'BIL-IH', quantity: '1', wastage: '4' }, { sku: 'PKG-WIRE', quantity: '0.003', wastage: '1' }, { sku: 'PKG-TAG', quantity: '5', wastage: '0' } ] },
  { product: 'BIL-IH', version: 1, effectiveFrom: '2026-01-01', status: 'active', notes: 'DEMO: melt shop recipe from scrap', items: [
    { sku: 'SCR-HMS', quantity: '1.08', wastage: '0' }, { sku: 'SCR-SHR', quantity: '0.12', wastage: '0' }, { sku: 'FER-SIMN', quantity: '0.011', wastage: '2' }, { sku: 'FER-FESI', quantity: '0.003', wastage: '2' },
    { sku: 'CON-ELE', quantity: '0.0006', wastage: '0' }, { sku: 'CON-LIME', quantity: '0.04', wastage: '0' }, { sku: 'CON-DOL', quantity: '0.02', wastage: '0' },
    { sku: 'CON-COKE', quantity: '0.008', wastage: '0' }, { sku: 'CON-OXY', quantity: '0.05', wastage: '0' }, { sku: 'REF-MGC', quantity: '0.0007', wastage: '0' }, { sku: 'REF-GUN', quantity: '0.002', wastage: '0' } ] },
];

export interface DemoPlan { ref: string; product: string; quantity: string; startInDays: number; durationDays: number; status: 'planned' | 'confirmed'; notes: string }
export const DEMO_PLANS: DemoPlan[] = [
  { ref: 'DEMO-PLAN-1', product: 'TMT-12', quantity: '600', startInDays: 12, durationDays: 8, status: 'confirmed', notes: 'DEMO: standard 12mm campaign' },
  { ref: 'DEMO-PLAN-2', product: 'TMT-16', quantity: '400', startInDays: 25, durationDays: 8, status: 'planned', notes: 'DEMO' },
  { ref: 'DEMO-PLAN-3', product: 'TMT-10I', quantity: '300', startInDays: 5, durationDays: 7, status: 'confirmed', notes: 'DEMO: short notice, exercises lead-time constraints and the multi-level BOM' },
  { ref: 'DEMO-PLAN-4', product: 'TMT-12', quantity: '800', startInDays: 70, durationDays: 10, status: 'planned', notes: 'DEMO: beyond the default 30-day horizon' },
];

export interface DemoReservation { ref: string; sku: string; quantity: string; reason: string; plan?: string }
export const DEMO_RESERVATIONS: DemoReservation[] = [
  { ref: 'DEMO-RES-1', sku: 'BIL-130', quantity: '100', reason: 'DEMO: held for an export order, not available to production' },
  { ref: 'DEMO-RES-2', sku: 'FER-SIMN', quantity: '5', reason: 'DEMO: set aside for plan 1', plan: 'DEMO-PLAN-1' },
];

const WEEKLY = [0.9, 1.1, 1, 0.8, 1.2, 1, 0.95, 1.05, 1.1, 0.9, 1, 1.15, 0.85];
export const HISTORY_WEEKS = 52;
/** One material gets a deliberately large final week so the abnormal-consumption detector has real data to find. */
export const CONSUMPTION_SPIKE_SKU = 'SCR-SHR';
/**
 * 52 weekly issues to production over the last year: a base level sized from the reorder point, a gentle yearly cycle and a
 * repeating week-to-week pattern. Each issue falls mid-week (daysAgo = 7 x week - 3), so every 7-day bucket ending today holds
 * exactly one issue. Deterministic.
 */
export function consumptionHistory(m: DemoMaterial): { daysAgo: number; quantity: number }[] {
  const weekly = Math.max(1, m.reorder * 0.06);
  return Array.from({ length: HISTORY_WEEKS }, (_, i) => {
    const season = 1 + 0.15 * Math.sin((2 * Math.PI * i) / 52);
    const spike = m.sku === CONSUMPTION_SPIKE_SKU && i === 0 ? 4 : 1; // i = 0 is the most recent week
    return { daysAgo: 7 * (i + 1) - 3, quantity: Math.max(1, Math.round(weekly * WEEKLY[i % WEEKLY.length] * season * spike)) };
  });
}

/* ---------- Phase 5: price history ---------- */
export const PRICE_OBSERVATIONS = 14;
const PRICE_NOISE = [0, 0.01, -0.01, 0.015, -0.015, 0.005, -0.005];
/** Daily drift as a fraction of the average price, for materials that should show a rising trend. */
export const PRICE_TREND_PER_DAY: Record<string, number> = { 'BIL-130': 0.0004, 'SCR-HMS': 0.0003 };
/** Multiplier on the most recent price, so the price-increase detector has something to find. */
export const PRICE_JUMP: Record<string, number> = { 'FER-SIMN': 1.28 };
/** 14 observations 26 days apart ending 26 days ago, oldest first. Deterministic. */
export function priceHistory(m: DemoMaterial): { daysAgo: number; price: string }[] {
  const base = Number(m.avgPrice);
  const drift = PRICE_TREND_PER_DAY[m.sku] ?? 0;
  return Array.from({ length: PRICE_OBSERVATIONS }, (_, i) => {
    const daysAgo = 26 * (PRICE_OBSERVATIONS - i);
    const last = i === PRICE_OBSERVATIONS - 1;
    const level = base * (1 + drift * (364 - daysAgo - 182)) * (1 + PRICE_NOISE[i % PRICE_NOISE.length]) * (last ? PRICE_JUMP[m.sku] ?? 1 : 1);
    return { daysAgo, price: level.toFixed(2) };
  });
}
