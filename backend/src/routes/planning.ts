import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { sendSuccess } from '../utils/apiResponse';
import {
  bomBody, idParam, listBomsQuery, listPlansQuery, listProductsQuery, listReservationsQuery, listRunsQuery, mrpRunBody, mrpSettingsBody,
  planBody, planStatusBody, productBody, productUpdateBody, reorderQuery, reservationBody,
} from '../validators/schemas';
import * as planning from '../services/planningService';
import { audit } from '../services/auditService';
import * as mrp from '../services/mrpService';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/finished-products', '/boms', '/production-plans', '/reservations', '/mrp'], ...protectedChain);
const id = (res: any) => validated<any>(res, 'params').id as string;
const READ = ['production:manage', 'mrp:view'] as const;

/* Products */
r.get('/finished-products', requirePermission(...READ), validate(listProductsQuery, 'query'), async (_req, res) => sendSuccess(res, await planning.listProducts(validated(res, 'query'))));
r.post('/finished-products', requirePermission('production:manage'), validate(productBody), async (_req, res) => sendSuccess(res, await planning.createProduct(validated(res, 'body')), 'Product created', 201));
r.patch('/finished-products/:id', requirePermission('production:manage'), validate(idParam, 'params'), validate(productUpdateBody), async (_req, res) => sendSuccess(res, await planning.updateProduct(id(res), validated(res, 'body')), 'Product updated'));

/* Bills of materials */
r.get('/boms', requirePermission(...READ), validate(listBomsQuery, 'query'), async (_req, res) => sendSuccess(res, await planning.listBoms(validated(res, 'query'))));
r.post('/boms', requirePermission('production:manage'), validate(bomBody), async (req, res) => sendSuccess(res, await planning.createBom(req.user!, validated(res, 'body')), 'Draft BOM created', 201));
r.get('/boms/:id', requirePermission(...READ), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await planning.getBom(id(res))));
r.put('/boms/:id', requirePermission('production:manage'), validate(idParam, 'params'), validate(bomBody), async (_req, res) => sendSuccess(res, await planning.updateBom(id(res), validated(res, 'body')), 'BOM updated'));
r.post('/boms/:id/activate', requirePermission('production:manage'), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await planning.activateBom(id(res)), 'BOM activated'));
r.post('/boms/:id/obsolete', requirePermission('production:manage'), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await planning.obsoleteBom(id(res)), 'BOM made obsolete'));
r.post('/boms/:id/new-version', requirePermission('production:manage'), validate(idParam, 'params'), async (req, res) => sendSuccess(res, await planning.newBomVersion(req.user!, id(res)), 'New draft version created', 201));

/* Production plans */
r.get('/production-plans', requirePermission(...READ), validate(listPlansQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await planning.listPlans(q);
  sendSuccess(res, items, 'Production plans retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/production-plans', requirePermission('production:manage'), validate(planBody), async (req, res) => sendSuccess(res, await planning.createPlan(req.user!, validated(res, 'body')), 'Production plan created', 201));
r.get('/production-plans/:id', requirePermission(...READ), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await planning.getPlan(id(res))));
r.put('/production-plans/:id', requirePermission('production:manage'), validate(idParam, 'params'), validate(planBody), async (_req, res) => sendSuccess(res, await planning.updatePlan(id(res), validated(res, 'body')), 'Production plan updated'));
r.post('/production-plans/:id/status', requirePermission('production:manage'), validate(idParam, 'params'), validate(planStatusBody), async (_req, res) => sendSuccess(res, await planning.setPlanStatus(id(res), validated<any>(res, 'body').status), 'Status updated'));

/* Reservations */
r.get('/reservations', requirePermission('inventory:view'), validate(listReservationsQuery, 'query'), async (_req, res) => sendSuccess(res, await planning.listReservations(validated(res, 'query'))));
r.post('/reservations', requirePermission('inventory:manage'), validate(reservationBody), async (req, res) => sendSuccess(res, await planning.createReservation(req.user!, validated(res, 'body')), 'Stock reserved', 201));
r.post('/reservations/:id/release', requirePermission('inventory:manage'), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await planning.releaseReservation(id(res)), 'Reservation released'));

/* MRP */
r.post('/mrp/run', requirePermission('mrp:run'), validate(mrpRunBody), async (req, res) => {
  const body = validated<any>(res, 'body');
  const run: any = await mrp.runMrp(req.user!, body);
  await audit(req.user!, { action: 'mrp.run', entityType: 'MRPRun', entityId: String(run.id), entityNumber: run.number, summary: `Ran MRP for ${body.planIds.length} plan(s) over ${body.horizonDays} days`, after: { planIds: body.planIds, horizonDays: body.horizonDays, summary: run.summary } });
  sendSuccess(res, run, 'MRP run completed', 201);
});
r.get('/mrp/runs', requirePermission('mrp:view'), validate(listRunsQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await mrp.listRuns(q);
  sendSuccess(res, items, 'MRP runs retrieved', 200, paginate(q.page, q.limit, total));
});
r.get('/mrp/runs/:id', requirePermission('mrp:view'), validate(idParam, 'params'), async (_req, res) => sendSuccess(res, await mrp.getRun(id(res))));
r.get('/mrp/reorder-recommendations', requirePermission('mrp:view'), validate(reorderQuery, 'query'), async (_req, res) => sendSuccess(res, await mrp.reorderRecommendations(validated<any>(res, 'query').onlyNeeded)));
r.get('/settings/mrp', requirePermission('mrp:view'), async (_req, res) => sendSuccess(res, await mrp.getMrpSettings()));
r.put('/settings/mrp', requirePermission('mrp:run'), validate(mrpSettingsBody), async (_req, res) => sendSuccess(res, await mrp.setMrpSettings(validated(res, 'body')), 'MRP settings saved'));

export default r;
