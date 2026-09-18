import { Router } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { isValidWebhookSignature } from '../lib/lemonSqueezy.js';

const router = Router();

// Every event that carries a current subscription state in data.attributes.
// Lemon Squeezy sends the *full* current object on each one, so the handler
// always overwrites our row with what's in the payload rather than trying
// to apply a delta -- that's what makes it safe to process out of order or
// twice.
const SUBSCRIPTION_STATE_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
]);

router.post('/lemonsqueezy', async (req, res, next) => {
  try {
    const signature = req.headers['x-signature'];
    if (!isValidWebhookSignature(req.rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Lemon Squeezy doesn't hand back a stable event id -- hash the exact
    // raw body instead. A retried delivery resends byte-identical bytes, so
    // this hash is what makes re-processing the same event a no-op.
    const eventId = createHash('sha256').update(req.rawBody).digest('hex');
    const eventName = req.body?.meta?.event_name;
    const mechanicId = req.body?.meta?.custom_data?.mechanic_id || null;

    const existing = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const event = await prisma.webhookEvent.create({
      data: { eventId, eventName: eventName || 'unknown', payload: req.body, mechanicId },
    });

    try {
      await applyEvent(eventName, req.body, mechanicId);
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    } catch (err) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingError: err.message } });
      throw err;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function applyEvent(eventName, payload, mechanicId) {
  if (!SUBSCRIPTION_STATE_EVENTS.has(eventName)) {
    // subscription_payment_failed and anything else Lemon Squeezy adds
    // later: still recorded in WebhookEvent above for visibility, just no
    // state change here. LS moves the subscription to past_due itself and
    // that arrives as its own subscription_updated right alongside it.
    return;
  }

  if (!mechanicId) {
    throw new Error(`${eventName} arrived with no mechanic_id in custom_data -- cannot link to a user`);
  }

  const attrs = payload?.data?.attributes || {};
  const lemonsqueezySubscriptionId = payload?.data?.id ? String(payload.data.id) : null;

  const fields = {
    status: attrs.status,
    lemonsqueezySubscriptionId,
    lemonsqueezyCustomerId: attrs.customer_id != null ? String(attrs.customer_id) : null,
    trialEndsAt: attrs.trial_ends_at ? new Date(attrs.trial_ends_at) : null,
    renewsAt: attrs.renews_at ? new Date(attrs.renews_at) : null,
    endsAt: attrs.ends_at ? new Date(attrs.ends_at) : null,
    cardBrand: attrs.card_brand || null,
    cardLastFour: attrs.card_last_four || null,
  };

  // upsert, not update: covers the (should-be-rare) case where a
  // Subscription row is missing for this mechanic -- a webhook arriving
  // out of order, or an account created before this feature existed --
  // instead of the whole request failing with a "record not found".
  await prisma.subscription.upsert({
    where: { mechanicId },
    update: fields,
    create: { mechanicId, ...fields },
  });
}

export default router;
