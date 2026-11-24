import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { sendSuccess } from '../utils/apiResponse';
import { idParam, linkSupplierBody, listMaterialsQuery, listSuppliersQuery, materialBody, materialUpdateBody, supplierBody, supplierSelfBody, supplierUpdateBody } from '../validators/schemas';
import * as catalog from '../services/catalogService';
import * as suppliers from '../services/supplierService';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/materials', '/material-categories', '/suppliers'], ...protectedChain);

/* Materials */
r.get('/material-categories', requirePermission('materials:view', 'materials:manage'), async (_req, res) => {
  sendSuccess(res, await catalog.listCategories());
});
r.get('/materials', requirePermission('materials:view', 'materials:manage'), validate(listMaterialsQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await catalog.listMaterials(q);
  sendSuccess(res, items, 'Materials retrieved', 200, paginate(q.page, q.limit, total));
});
r.get('/materials/:id', requirePermission('materials:view', 'materials:manage'), validate(idParam, 'params'), async (_req, res) => {
  sendSuccess(res, await catalog.getMaterial(validated<any>(res, 'params').id));
});
r.post('/materials', requirePermission('materials:manage'), validate(materialBody), async (_req, res) => {
  sendSuccess(res, await catalog.createMaterial(validated(res, 'body')), 'Material created', 201);
});
r.patch('/materials/:id', requirePermission('materials:manage'), validate(idParam, 'params'), validate(materialUpdateBody), async (_req, res) => {
  sendSuccess(res, await catalog.updateMaterial(validated<any>(res, 'params').id, validated(res, 'body')), 'Material updated');
});

/* Suppliers. "/suppliers/me" must be registered before "/suppliers/:id". */
r.get('/suppliers/me', requirePermission('suppliers:self'), async (req, res) => {
  const id = req.user!.supplierId;
  if (!id) return sendSuccess(res, null, 'Your account is not linked to a supplier record');
  sendSuccess(res, await suppliers.getSupplier(req.user!, id));
});
r.patch('/suppliers/me', requirePermission('suppliers:self'), validate(supplierSelfBody), async (req, res) => {
  sendSuccess(res, await suppliers.updateOwnProfile(req.user!, validated(res, 'body')), 'Profile updated');
});
r.get('/suppliers', requirePermission('suppliers:view'), validate(listSuppliersQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await suppliers.listSuppliers(req.user!, q);
  sendSuccess(res, items, 'Suppliers retrieved', 200, paginate(q.page, q.limit, total));
});
r.get('/suppliers/:id', requirePermission('suppliers:view', 'suppliers:self'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await suppliers.getSupplier(req.user!, validated<any>(res, 'params').id));
});
r.post('/suppliers', requirePermission('suppliers:manage'), validate(supplierBody), async (_req, res) => {
  sendSuccess(res, await suppliers.createSupplier(validated(res, 'body')), 'Supplier created', 201);
});
r.patch('/suppliers/:id', requirePermission('suppliers:manage'), validate(idParam, 'params'), validate(supplierUpdateBody), async (_req, res) => {
  sendSuccess(res, await suppliers.updateSupplier(validated<any>(res, 'params').id, validated(res, 'body')), 'Supplier updated');
});

export default r;
