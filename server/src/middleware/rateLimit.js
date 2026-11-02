// Rate limiting stops one client from hammering the API: password guessing on
// /login, spam reports, or simple denial-of-service. Limits are per IP address,
// or per user account once logged in. Counters are kept in memory, which is fine
// for a single server instance.
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

export const DEFAULT_LIMITS = Object.freeze({
  global: { windowMs: 15 * 60 * 1000, limit: 600 }, // all /api requests per IP
  auth: { windowMs: 15 * 60 * 1000, limit: 20 }, // login/register attempts per IP
  createComplaint: { windowMs: 60 * 60 * 1000, limit: 10 }, // new reports per user per hour
});

const handler = (_req, res, _next, options) =>
  res.status(options.statusCode).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a few minutes and try again.' },
  });

export function makeLimiters(limits = DEFAULT_LIMITS) {
  const base = { standardHeaders: 'draft-8', legacyHeaders: false, handler };
  return {
    global: rateLimit({ ...base, ...limits.global }),
    auth: rateLimit({ ...base, ...limits.auth }),
    createComplaint: rateLimit({
      ...base,
      ...limits.createComplaint,
      keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    }),
  };
}
