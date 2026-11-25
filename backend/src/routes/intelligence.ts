import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { sendSuccess } from '../utils/apiResponse';
import { assistantBody, forecastListQuery, forecastRunBody, idParam, materialIdParam, riskListQuery, riskReviewBody } from '../validators/schemas';
import * as forecasting from '../services/forecastingService';
import * as risk from '../services/riskService';
import * as assistant from '../services/assistantService';
import { supplierScoring } from '../services/supplierScoringService';
import { SUGGESTED_QUESTIONS } from '../domain/assistantIntents';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/forecasting', '/risk-alerts', '/assistant', '/supplier-scoring'], ...protectedChain);
const id = (res: any) => validated<any>(res, 'params').id as string;

/* Forecasting: reading needs forecasting:view; generating a forecast calls the ML service, so it needs mrp:run */
r.get('/forecasting', requirePermission('forecasting:view'), validate(forecastListQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await forecasting.listForecasts(q);
  sendSuccess(res, items, 'Forecasts retrieved', 200, paginate(q.page, q.limit, total));
});
r.get('/forecasting/material/:materialId', requirePermission('forecasting:view'), validate(materialIdParam, 'params'), async (_req, res) => sendSuccess(res, await forecasting.materialForecastView(validated<any>(res, 'params').materialId)));
r.post('/forecasting/demand', requirePermission('mrp:run'), validate(forecastRunBody), async (req, res) => sendSuccess(res, await forecasting.runDemandForecast(req.user!, validated<any>(res, 'body').materialId), 'Demand forecast generated', 201));
r.post('/forecasting/prices', requirePermission('mrp:run'), validate(forecastRunBody), async (req, res) => sendSuccess(res, await forecasting.runPriceForecast(req.user!, validated<any>(res, 'body').materialId), 'Price forecast generated', 201));

/* Risk alerts */
r.get('/risk-alerts', requirePermission('intelligence:view'), validate(riskListQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total, unresolved } = await risk.listAlerts(q, req.user!);
  sendSuccess(res, items, 'Risk alerts retrieved', 200, { ...paginate(q.page, q.limit, total), unresolved } as any);
});
r.post('/risk-alerts/scan', requirePermission('risks:review'), async (_req, res) => sendSuccess(res, await risk.scan(), 'Scan complete'));
r.get('/risk-alerts/:id', requirePermission('intelligence:view'), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await risk.getAlert(id(res))));
r.post('/risk-alerts/:id/review', requirePermission('risks:review'), validate(idParam, 'params'), validate(riskReviewBody), async (req, res) => sendSuccess(res, await risk.reviewAlert(req.user!, id(res), validated(res, 'body')), 'Alert updated'));

/* Assistant */
r.get('/assistant/suggestions', requirePermission('intelligence:view'), (_req, res) => sendSuccess(res, SUGGESTED_QUESTIONS));
r.get('/assistant/history', requirePermission('intelligence:view'), async (req, res) => sendSuccess(res, await assistant.history(req.user!)));
r.post('/assistant/query', requirePermission('intelligence:view'), validate(assistantBody), async (req, res) => sendSuccess(res, await assistant.ask(req.user!, validated<any>(res, 'body').question)));

/* Supplier performance */
r.get('/supplier-scoring', requirePermission('suppliers:view'), async (_req, res) => sendSuccess(res, await supplierScoring()));

export default r;
