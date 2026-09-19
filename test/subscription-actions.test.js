// In-app cancel / resume: LS is stubbed at the fetch level so nothing real
// gets cancelled; what's under test is our guards and how the row is updated.

import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let token, userId;
const future = new Date(Date.now() + 20 * 864e5).toISOString();
const authed = (r) => r.set('Authorization', `Bearer ${token}`);

const lsResponse = (status, ends_at = null) => ({
  ok: true,
  json: async () => ({
    data: {
      type: 'subscriptions',
      id: '777',
      attributes: { status, customer_id: 9, ends_at, renews_at: future, trial_ends_at: null, card_brand: 'visa', card_last_four: '4242' },
    },
  }),
});

before(async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email: `sub-actions-${Date.now()}@test.internal`, password: 'password123', name: 'SA' });
  token = reg.body.token;
  userId = reg.body.user.id;
});

after(async () => {
  mock.restoreAll();
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const setRow = (data) => prisma.subscription.update({ where: { mechanicId: userId }, data });

describe('POST /api/subscription/cancel and /resume', () => {
  test('404 when the account has no Lemon Squeezy subscription', async () => {
    assert.equal((await authed(request(app).post('/api/subscription/cancel'))).status, 404);
  });

  test('cancel calls LS with DELETE and stores cancelled + endsAt', async () => {
    await setRow({ status: 'active', lemonsqueezySubscriptionId: '777' });
    const fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('cancelled', future));

    const res = await authed(request(app).post('/api/subscription/cancel'));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'cancelled');
    assert.equal(fetchMock.mock.calls[0].arguments[1].method, 'DELETE');
    assert.match(fetchMock.mock.calls[0].arguments[0], /subscriptions\/777$/);

    const row = await prisma.subscription.findUnique({ where: { mechanicId: userId } });
    assert.equal(row.status, 'cancelled');
    assert.equal(row.endsAt.toISOString(), future);
    fetchMock.mock.restore();
  });

  test('cancelling an already cancelled subscription is 409 and never calls LS', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('cancelled', future));
    const res = await authed(request(app).post('/api/subscription/cancel'));
    assert.equal(res.status, 409);
    assert.equal(fetchMock.mock.callCount(), 0);
    fetchMock.mock.restore();
  });

  test('resume sends cancelled:false and stores active again', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('active'));
    const res = await authed(request(app).post('/api/subscription/resume'));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'active');
    const sent = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(sent.data.attributes.cancelled, false);
    fetchMock.mock.restore();
  });

  test('resume clears a stale trial_ends_at only when the trial has elapsed', async () => {
    const day = 864e5;
    // trial already over -> null is sent (otherwise LS answers 422)
    await setRow({ status: 'cancelled', endsAt: new Date(Date.now() + day), trialEndsAt: new Date(Date.now() - day) });
    let fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('active'));
    await authed(request(app).post('/api/subscription/resume'));
    assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).data.attributes.trial_ends_at, null);
    fetchMock.mock.restore();

    // cancelled mid-trial -> must NOT send it, or the trial would end early
    await setRow({ status: 'cancelled', endsAt: new Date(Date.now() + day), trialEndsAt: new Date(Date.now() + 10 * day) });
    fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('on_trial'));
    await authed(request(app).post('/api/subscription/resume'));
    assert.equal('trial_ends_at' in JSON.parse(fetchMock.mock.calls[0].arguments[1].body).data.attributes, false);
    fetchMock.mock.restore();
  });

  test('a Lemon Squeezy failure is a 502 with a readable message, not a bare 500', async () => {
    await setRow({ status: 'cancelled', endsAt: new Date(Date.now() + 864e5), trialEndsAt: null });
    const fetchMock = mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 422, text: async () => 'nope' }));
    const res = await authed(request(app).post('/api/subscription/resume'));
    assert.equal(res.status, 502);
    assert.match(res.body.error, /could not update your subscription/i);
    fetchMock.mock.restore();
  });

  test('resume is refused once the paid period is over', async () => {
    await setRow({ status: 'cancelled', endsAt: new Date(Date.now() - 864e5) });
    const fetchMock = mock.method(globalThis, 'fetch', async () => lsResponse('active'));
    const res = await authed(request(app).post('/api/subscription/resume'));
    assert.equal(res.status, 409);
    assert.equal(fetchMock.mock.callCount(), 0);
    fetchMock.mock.restore();
  });
});
