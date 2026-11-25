import { Router, type NextFunction, type Request, type Response } from 'express';
import multer, { MulterError } from 'multer';
import { AppError, notFound, sendSuccess } from '../utils/apiResponse';
import { validate } from '../middlewares/validation';
import { documentListQuery, documentUploadFields, idParam } from '../validators/schemas';
import { deleteDocument, listDocuments, maxUploadBytes, openDocument, uploadDocument } from '../services/documentService';
import { protectedChain, validated } from './common';

const r = Router();
r.use('/documents', ...protectedChain);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes(), files: 1, fields: 5, fieldSize: 2000 } });
/** Turns multer's own errors into the API's normal error shape. */
const oneFile = (req: Request, res: Response, next: NextFunction) => upload.single('file')(req, res, (err: unknown) => {
  if (!err) return next();
  if (err instanceof MulterError) return next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than the upload limit' : 'The upload was not understood', 'UPLOAD_REJECTED'));
  next(err);
});

// Access is decided per record inside the service (documents inherit the permissions of the record they belong to).
r.get('/documents', validate(documentListQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  sendSuccess(res, await listDocuments(req.user!, q.entityType, q.entityId));
});
r.post('/documents', oneFile, validate(documentUploadFields), async (req, res) => {
  const body = validated<any>(res, 'body');
  const f = req.file;
  sendSuccess(res, await uploadDocument(req.user!, body, f ? { originalName: f.originalname, size: f.size, buffer: f.buffer } : undefined), 'Document uploaded', 201);
});
r.get('/documents/:id/download', validate(idParam, 'params'), async (req, res) => {
  const d = await openDocument(req.user!, validated<any>(res, 'params').id);
  res.setHeader('Content-Type', d.mimeType);
  res.setHeader('Content-Length', String(d.size));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  d.stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  d.stream.pipe(res);
});
r.delete('/documents/:id', validate(idParam, 'params'), async (req, res) => {
  await deleteDocument(req.user!, validated<any>(res, 'params').id);
  sendSuccess(res, { deleted: true }, 'Document deleted');
});
r.use('/documents', (_req, _res, next) => next(notFound()));

export default r;
