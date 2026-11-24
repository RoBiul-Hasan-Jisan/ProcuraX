/**
 * Synthetic DEMO DATA for SteelProcure AI. All names are fictional; nothing here is real company data.
 * Kept free of database imports so it can be unit-tested.
 */
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
