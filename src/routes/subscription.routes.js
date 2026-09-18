import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
router.use(requireAuth);

// Deliberately NOT behind requireActiveSubscription -- an account with no
// active subscription is exactly the case that needs to read its own
// status, to know what to show (subscribe vs. reactivate vs. all good).
router.get('/', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { mechanicId: req.mechanicId } });
    res.json({
      status: subscription?.status || 'none',
      trial_ends_at: subscription?.trialEndsAt || null,
      renews_at: subscription?.renewsAt || null,
      ends_at: subscription?.endsAt || null,
      card_brand: subscription?.cardBrand || null,
      card_last_four: subscription?.cardLastFour || null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
