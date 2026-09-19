// hasAccess / isLiveSubscription decide who gets into the app and which
// events may overwrite a subscription row -- pure functions, no DB.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasAccess, isLiveSubscription } from '../src/lib/subscriptionState.js';

const now = new Date('2026-09-19T12:00:00Z');
const past = new Date('2026-09-01T00:00:00Z');
const future = new Date('2026-10-19T00:00:00Z');
const sub = (o) => ({ lemonsqueezySubscriptionId: '1', manualOverride: false, trialEndsAt: null, endsAt: null, ...o });

describe('hasAccess', () => {
  test('no row, pending_checkout, past_due, unpaid, expired, paused: no access', () => {
    assert.equal(hasAccess(null, now), false);
    for (const status of ['pending_checkout', 'past_due', 'unpaid', 'expired', 'paused']) {
      assert.equal(hasAccess(sub({ status }), now), false, status);
    }
  });
  test('active and an unexpired trial: access; an elapsed trial: none', () => {
    assert.equal(hasAccess(sub({ status: 'active' }), now), true);
    assert.equal(hasAccess(sub({ status: 'on_trial', trialEndsAt: future }), now), true);
    assert.equal(hasAccess(sub({ status: 'on_trial', trialEndsAt: past }), now), false);
  });
  test('cancelled keeps access until endsAt, then loses it', () => {
    assert.equal(hasAccess(sub({ status: 'cancelled', endsAt: future }), now), true);
    assert.equal(hasAccess(sub({ status: 'cancelled', endsAt: past }), now), false);
    assert.equal(hasAccess(sub({ status: 'cancelled', endsAt: null }), now), false);
  });
  test('manualOverride always has access', () => {
    assert.equal(hasAccess(sub({ status: 'expired', manualOverride: true }), now), true);
  });
});

describe('isLiveSubscription', () => {
  test('locked-out but still billing statuses are live', () => {
    for (const status of ['on_trial', 'active', 'past_due', 'unpaid', 'paused']) {
      assert.equal(isLiveSubscription(sub({ status }), now), true, status);
    }
  });
  test('expired, pending_checkout, and cancelled past endsAt are not', () => {
    assert.equal(isLiveSubscription(sub({ status: 'expired' }), now), false);
    assert.equal(isLiveSubscription(sub({ status: 'pending_checkout', lemonsqueezySubscriptionId: null }), now), false);
    assert.equal(isLiveSubscription(sub({ status: 'cancelled', endsAt: past }), now), false);
    assert.equal(isLiveSubscription(sub({ status: 'cancelled', endsAt: future }), now), true);
  });
});
