// Builds the Express application. Kept separate from index.js (which starts the
// server) so tests can create an app in memory and call it with Supertest.
//
// Request pipeline, in order:
//   helmet (security headers) -> CORS -> body/cookie parsing -> rate limit
//   -> loadUser (reads session cookie) -> route -> validation -> handler
//   -> errorHandler (one JSON error format for everything)
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { loadUser } from './middleware/auth.js';
import { DEFAULT_LIMITS, makeLimiters } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { complaintsRouter } from './routes/complaints.js';
import { categoriesRouter } from './routes/categories.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from './routes/admin.js';

export function createApp({ rateLimits = DEFAULT_LIMITS } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Leaflet map tiles come from OpenStreetMap; photos may come from Cloudinary.
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://res.cloudinary.com'],
          styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet sets inline styles on map elements
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );
  // Only needed when the React dev server runs on a different origin.
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  const limiters = makeLimiters(rateLimits);
  app.use('/api', limiters.global);
  app.use('/api', loadUser);

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, database: 'connected' });
    } catch {
      res.status(503).json({ ok: false, database: 'unavailable' });
    }
  });

  app.use('/api/auth', authRouter(limiters));
  app.use('/api/complaints', complaintsRouter(limiters));
  app.use('/api/categories', categoriesRouter());
  app.use('/api/me', meRouter());
  app.use('/api/admin', adminRouter());
  app.use('/api', notFoundHandler);

  // Locally stored photos. Names are random UUIDs; files are re-encoded WebP only.
  if (config.storageDriver === 'local') {
    app.use(
      '/uploads',
      express.static(config.uploadDir, {
        index: false,
        dotfiles: 'deny',
        maxAge: '7d',
        setHeaders: (res) => res.setHeader('Content-Type', 'image/webp'),
      })
    );
  }

  // In production the same server hosts the built React app (one origin -> simple cookies).
  if (existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
