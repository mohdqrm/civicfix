// /api/auth — register, log in, log out, "who am I?".
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { COOKIE_NAME, cookieOptions, requireAuth, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validation/schemas.js';
import { asyncHandler, conflict, unauthorized } from '../utils/errors.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist, so a wrong email takes as long
// as a wrong password and attackers can't tell which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', BCRYPT_ROUNDS);

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone ?? null,
  createdAt: u.created_at,
});

export function authRouter(limiters) {
  const router = Router();

  router.post(
    '/register',
    limiters.auth,
    validate({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      const { name, email, password, phone } = req.valid.body;
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      let user;
      try {
        // role is never taken from the request: everyone who registers is a citizen.
        const { rows } = await query(
          `INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1, $2, $3, 'citizen', $4)
           RETURNING id, name, email, role, phone, created_at`,
          [name, email, hash, phone ?? null]
        );
        user = rows[0];
      } catch (err) {
        if (err.code === '23505') throw conflict('An account with this email already exists');
        throw err;
      }
      res.cookie(COOKIE_NAME, signToken(user.id), cookieOptions());
      res.status(201).json({ user: publicUser(user) });
    })
  );

  router.post(
    '/login',
    limiters.auth,
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const { email, password } = req.valid.body;
      const { rows } = await query(
        'SELECT id, name, email, role, phone, created_at, password_hash FROM users WHERE LOWER(email) = $1',
        [email]
      );
      const user = rows[0];
      const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) throw unauthorized('Incorrect email or password');
      res.cookie(COOKIE_NAME, signToken(user.id), cookieOptions());
      res.json({ user: publicUser(user) });
    })
  );

  router.post('/logout', (_req, res) => {
    const { maxAge, ...opts } = cookieOptions();
    res.clearCookie(COOKIE_NAME, opts);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  // Same as /me but answers 200 { user: null } when logged out. The frontend calls
  // this on every page load, so logged-out visitors don't produce 401s in the console.
  router.get('/session', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  return router;
}
