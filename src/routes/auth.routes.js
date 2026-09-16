import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

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

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
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
      data: { email, passwordHash, name },
    });

    res.status(201).json({ user: toPublicUser(user), token: issueToken(user) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid email or password', details: err.issues });
    }
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.pick({ email: true, password: true }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ user: toPublicUser(user), token: issueToken(user) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
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

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// No transactional email provider is chosen yet, so this logs the reset
// link to the server console instead of sending an email — functionally
// complete for local dev/testing, clearly not production-ready.
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
          resetTokenHash: hashResetToken(token),
          resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const resetUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
      // eslint-disable-next-line no-console
      console.log(`\n[password reset] ${email} -> ${resetUrl}\n`);
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
      .object({ resetToken: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        resetTokenHash: hashResetToken(resetToken),
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
    });

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid request' });
    next(err);
  }
});

export default router;
