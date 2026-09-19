import { Router } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { isValidWebhookSignature, subscriptionFieldsFromLS } from '../lib/lemonSqueezy.js';
import { isLiveSubscription } from '../lib/subscriptionState.js';

const router = Router();

// Every event that carries a current subscription state in data.attributes.
// Lemon Squeezy sends the *full* current object on each one, so the handler
// always overwrites our row with what's in the payload rather than trying
// to apply a delta -- that's what makes it safe to process out of order or
// twice.
//
// subscription_payment_* are deliberately NOT here: their data is a
// subscription-invoice (type "subscription-invoices", data.id = the invoice
// id, attributes.status = "paid"), not the subscription. Applying one
// overwrote the row with the invoice id and status "paid" (seen in the
// first real checkout). LS also sends a subscription_updated with the real
// state alongside each payment event, so recording them is enough.
const SUBSCRIPTION_STATE_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
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
    const claimedMechanicId = req.body?.meta?.custom_data?.mechanic_id || null;

    const existing = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // A mechanic_id that doesn't match any user (deleted account, id from a
    // simulated/foreign checkout) would violate the webhook_events FK, 500
    // the request, lose the event and make LS retry it for days. Record the
    // event unlinked with the reason instead, and ack it so LS stops
    // retrying; the processingError makes it show up for review.
    let mechanicId = claimedMechanicId;
    let unlinkedReason = null;
    if (claimedMechanicId) {
      const user = await prisma.user.findUnique({ where: { id: claimedMechanicId }, select: { id: true } });
      if (!user) {
        mechanicId = null;
        unlinkedReason = `${eventName || 'unknown'} carried mechanic_id ${claimedMechanicId}, which matches no user`;
      }
    }

    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        eventName: eventName || 'unknown',
        payload: req.body,
        mechanicId,
        ...(unlinkedReason && { processingError: unlinkedReason }),
      },
    });

    if (unlinkedReason) {
      console.error(`[webhook] ${unlinkedReason}`);
      return res.status(200).json({ ok: true, unlinked: true });
    }

    try {
      const note = await applyEvent(eventName, req.body, mechanicId);
      // note = the event was understood but deliberately not applied (see
      // below). Kept in processingError so it shows up in the same place as
      // real failures, without a 500 that would make LS retry it.
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), ...(note && { processingError: note }) },
      });
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

  // Belt and braces: never write a non-subscription object onto the row.
  if (payload?.data?.type !== 'subscriptions') {
    throw new Error(`${eventName} carried data.type "${payload?.data?.type}", expected "subscriptions"`);
  }

  const fields = subscriptionFieldsFromLS(payload.data);
  const lemonsqueezySubscriptionId = fields.lemonsqueezySubscriptionId;

  // Same mechanic, different LS subscription than the one we track. Happens
  // when someone ends up with two subscriptions (two checkouts) and one of
  // them is cancelled/expired: applying that event would overwrite the row
  // of the healthy one and lock the account out although it's paid up
  // (seen in the first real cancel test). While the tracked subscription is
  // still alive it wins, and this event is only flagged for review. Once it
  // is dead (or there's none yet) a new subscription takes over the row.
  const current = await prisma.subscription.findUnique({ where: { mechanicId } });
  if (
    current?.lemonsqueezySubscriptionId &&
    current.lemonsqueezySubscriptionId !== lemonsqueezySubscriptionId &&
    isLiveSubscription(current)
  ) {
    return (
      `${eventName} is for subscription ${lemonsqueezySubscriptionId} but this account is tracked on ` +
      `${current.lemonsqueezySubscriptionId} (${current.status}); not applied. Possible duplicate subscription.`
    );
  }

  // upsert, not update: covers the (should-be-rare) case where a
  // Subscription row is missing for this mechanic -- a webhook arriving
  // out of order, or an account created before this feature existed --
  // instead of the whole request failing with a "record not found".
  await prisma.subscription.upsert({
    where: { mechanicId },
    update: fields,
    create: { mechanicId, ...fields },
  });
  return null;
}

export default router;
