import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createCheckout } from '../lib/lemonSqueezy.js';
import { hasAccess, isLiveSubscription } from '../lib/subscriptionState.js';

const router = Router();
router.use(requireAuth);

// Deliberately NOT behind requireActiveSubscription -- this is how an
// account without one gets a checkout URL in the first place (first
// subscription, or resubscribing after a cancellation/expiration).
router.post('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.mechanicId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    // A second checkout would create a second, independent LS subscription
    // that keeps billing while this app only tracks one of them.
    const existing = await prisma.subscription.findUnique({ where: { mechanicId: user.id } });
    if (hasAccess(existing) || isLiveSubscription(existing)) {
      return res.status(409).json({ error: 'already_subscribed', status: existing.status });
    }

    const url = await createCheckout({ email: user.email, mechanicId: user.id });
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

export default router;
