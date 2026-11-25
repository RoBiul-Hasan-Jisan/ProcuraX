import { Router } from 'express';
import { sendSuccess } from '../utils/apiResponse';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { reportExportQuery, reportKeyParam, reportQuery } from '../validators/schemas';
import { availableReports, filterOptions, runReport } from '../services/reportService';
import { EXPORTS, exportFileName, renderExport, type ExportFormat } from '../services/reportExport';
import { audit } from '../services/auditService';
import { protectedChain, validated } from './common';

const r = Router();
r.use('/reports', ...protectedChain, requirePermission('reports:view'));

r.get('/reports', (req, res) => sendSuccess(res, availableReports(req.user!)));
r.get('/reports/filter-options', async (_req, res) => sendSuccess(res, await filterOptions()));
r.get('/reports/:key', validate(reportKeyParam, 'params'), validate(reportQuery, 'query'), async (req, res) => {
  sendSuccess(res, await runReport(req.user!, validated<any>(res, 'params').key, validated<any>(res, 'query')));
});
/** Export re-runs the report with the same filters and permission checks; the file is never cached or stored. */
r.get('/reports/:key/export', validate(reportKeyParam, 'params'), validate(reportQuery.and(reportExportQuery), 'query'), async (req, res) => {
  const { key } = validated<any>(res, 'params');
  const { format, ...filters } = validated<any>(res, 'query') as { format: ExportFormat } & Record<string, string>;
  const result = await runReport(req.user!, key, filters);
  const body = await renderExport(result, format);
  await audit(req.user!, { action: 'report.exported', entityType: 'report', entityId: key, entityNumber: key, summary: `Exported ${result.title} as ${format.toUpperCase()}`, after: { format, filters: result.filters, rows: result.rows.length } });
  res.setHeader('Content-Type', EXPORTS[format].mime);
  res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(key, format)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
});

export default r;
