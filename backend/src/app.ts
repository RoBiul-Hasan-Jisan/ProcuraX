import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOptions } from './config/cors';
import { databaseState } from './config/database';
import { isTest } from './config/environment';
import { apiLimiter } from './middlewares/rateLimiter';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { requestId, sanitizeRequest } from './middlewares/requestContext';
import routes from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions));
  if (!isTest) app.use(morgan('tiny'));
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeRequest);

  app.get('/health', (_req, res) => {
    const db = databaseState();
    res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', database: db });
  });

  app.use('/api/v1', apiLimiter, routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
