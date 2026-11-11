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
import { storage } from './services/imageStorage.js';
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
          imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://res.cloudinary.com'],
          styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet sets inline styles on map elements
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // helmet's default ("no-referrer") makes OpenStreetMap refuse map tiles, because its
      // tile policy requires a Referer. This sends only our origin (never the page path) to other sites.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
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

  // Photos kept in PostgreSQL. Keys are random UUIDs checked against a strict
  // pattern, so nothing else in the database (or on disk) can be requested.
  if (config.storageDriver === 'database') {
    app.get('/uploads/:key', async (req, res, next) => {
      try {
        const data = await storage.read(req.params.key);
        if (!data) return res.status(404).type('text').send('Not found');
        res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=604800, immutable' });
        res.send(data);
      } catch (err) {
        next(err);
      }
    });
    app.use('/uploads', (_req, res) => res.status(404).type('text').send('Not found'));
  }

  // Locally stored photos. Names are random UUIDs; files are re-encoded WebP only.
  if (config.storageDriver === 'local') {
    app.use(
      '/uploads',
      express.static(config.uploadDir, {
        index: false,
        dotfiles: 'deny',
        maxAge: '7d',
        fallthrough: false, // a missing photo is a 404, not the React app
        setHeaders: (res) => res.setHeader('Content-Type', 'image/webp'),
      })
    );
  }

  // In production the same server hosts the built React app (one origin -> simple cookies).
  if (existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false }));
    // Page URLs (no file extension, e.g. /issues/42) get the React app; React Router
    // shows the right page. Anything that looks like a file (/.env, /x.php) is a plain 404.
    app.get(/^\/(?!api\/|uploads\/)[^.]*$/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
    app.use((_req, res) => res.status(404).type('text').send('Not found'));
  }

  app.use(errorHandler);
  return app;
}
