import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isEnforcedForMechanic } from '../middleware/subscription.js';
import { prisma } from '../lib/prisma.js';
import { getSubscriptionUrls, cancelSubscription, resumeSubscription, subscriptionFieldsFromLS } from '../lib/lemonSqueezy.js';
import { isLiveSubscription } from '../lib/subscriptionState.js';

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

// Signed link to Lemon Squeezy's customer portal, where the user updates
// their card, sees invoices and cancels. Also outside the paywall on
// purpose: a past_due user who is locked out needs it to fix their card.
router.get('/portal', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { mechanicId: req.mechanicId } });
    if (!subscription?.lemonsqueezySubscriptionId) {
      return res.status(404).json({ error: 'no_subscription' });
    }
    const { customerPortal } = await getSubscriptionUrls(subscription.lemonsqueezySubscriptionId);
    if (!customerPortal) return res.status(502).json({ error: 'portal_unavailable' });
    res.json({ url: customerPortal });
  } catch (err) {
    next(err);
  }
});

// In-app cancel / resume. Works on the tracked subscription only. The row
// is updated straight from LS's response so the UI is right immediately;
// the webhooks that follow carry the same state, and since the handler
// overwrites with the full payload they're harmless repeats.
async function changeSubscription(req, res, next, { allowed, action }) {
  try {
    const sub = await prisma.subscription.findUnique({ where: { mechanicId: req.mechanicId } });
    if (!sub?.lemonsqueezySubscriptionId) return res.status(404).json({ error: 'no_subscription' });
    if (!allowed(sub)) return res.status(409).json({ error: 'invalid_state', status: sub.status });

    let data;
    try {
      data = await action(sub);
    } catch (err) {
      // LS refused or was unreachable: log the detail, tell the user something usable.
      console.error(err);
      return res.status(502).json({ error: 'We could not update your subscription with our payment provider. Please try again in a moment or contact support.' });
    }
    const fields = subscriptionFieldsFromLS(data);
    await prisma.subscription.update({ where: { mechanicId: req.mechanicId }, data: fields });
    res.json({
      status: fields.status,
      trial_ends_at: fields.trialEndsAt,
      renews_at: fields.renewsAt,
      ends_at: fields.endsAt,
    });
  } catch (err) {
    next(err);
  }
}

router.post('/cancel', (req, res, next) =>
  changeSubscription(req, res, next, {
    allowed: (sub) => isLiveSubscription(sub) && sub.status !== 'cancelled',
    action: (sub) => cancelSubscription(sub.lemonsqueezySubscriptionId),
  })
);

router.post('/resume', (req, res, next) =>
  changeSubscription(req, res, next, {
    allowed: (sub) => sub.status === 'cancelled' && sub.endsAt && sub.endsAt > new Date(),
    action: (sub) =>
      resumeSubscription(sub.lemonsqueezySubscriptionId, {
        trialElapsed: Boolean(sub.trialEndsAt && sub.trialEndsAt < new Date()),
      }),
  })
);

export default router;
