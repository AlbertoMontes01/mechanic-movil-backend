// Webhook handler behaviour that doesn't need a real Lemon Squeezy payload:
// signature check, and events whose mechanic_id doesn't match any user.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'test-webhook-secret';

function send(body) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET).update(raw).digest('hex');
  return request(app)
    .post('/api/webhooks/lemonsqueezy')
    .set('Content-Type', 'application/json')
    .set('X-Signature', sig)
    .send(raw);
}

const eventFor = (mechanicId) => ({
  meta: { event_name: 'subscription_created', custom_data: { mechanic_id: mechanicId }, nonce: randomUUID() },
  data: { id: String(Date.now()), attributes: { status: 'on_trial', customer_id: 1 } },
});

after(async () => {
  await prisma.webhookEvent.deleteMany({ where: { eventName: 'subscription_created', processingError: { contains: 'matches no user' } } });
  await prisma.$disconnect();
});

describe('POST /api/webhooks/lemonsqueezy', () => {
  test('rejects a bad signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'nope')
      .send(JSON.stringify(eventFor(randomUUID())));
    assert.equal(res.status, 401);
  });

  test('unknown mechanic_id is stored unlinked and acked with 200, not a 500', async () => {
    const res = await send(eventFor(randomUUID()));
    assert.equal(res.status, 200);
    assert.equal(res.body.unlinked, true);

    const row = await prisma.webhookEvent.findFirst({
      where: { processingError: { contains: 'matches no user' } },
      orderBy: { receivedAt: 'desc' },
    });
    assert.ok(row, 'event should be recorded');
    assert.equal(row.mechanicId, null);
  });
});

describe('subscription_payment_success (invoice payload)', () => {
  test('does not overwrite the subscription row with the invoice', async () => {
    const email = `wh-invoice-${Date.now()}@test.internal`;
    const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: 'WH' } });
    try {
      await prisma.subscription.create({
        data: { mechanicId: user.id, status: 'on_trial', lemonsqueezySubscriptionId: '111' },
      });
      const res = await send({
        meta: { event_name: 'subscription_payment_success', custom_data: { mechanic_id: user.id }, nonce: randomUUID() },
        data: { type: 'subscription-invoices', id: '999', attributes: { status: 'paid', subscription_id: 111 } },
      });
      assert.equal(res.status, 200);
      const sub = await prisma.subscription.findUnique({ where: { mechanicId: user.id } });
      assert.equal(sub.status, 'on_trial');
      assert.equal(sub.lemonsqueezySubscriptionId, '111');
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

describe('two LS subscriptions for one mechanic', () => {
  let user;
  before(async () => {
    user = await prisma.user.create({ data: { email: `wh-dup-${Date.now()}@test.internal`, passwordHash: 'x', name: 'WH' } });
  });
  after(async () => {
    await prisma.user.delete({ where: { id: user.id } });
  });

  const subEvent = (name, id, status, extra = {}) => ({
    meta: { event_name: name, custom_data: { mechanic_id: user.id }, nonce: randomUUID() },
    data: { type: 'subscriptions', id, attributes: { status, customer_id: 7, ...extra } },
  });
  const row = () => prisma.subscription.findUnique({ where: { mechanicId: user.id } });

  test('first subscription is adopted; a dead second one cannot overwrite the live one', async () => {
    let res = await send(subEvent('subscription_created', '100', 'active'));
    assert.equal(res.status, 200);
    assert.equal((await row()).lemonsqueezySubscriptionId, '100');

    // an old/duplicate subscription gets cancelled and expires
    res = await send(subEvent('subscription_expired', '200', 'expired', { ends_at: '2026-01-01T00:00:00Z' }));
    assert.equal(res.status, 200);
    const after = await row();
    assert.equal(after.status, 'active');
    assert.equal(after.lemonsqueezySubscriptionId, '100');

    const ev = await prisma.webhookEvent.findFirst({
      where: { mechanicId: user.id, eventName: 'subscription_expired' },
    });
    assert.match(ev.processingError, /Possible duplicate subscription/);
    assert.ok(ev.processedAt);
  });

  test('once the tracked subscription is dead, a new one takes over the row', async () => {
    await prisma.subscription.update({ where: { mechanicId: user.id }, data: { status: 'expired' } });
    const res = await send(subEvent('subscription_created', '300', 'on_trial'));
    assert.equal(res.status, 200);
    const after = await row();
    assert.equal(after.lemonsqueezySubscriptionId, '300');
    assert.equal(after.status, 'on_trial');
  });
});

describe('POST /api/checkout guard', () => {
  test('409 already_subscribed while a subscription is live, no LS call made', async () => {
    const email = `wh-checkout-${Date.now()}@test.internal`;
    const reg = await request(app).post('/api/auth/register').send({ email, password: 'password123', name: 'WH' });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;
    try {
      await prisma.subscription.update({
        where: { mechanicId: userId },
        data: { status: 'on_trial', lemonsqueezySubscriptionId: '555', trialEndsAt: new Date(Date.now() + 864e5) },
      });
      const res = await request(app).post('/api/checkout').set('Authorization', `Bearer ${reg.body.token}`);
      assert.equal(res.status, 409);
      assert.equal(res.body.error, 'already_subscribed');
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});
