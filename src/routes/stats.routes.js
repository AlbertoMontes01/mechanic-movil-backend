import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// @example.com is the domain reserved by RFC 2606 specifically for
// documentation/testing -- every throwaway account created while testing
// this app (registration flow, checkout, deploy smoke tests) uses it, and
// no real mechanic ever will. Filtering it out here means test accounts
// never have to be remembered and deleted by hand to keep this count
// honest -- new ones just don't count, automatically.
const isTestAccount = { email: { endsWith: '@example.com' } };

// Public, aggregate counts only -- for the landing page's "N mechanics / N
// vehicles tracked" line. No auth, no PII.
router.get('/public', async (req, res, next) => {
  try {
    const [mechanics, vehicles] = await Promise.all([
      prisma.user.count({ where: { NOT: isTestAccount } }),
      prisma.vehicle.count({ where: { client: { mechanic: { NOT: isTestAccount } } } }),
    ]);
    res.json({ mechanics, vehicles });
  } catch (err) {
    next(err);
  }
});

export default router;
