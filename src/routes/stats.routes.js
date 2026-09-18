import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Public, aggregate counts only -- for the landing page's "N mechanics / N
// vehicles tracked" line. No auth, no PII.
router.get('/public', async (req, res, next) => {
  try {
    const [mechanics, vehicles] = await Promise.all([prisma.user.count(), prisma.vehicle.count()]);
    res.json({ mechanics, vehicles });
  } catch (err) {
    next(err);
  }
});

export default router;
