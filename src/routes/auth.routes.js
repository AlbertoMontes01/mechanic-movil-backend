import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { stripHtml } from '../lib/sanitize.js';

const router = Router();

// Brute-force / credential-stuffing guard on the auth endpoints — keyed by
// IP (trust proxy is set in server.js so this sees the real client IP
// behind a reverse proxy). Generic message so it doesn't itself leak
// whether the rate limit is about to trigger for a specific account.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// At least 8 characters with a letter and a number — a floor, not a full
// strength meter. Register and reset-password both use this.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const credentialsSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().optional(),
});

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

function issueAccessToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Refresh tokens are opaque random values, not JWTs — only their sha256
// hash is ever stored, the same pattern as the password-reset token, so a
// single row can be looked up, rotated on every use, and revoked
// individually (logout) without invalidating a user's other sessions.
async function issueRefreshToken(userId) {
  const token = randomBytes(32).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

async function issueTokenPair(res, user) {
  const refreshToken = await issueRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTS);
  return issueAccessToken(user);
}

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = credentialsSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: stripHtml(name) },
    });

    const token = await issueTokenPair(res, user);
    res.status(201).json({ user: toPublicUser(user), token });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid email or password', details: err.issues });
    }
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = await issueTokenPair(res, user);
    res.json({ user: toPublicUser(user), token });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    next(err);
  }
});

// Exchanges the httpOnly refresh cookie for a new short-lived access token,
// rotating the refresh token itself on every use (old one deleted, new one
// issued) so a stolen refresh cookie has a one-time replay window, not a
// standing 30-day one.
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: 'Not authenticated' });

    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!existing || existing.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }

    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }

    await prisma.refreshToken.delete({ where: { id: existing.id } });
    const token = await issueTokenPair(res, user);
    res.json({ user: toPublicUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (raw) {
      await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.mechanicId } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.mechanicId },
      data: { name: stripHtml(name) },
    });
    res.json(toPublicUser(user));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid name' });
    next(err);
  }
});

// No transactional email provider is chosen yet. In dev, the reset link is
// logged to the server console so the flow can be exercised end to end; in
// production that log is suppressed (it's a sensitive token) which means
// forgot-password currently has no way to actually reach the user there —
// this is a known gap until a real email provider is wired up.
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond the same way whether or not the account exists, so
    // this endpoint can't be used to enumerate registered emails.
    if (user) {
      const token = randomBytes(32).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetTokenHash: hashToken(token),
          resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      if (process.env.NODE_ENV !== 'production') {
        const resetUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
        // eslint-disable-next-line no-console
        console.log(`\n[password reset — dev only] ${email} -> ${resetUrl}\n`);
      }
      // TODO: send resetUrl via a real email provider once one is chosen —
      // nothing delivers this token to the user outside of dev right now.
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid email' });
    next(err);
  }
});

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { resetToken, newPassword } = z
      .object({ resetToken: z.string().min(1), newPassword: passwordSchema })
      .parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        resetTokenHash: hashToken(resetToken),
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
      }),
      // A password reset ends every existing session, not just the one
      // that requested it — otherwise a stolen still-valid refresh token
      // would survive the password change.
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid request' });
    next(err);
  }
});

export default router;
