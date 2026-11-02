// Authentication = "who are you?"; authorization = "are you allowed to do this?".
//
// On login the server signs a JWT containing only the user's id and puts it in an
// httpOnly cookie. httpOnly means page JavaScript cannot read it, so an XSS bug
// can't steal the session. On each request `loadUser` verifies the signature and
// loads the user from the database — the role is read from the DB, not trusted
// from the token, so changing someone's role takes effect immediately.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export const COOKIE_NAME = 'cf_token';

export const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd, // HTTPS-only in production
  sameSite: 'lax', // not sent on cross-site POSTs, which blocks CSRF form attacks
  path: '/',
  maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
});

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
    algorithm: 'HS256',
  });
}

/** Attach req.user if a valid session cookie is present. Never rejects. */
export async function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const { rows } = await query(
      'SELECT id, name, email, role, phone, created_at FROM users WHERE id = $1',
      [Number(payload.sub)]
    );
    if (rows[0]) req.user = rows[0];
  } catch {
    // Expired or tampered token: treat as logged out.
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const requireAdmin = requireRole('admin');
