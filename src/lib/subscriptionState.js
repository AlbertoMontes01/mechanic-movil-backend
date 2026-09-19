// Single place that decides what a stored Subscription row means, shared by
// the paywall middleware, POST /api/checkout and the webhook handler so
// they can't drift apart.
//
// Lemon Squeezy statuses: on_trial, active, paused, past_due, unpaid,
// cancelled, expired. "cancelled" is NOT "no access": it means cancelled
// but still paid up until ends_at.

// Can this account use the app right now?
export function hasAccess(sub, now = new Date()) {
  if (!sub) return false;
  if (sub.manualOverride) return true;
  if (sub.status === 'active') return true;
  if (sub.status === 'on_trial') return !(sub.trialEndsAt && sub.trialEndsAt < now);
  if (sub.status === 'cancelled') return Boolean(sub.endsAt && sub.endsAt > now);
  return false;
}

// Is there a Lemon Squeezy subscription that could still bill (or resume)?
// Broader than hasAccess: past_due / unpaid / paused are locked out of the
// app but their subscription is very much alive on LS's side, so a second
// checkout or a stray event from another subscription must not replace it.
export function isLiveSubscription(sub, now = new Date()) {
  if (!sub || !sub.lemonsqueezySubscriptionId) return false;
  if (['on_trial', 'active', 'past_due', 'unpaid', 'paused'].includes(sub.status)) return true;
  if (sub.status === 'cancelled') return Boolean(sub.endsAt && sub.endsAt > now);
  return false;
}
