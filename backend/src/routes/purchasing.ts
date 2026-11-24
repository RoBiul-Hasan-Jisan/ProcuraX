import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { sendSuccess } from '../utils/apiResponse';
import {
  adjustmentBody, createPoBody, idParam, invoiceBody, invoiceDecisionBody, issueBody, listInvoicesQuery, listPoQuery, listReceiptsQuery,
  movementsQuery, reasonBody, receiptBody, stockQuery, transferBody, warehouseBody, warehouseUpdateBody,
} from '../validators/schemas';
import * as po from '../services/poService';
import * as receipts from '../services/receiptService';
import * as invoices from '../services/invoiceService';
import * as inventory from '../services/inventoryService';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/purchase-orders', '/goods-receipts', '/invoices', '/warehouses', '/stock', '/stock-movements'], ...protectedChain);
const id = (res: any) => validated<any>(res, 'params').id as string;

/* Purchase orders: suppliers see only their own (service-level scope), managers see all */
r.get('/purchase-orders', requirePermission('purchase_orders:view', 'purchase_orders:view_assigned'), validate(listPoQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await po.listPurchaseOrders(req.user!, q);
  sendSuccess(res, items, 'Purchase orders retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/purchase-orders', requirePermission('purchase_orders:manage'), validate(createPoBody), async (req, res) => {
  sendSuccess(res, await po.createFromRfq(req.user!, validated<any>(res, 'body').rfqId), 'Draft purchase order created', 201);
});
r.get('/purchase-orders/:id', requirePermission('purchase_orders:view', 'purchase_orders:view_assigned'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await po.getPurchaseOrder(req.user!, id(res)));
});
r.post('/purchase-orders/:id/issue', requirePermission('purchase_orders:manage'), validate(idParam, 'params'), async (req, res) => {
  sendSuccess(res, await po.issuePurchaseOrder(req.user!, id(res)), 'Purchase order issued');
});
r.post('/purchase-orders/:id/cancel', requirePermission('purchase_orders:manage'), validate(idParam, 'params'), validate(reasonBody), async (req, res) => {
  sendSuccess(res, await po.cancelPurchaseOrder(req.user!, id(res), validated<any>(res, 'body').reason), 'Purchase order cancelled');
});
r.post('/purchase-orders/:id/close', requirePermission('purchase_orders:manage'), validate(idParam, 'params'), validate(reasonBody), async (req, res) => {
  sendSuccess(res, await po.closePurchaseOrder(req.user!, id(res), validated<any>(res, 'body').reason), 'Purchase order short-closed');
});

/* Goods receipts (suppliers have neither permission) */
r.get('/goods-receipts', requirePermission('goods_receipts:manage', 'purchase_orders:view'), validate(listReceiptsQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await receipts.listReceipts(q);
  sendSuccess(res, items, 'Goods receipts retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/goods-receipts', requirePermission('goods_receipts:manage'), validate(receiptBody), async (req, res) => {
  sendSuccess(res, await receipts.createReceipt(req.user!, validated(res, 'body')), 'Goods receipt recorded', 201);
});
r.get('/goods-receipts/:id', requirePermission('goods_receipts:manage', 'purchase_orders:view'), validate(idParam, 'params'), async (_req, res) => {
  sendSuccess(res, await receipts.getReceipt(id(res)));
});

/* Invoices */
r.get('/invoices', requirePermission('invoices:verify'), validate(listInvoicesQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await invoices.listInvoices(q);
  sendSuccess(res, items, 'Invoices retrieved', 200, paginate(q.page, q.limit, total));
});
r.post('/invoices', requirePermission('invoices:verify'), validate(invoiceBody), async (req, res) => {
  sendSuccess(res, await invoices.recordInvoice(req.user!, validated(res, 'body')), 'Invoice recorded', 201);
});
r.get('/invoices/:id', requirePermission('invoices:verify'), validate(idParam, 'params'), async (_req, res) => {
  sendSuccess(res, await invoices.getInvoice(id(res)));
});
r.post('/invoices/:id/decision', requirePermission('invoices:verify'), validate(idParam, 'params'), validate(invoiceDecisionBody), async (req, res) => {
  const b = validated<any>(res, 'body');
  sendSuccess(res, await invoices.decideInvoice(req.user!, id(res), b.action, b.comment), 'Invoice decision recorded');
});

/* Warehouses */
r.get('/warehouses', requirePermission('inventory:view', 'warehouses:manage', 'goods_receipts:manage'), async (_req, res) => {
  sendSuccess(res, await inventory.listWarehouses(_req.user!.permissions.includes('warehouses:manage')));
});
r.post('/warehouses', requirePermission('warehouses:manage'), validate(warehouseBody), async (_req, res) => {
  sendSuccess(res, await inventory.createWarehouse(validated(res, 'body')), 'Warehouse created', 201);
});
r.patch('/warehouses/:id', requirePermission('warehouses:manage'), validate(idParam, 'params'), validate(warehouseUpdateBody), async (_req, res) => {
  sendSuccess(res, await inventory.updateWarehouse(id(res), validated(res, 'body')), 'Warehouse updated');
});

/* Stock */
r.get('/stock', requirePermission('inventory:view'), validate(stockQuery, 'query'), async (_req, res) => {
  sendSuccess(res, await inventory.stockOverview(validated(res, 'query')), 'Stock retrieved');
});
r.get('/stock/alerts', requirePermission('inventory:view'), async (_req, res) => {
  sendSuccess(res, await inventory.reorderAlerts(), 'Reorder alerts retrieved');
});
r.post('/stock/adjustments', requirePermission('inventory:manage'), validate(adjustmentBody), async (req, res) => {
  sendSuccess(res, await inventory.adjustStock(req.user!, validated(res, 'body')), 'Adjustment recorded', 201);
});
r.post('/stock/issues', requirePermission('inventory:manage'), validate(issueBody), async (req, res) => {
  sendSuccess(res, await inventory.issueStock(req.user!, validated(res, 'body')), 'Stock issued', 201);
});
r.post('/stock/transfers', requirePermission('inventory:manage'), validate(transferBody), async (req, res) => {
  sendSuccess(res, await inventory.transferStock(req.user!, validated(res, 'body')), 'Transfer recorded', 201);
});
r.get('/stock-movements', requirePermission('inventory:view'), validate(movementsQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await inventory.listMovements(q);
  sendSuccess(res, items, 'Movements retrieved', 200, paginate(q.page, q.limit, total));
});

export default r;
