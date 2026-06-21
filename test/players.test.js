import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayerRoster,
  processPlayerList,
  processPlayerAppear,
  processPlayerDisappear,
  createProximityTracker,
  checkProximity,
  removeFromProximity,
} from '../src/players.js';

describe('players — roster (join/leave)', () => {
  it('creates empty roster', () => {
    const r = createPlayerRoster();
    assert.equal(r.players.size, 0);
  });

  it('processPlayerList add produces player_join events', () => {
    const pkt = {
      records: {
        type: 'add',
        records: [
          { uuid: 'u1', username: 'Alice', build_platform: 7, xbox_user_id: 'x1' },
          { uuid: 'u2', username: 'Bob', build_platform: 1, xbox_user_id: 'x2' },
        ],
      },
    };
    const { roster, events } = processPlayerList(createPlayerRoster(), pkt, 'ClawBot');
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'player_join');
    assert.equal(events[0].name, 'Alice');
    assert.equal(events[0].uuid, 'u1');
    assert.equal(events[0].platform, 'windows');
    assert.equal(events[1].platform, 'android');
    assert.equal(roster.players.size, 2);
  });

  it('processPlayerList remove produces player_leave events', () => {
    let roster = createPlayerRoster();
    roster = processPlayerList(roster, {
      records: { type: 'add', records: [{ uuid: 'u1', username: 'Alice', build_platform: 7 }] },
    }, 'ClawBot').roster;

    const { roster: next, events } = processPlayerList(roster, {
      records: { type: 'remove', records: [{ uuid: 'u1' }] },
    }, 'ClawBot');

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'player_leave');
    assert.equal(events[0].name, 'Alice');
    assert.equal(next.players.size, 0);
  });

  it('filters out bot from join events', () => {
    const { events } = processPlayerList(createPlayerRoster(), {
      records: { type: 'add', records: [{ uuid: 'bot-uuid', username: 'ClawBot', build_platform: 7 }] },
    }, 'ClawBot');
    assert.equal(events.length, 0);
  });

  it('duplicate adds do not produce duplicate events', () => {
    const pkt = { records: { type: 'add', records: [{ uuid: 'u1', username: 'Alice', build_platform: 7 }] } };
    const { roster } = processPlayerList(createPlayerRoster(), pkt, 'ClawBot');
    const { events } = processPlayerList(roster, pkt, 'ClawBot');
    assert.equal(events.length, 0);
  });

  it('remove for unknown uuid produces no events', () => {
    const { events } = processPlayerList(createPlayerRoster(), {
      records: { type: 'remove', records: [{ uuid: 'unknown' }] },
    }, 'ClawBot');
    assert.equal(events.length, 0);
  });

  it('handles null/empty pkt gracefully', () => {
    const { events } = processPlayerList(createPlayerRoster(), null, 'ClawBot');
    assert.equal(events.length, 0);
  });
});

describe('players — appear/disappear', () => {
  it('processPlayerAppear returns event with name, uuid, position', () => {
    const ev = processPlayerAppear({
      username: 'Alice', uuid: 'u1', runtime_id: 42,
      position: { x: 10, y: 64, z: 20 },
    });
    assert.equal(ev.type, 'player_appear');
    assert.equal(ev.name, 'Alice');
    assert.equal(ev.uuid, 'u1');
    assert.deepEqual(ev.position, { x: 10, y: 64, z: 20 });
  });

  it('processPlayerAppear returns null for missing pkt', () => {
    assert.equal(processPlayerAppear(null), null);
    assert.equal(processPlayerAppear({}), null);
  });

  it('processPlayerDisappear returns event for known player', () => {
    const tracker = {
      players: new Map([['u1', { name: 'Alice', uuid: 'u1', runtimeId: 42 }]]),
      _ridIndex: new Map([[42, { map: 'players', key: 'u1' }]]),
    };
    const ev = processPlayerDisappear(42, tracker);
    assert.equal(ev.type, 'player_disappear');
    assert.equal(ev.name, 'Alice');
  });

  it('processPlayerDisappear returns null for non-player entity', () => {
    const tracker = {
      mobs: new Map([[100, { entityType: 'zombie' }]]),
      players: new Map(),
      _ridIndex: new Map([[100, { map: 'mobs', key: 100 }]]),
    };
    assert.equal(processPlayerDisappear(100, tracker), null);
  });

  it('processPlayerDisappear returns null for unknown runtimeId', () => {
    const tracker = { players: new Map(), _ridIndex: new Map() };
    assert.equal(processPlayerDisappear(999, tracker), null);
  });
});

describe('players — proximity tracking', () => {
  it('creates empty proximity tracker', () => {
    const pt = createProximityTracker();
    assert.equal(pt.zones.size, 0);
  });

  it('far → near emits player_nearby with zone=near', () => {
    const pt = createProximityTracker();
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 12, y: 64, z: 0 } }];
    const { tracker, events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'player_nearby');
    assert.equal(events[0].zone, 'near');
    assert.equal(events[0].name, 'Alice');
    assert.equal(tracker.zones.get('u1'), 'near');
  });

  it('far → close emits player_nearby with zone=close', () => {
    const pt = createProximityTracker();
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 5, y: 64, z: 0 } }];
    const { events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    assert.equal(events[0].type, 'player_nearby');
    assert.equal(events[0].zone, 'close');
  });

  it('near → close emits player_nearby with zone=close', () => {
    const pt = { zones: new Map([['u1', 'near']]) };
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 5, y: 64, z: 0 } }];
    const { events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'player_nearby');
    assert.equal(events[0].zone, 'close');
  });

  it('close → far emits player_left_nearby', () => {
    const pt = { zones: new Map([['u1', 'close']]) };
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 50, y: 64, z: 0 } }];
    const { events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'player_left_nearby');
    assert.equal(events[0].zone, 'close');
  });

  it('no event when player stays in same zone', () => {
    const pt = { zones: new Map([['u1', 'near']]) };
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 10, y: 64, z: 0 } }];
    const { events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    assert.equal(events.length, 0);
  });

  it('tracks multiple players independently', () => {
    const pt = createProximityTracker();
    const players = [
      { name: 'Alice', uuid: 'u1', position: { x: 5, y: 64, z: 0 } },
      { name: 'Bob', uuid: 'u2', position: { x: 50, y: 64, z: 0 } },
    ];
    const { tracker, events } = checkProximity(pt, players, { x: 0, y: 64, z: 0 });
    // Alice is close, Bob is far (no event since far→far is no transition... wait, default is 'far')
    assert.equal(events.length, 1); // only Alice triggers
    assert.equal(events[0].name, 'Alice');
    assert.equal(tracker.zones.get('u1'), 'close');
    assert.ok(!tracker.zones.has('u2') || tracker.zones.get('u2') === 'far');
  });

  it('returns no events when bot has no position', () => {
    const pt = createProximityTracker();
    const players = [{ name: 'Alice', uuid: 'u1', position: { x: 5, y: 64, z: 0 } }];
    const { events } = checkProximity(pt, players, null);
    assert.equal(events.length, 0);
  });

  it('removeFromProximity cleans up player', () => {
    const pt = { zones: new Map([['u1', 'close'], ['u2', 'near']]) };
    const next = removeFromProximity(pt, 'u1');
    assert.equal(next.zones.size, 1);
    assert.ok(!next.zones.has('u1'));
    assert.equal(next.zones.get('u2'), 'near');
  });

  it('removeFromProximity handles unknown uuid', () => {
    const pt = { zones: new Map([['u1', 'close']]) };
    const next = removeFromProximity(pt, 'unknown');
    assert.equal(next, pt); // same reference, no change
  });
});
