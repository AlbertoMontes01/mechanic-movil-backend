import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createCheckout } from '../lib/lemonSqueezy.js';

const router = Router();
router.use(requireAuth);

// Deliberately NOT behind requireActiveSubscription -- this is how an
// account without one gets a checkout URL in the first place (first
// subscription, or resubscribing after a cancellation/expiration).
router.post('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.mechanicId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const url = await createCheckout({ email: user.email, mechanicId: user.id });
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

export default router;
