import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { csvCell, safeText, toCsv, type Column, type ReportResult } from '../domain/reports';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const EXPORTS: Record<ExportFormat, { mime: string; ext: string }> = {
  csv: { mime: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pdf: { mime: 'application/pdf', ext: 'pdf' },
};
export const exportFileName = (key: string, fmt: ExportFormat, now = new Date()) => `${key}-${now.toISOString().slice(0, 10)}.${EXPORTS[fmt].ext}`;

const NUM_FMT: Partial<Record<Column['type'], string>> = { money: '#,##0.00', qty: '#,##0.000', pct: '0.0', int: '0' };
const isNum = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);

export async function toXlsx(r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcuraX (demo)';
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${r.generatedAt}`]);
  const f = Object.entries(r.filters);
  if (f.length) ws.addRow([`Filters: ${f.map(([k, v]) => `${k}=${v}`).join(', ')}`]);
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => safeText(c.label)));
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; });
  const put = (src: Record<string, any>, bold = false) => {
    const row = ws.addRow(r.columns.map((c) => {
      const v = src[c.key] ?? null;
      return c.type !== 'text' && isNum(v) ? Number(v) : safeText(v); // text is stored as a string, never as a formula
    }));
    r.columns.forEach((c, i) => { const fmt = NUM_FMT[c.type]; if (fmt) row.getCell(i + 1).numFmt = fmt; });
    if (bold) row.font = { bold: true };
  };
  r.rows.forEach((row) => put(row));
  if (r.totals) put(r.totals, true);
  r.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(40, Math.max(c.label.length + 2, 12)); });
  ws.views = [{ state: 'frozen', ySplit: ws.rowCount - r.rows.length - (r.totals ? 1 : 0) }];
  if (r.notes.length) { ws.addRow([]); r.notes.forEach((n) => ws.addRow([safeText(n)])); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: r.title, Author: 'ProcuraX (demo)' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    const W = doc.page.width - 72;
    doc.fontSize(15).font('Helvetica-Bold').text(r.title);
    doc.fontSize(8).font('Helvetica').fillColor('#555').text(`Generated ${r.generatedAt} · ProcuraX demo · synthetic data`);
    const f = Object.entries(r.filters);
    if (f.length) doc.text(`Filters: ${f.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    doc.moveDown(0.6).fillColor('#000');
    if (!r.columns.length) { doc.fontSize(10).text('No data.'); }
    else {
      const w = W / r.columns.length;
      const fit = (s: string, size: number) => { let t = s; while (t.length > 1 && doc.widthOfString(t) > w - 6) t = t.slice(0, -1); return t === s ? s : t.slice(0, -1) + '…'; };
      const line = (cells: string[], bold: boolean, y: number) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
        cells.forEach((t, i) => { const right = r.columns[i]!.type !== 'text' && r.columns[i]!.type !== 'date'; doc.text(fit(t, 7.5), 36 + i * w + 2, y, { width: w - 6, align: right ? 'right' : 'left', lineBreak: false }); });
      };
      const header = () => { const y = doc.y; doc.rect(36, y - 2, W, 13).fill('#E5E7EB').fillColor('#000'); line(r.columns.map((c) => c.label), true, y); doc.y = y + 14; };
      header();
      const all = [...r.rows.map((x) => ({ x, bold: false })), ...(r.totals ? [{ x: r.totals, bold: true }] : [])];
      for (const { x, bold } of all) {
        if (doc.y > doc.page.height - 60) { doc.addPage(); header(); }
        const y = doc.y;
        line(r.columns.map((c) => (x[c.key] === null || x[c.key] === undefined ? '' : String(x[c.key]))), bold, y);
        doc.y = y + 12;
      }
    }
    doc.moveDown(1).font('Helvetica').fontSize(7.5).fillColor('#555');
    r.notes.forEach((n) => doc.text(`• ${n}`, 36, doc.y, { width: W }));
    doc.end();
  });
}

export async function renderExport(r: ReportResult, fmt: ExportFormat): Promise<Buffer> {
  if (fmt === 'csv') return Buffer.from(toCsv(r), 'utf8');
  return fmt === 'xlsx' ? toXlsx(r) : toPdf(r);
}
export { csvCell };
