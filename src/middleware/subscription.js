import { prisma } from '../lib/prisma.js';

// Lemon Squeezy statuses that mean "this account can use the app". Anything
// else -- past_due, unpaid, cancelled, expired, paused, or our own
// pending_checkout before the first webhook ever lands -- falls through to
// the 402 below.
const ACTIVE_STATUSES = new Set(['on_trial', 'active']);

// Global kill switch, off by default: lets the billing routes and webhook go
// live in production and be tested for real (real checkout, real webhook
// delivery) without blocking a single existing or newly-registered account
// until this is deliberately flipped to "true" -- a dark launch, not a
// feature branch.
const ENFORCED_GLOBALLY = process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED === 'true';

// Narrower override for testing the real paywall end-to-end in production
// against one specific account, while the global switch stays off for
// everyone else -- e.g. SUBSCRIPTION_ENFORCEMENT_TEST_EMAILS="you@example.com".
const TEST_EMAILS = (process.env.SUBSCRIPTION_ENFORCEMENT_TEST_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Shared by the middleware below and GET /api/subscription (which needs to
// tell the frontend whether to send a freshly-registered user to checkout
// at all, without duplicating this decision).
export async function isEnforcedForMechanic(mechanicId) {
  if (ENFORCED_GLOBALLY) return true;
  if (TEST_EMAILS.length === 0) return false;

  const user = await prisma.user.findUnique({ where: { id: mechanicId }, select: { email: true } });
  return Boolean(user && TEST_EMAILS.includes(user.email.toLowerCase()));
}

// Must run after requireAuth (needs req.mechanicId). A 402 with this
// specific error code lets the frontend show "reactivate your account"
// instead of treating it like an auth failure or a generic 500.
export async function requireActiveSubscription(req, res, next) {
  try {
    if (!(await isEnforcedForMechanic(req.mechanicId))) return next();

    const subscription = await prisma.subscription.findUnique({ where: { mechanicId: req.mechanicId } });

    if (subscription?.manualOverride) return next();

    // on_trial only counts while the trial hasn't actually elapsed --
    // covers the gap between the trial ending and Lemon Squeezy's own
    // subscription_updated -> past_due webhook arriving to update this row.
    const trialExpired =
      subscription?.status === 'on_trial' && subscription.trialEndsAt && subscription.trialEndsAt < new Date();

    if (subscription && !trialExpired && ACTIVE_STATUSES.has(subscription.status)) {
      return next();
    }

    return res.status(402).json({ error: 'subscription_required', status: subscription?.status || 'none' });
  } catch (err) {
    next(err);
  }
}
