import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isEnforcedForMechanic } from '../middleware/subscription.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
router.use(requireAuth);

// Deliberately NOT behind requireActiveSubscription -- an account with no
// active subscription is exactly the case that needs to read its own
// status, to know what to show (subscribe vs. reactivate vs. all good).
router.get('/', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { mechanicId: req.mechanicId } });
    // Tells the frontend whether THIS account is actually subject to the
    // paywall right now (global switch, or this one email on the test
    // allowlist) -- so Register.jsx only sends the account to checkout
    // when that's actually going to matter, not for every signup while
    // billing is still dark-launched.
    const paymentRequired = await isEnforcedForMechanic(req.mechanicId);
    res.json({
      status: subscription?.status || 'none',
      payment_required: paymentRequired,
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
