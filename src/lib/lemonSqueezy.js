import { createHmac, timingSafeEqual } from 'crypto';

const API_BASE = 'https://api.lemonsqueezy.com/v1';

function authHeaders() {
  return {
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
  };
}

// Creates a hosted checkout for this mechanic's subscription, tagging it
// with mechanic_id in custom_data so the webhook can link the resulting
// subscription back to the right User -- the checkout's own post-payment
// redirect is never trusted as proof of payment, only the webhook is.
export async function createCheckout({ email, mechanicId }) {
  const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app?checkout=success`;

  const res = await fetch(`${API_BASE}/checkouts`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email,
            custom: { mechanic_id: mechanicId },
          },
          product_options: {
            redirect_url: redirectUrl,
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: String(process.env.LEMONSQUEEZY_STORE_ID) } },
          variant: { data: { type: 'variants', id: String(process.env.LEMONSQUEEZY_VARIANT_ID) } },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lemon Squeezy checkout creation failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  return json.data.attributes.url;
}

// Constant-time comparison -- a timing-dependent compare would let an
// attacker recover the correct signature one byte at a time.
// The signed customer-portal links for one subscription (update card, view
// invoices, cancel). LS signs them per request and they expire (~24h), so
// they're fetched on demand rather than stored.
export async function getSubscriptionUrls(lemonsqueezySubscriptionId) {
  const res = await fetch(`${API_BASE}/subscriptions/${encodeURIComponent(lemonsqueezySubscriptionId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lemon Squeezy subscription lookup failed (${res.status}): ${body}`);
  }
  const { urls } = (await res.json()).data.attributes;
  return { customerPortal: urls?.customer_portal, updatePaymentMethod: urls?.update_payment_method };
}

// Maps a Lemon Squeezy `subscriptions` object (webhook data, or an API
// response) onto our Subscription columns. One place, so a webhook and an
// in-app cancel/resume can never disagree about what a field means.
export function subscriptionFieldsFromLS(data) {
  const attrs = data?.attributes || {};
  return {
    status: attrs.status,
    lemonsqueezySubscriptionId: data?.id ? String(data.id) : null,
    lemonsqueezyCustomerId: attrs.customer_id != null ? String(attrs.customer_id) : null,
    trialEndsAt: attrs.trial_ends_at ? new Date(attrs.trial_ends_at) : null,
    renewsAt: attrs.renews_at ? new Date(attrs.renews_at) : null,
    endsAt: attrs.ends_at ? new Date(attrs.ends_at) : null,
    cardBrand: attrs.card_brand || null,
    cardLastFour: attrs.card_last_four || null,
  };
}

// Cancel = LS DELETE (access continues until the period ends; LS then
// sends subscription_cancelled). Resume = PATCH cancelled:false, allowed
// only before ends_at. Both return the updated subscription object.
export async function cancelSubscription(lemonsqueezySubscriptionId) {
  const res = await fetch(`${API_BASE}/subscriptions/${encodeURIComponent(lemonsqueezySubscriptionId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Lemon Squeezy cancel failed (${res.status}): ${await res.text()}`);
  return (await res.json()).data;
}

export async function resumeSubscription(lemonsqueezySubscriptionId) {
  const res = await fetch(`${API_BASE}/subscriptions/${encodeURIComponent(lemonsqueezySubscriptionId)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      data: { type: 'subscriptions', id: String(lemonsqueezySubscriptionId), attributes: { cancelled: false } },
    }),
  });
  if (!res.ok) throw new Error(`Lemon Squeezy resume failed (${res.status}): ${await res.text()}`);
  return (await res.json()).data;
}

export function isValidWebhookSignature(rawBody, signatureHeader) {
  if (!rawBody || !signatureHeader) return false;

  const expected = createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
