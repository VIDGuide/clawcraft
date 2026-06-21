import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIBABLE_EVENTS,
  createSubscriptions,
  subscribe,
  unsubscribe,
  shouldEmit,
  listSubscriptions,
} from '../src/subscriptions.js';

describe('subscriptions', () => {
  describe('createSubscriptions', () => {
    it('creates empty state', () => {
      const state = createSubscriptions();
      assert.equal(state.size, 0);
    });
  });

  describe('subscribe', () => {
    it('subscribes to a valid event type', () => {
      const state = createSubscriptions();
      const result = subscribe(state, 'weather');
      assert.equal(result.subscribed, 'weather');
      assert.equal(result.error, undefined);
      assert.equal(result.state.has('weather'), true);
    });

    it('subscribes to block_changed with default radius', () => {
      const state = createSubscriptions();
      const result = subscribe(state, 'block_changed');
      assert.equal(result.subscribed, 'block_changed');
      assert.equal(result.radius, 16);
    });

    it('subscribes to block_changed with custom radius', () => {
      const state = createSubscriptions();
      const result = subscribe(state, 'block_changed', { radius: 8 });
      assert.equal(result.radius, 8);
    });

    it('returns error for unknown event type', () => {
      const state = createSubscriptions();
      const result = subscribe(state, 'nonexistent');
      assert.ok(result.error.includes('Unknown event type'));
      assert.equal(result.state, state);
    });
  });

  describe('unsubscribe', () => {
    it('unsubscribes from a subscribed event', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'weather').state;
      const result = unsubscribe(state, 'weather');
      assert.equal(result.unsubscribed, 'weather');
      assert.equal(result.state.has('weather'), false);
    });

    it('returns error when not subscribed', () => {
      const state = createSubscriptions();
      const result = unsubscribe(state, 'weather');
      assert.ok(result.error.includes('Not subscribed'));
    });

    it('returns error for unknown event type', () => {
      const state = createSubscriptions();
      const result = unsubscribe(state, 'nonexistent');
      assert.ok(result.error.includes('Unknown event type'));
    });
  });

  describe('shouldEmit', () => {
    it('returns false when not subscribed', () => {
      const state = createSubscriptions();
      assert.equal(shouldEmit(state, 'weather'), false);
    });

    it('returns true when subscribed (no radius)', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'weather').state;
      assert.equal(shouldEmit(state, 'weather'), true);
    });

    it('returns true when within radius', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'block_changed', { radius: 10 }).state;
      assert.equal(shouldEmit(state, 'block_changed', { distance: 5 }), true);
    });

    it('returns false when beyond radius', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'block_changed', { radius: 10 }).state;
      assert.equal(shouldEmit(state, 'block_changed', { distance: 15 }), false);
    });

    it('returns true at exactly the radius boundary', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'block_changed', { radius: 10 }).state;
      assert.equal(shouldEmit(state, 'block_changed', { distance: 10 }), true);
    });
  });

  describe('listSubscriptions', () => {
    it('lists available types with subscribed status', () => {
      let state = createSubscriptions();
      state = subscribe(state, 'weather').state;
      const { active, available } = listSubscriptions(state);
      assert.equal(active.length, 1);
      assert.equal(active[0].event, 'weather');
      assert.equal(available.length, Object.keys(SUBSCRIBABLE_EVENTS).length);
      const weatherEntry = available.find(a => a.event === 'weather');
      assert.equal(weatherEntry.subscribed, true);
      const blockEntry = available.find(a => a.event === 'block_changed');
      assert.equal(blockEntry.subscribed, false);
    });
  });
});
