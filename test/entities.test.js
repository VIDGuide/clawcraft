import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityTracker,
  handleAddPlayer,
  handleAddEntity,
  handleAddItemEntity,
  handleMoveEntity,
  handleRemoveEntity,
  handlePlayerList,
  nearbyEntities,
} from '../src/entities.js';

describe('entities', () => {
  it('creates empty tracker', () => {
    const t = createEntityTracker();
    assert.equal(t.players.size, 0);
    assert.equal(t.mobs.size, 0);
    assert.equal(t.items.size, 0);
    assert.equal(t.playerNames.size, 0);
  });

  it('tracks a player from add_player packet', () => {
    const t = handleAddPlayer(createEntityTracker(), {
      uuid: 'abc-123',
      runtime_id: 42,
      username: 'Michael',
      position: { x: 10, y: 64, z: 20 },
    });

    assert.equal(t.players.size, 1);
    const p = t.players.get('abc-123');
    assert.equal(p.name, 'Michael');
    assert.deepEqual(p.position, { x: 10, y: 64, z: 20 });
    assert.equal(p.type, 'player');
    assert.equal(t.playerNames.get(42), 'Michael');
  });

  it('tracks mobs from add_entity packet', () => {
    const t = handleAddEntity(createEntityTracker(), {
      runtime_id: 100,
      entity_type: 'minecraft:zombie',
      position: { x: 5, y: 64, z: 5 },
    });

    assert.equal(t.mobs.size, 1);
    const m = t.mobs.get(100);
    assert.equal(m.entityType, 'minecraft:zombie');
    assert.deepEqual(m.position, { x: 5, y: 64, z: 5 });
    assert.equal(m.type, 'mob');
  });

  it('tracks items from add_item_entity packet', () => {
    const t = handleAddItemEntity(createEntityTracker(), {
      runtime_id: 200,
      item: { name: 'diamond' },
      position: { x: 0, y: 64, z: 0 },
    });

    assert.equal(t.items.size, 1);
    const i = t.items.get(200);
    assert.deepEqual(i.item, { name: 'diamond' });
    assert.equal(i.type, 'item');
  });

  it('updates entity position via move_entity', () => {
    let t = handleAddPlayer(createEntityTracker(), {
      uuid: 'abc', runtime_id: 42, username: 'Michael',
      position: { x: 10, y: 64, z: 20 },
    });

    t = handleMoveEntity(t, {
      runtime_id: 42,
      position: { x: 15, y: 64, z: 25 },
    });

    assert.deepEqual(t.players.get('abc').position, { x: 15, y: 64, z: 25 });
  });

  it('removes entity via remove_entity', () => {
    let t = handleAddPlayer(createEntityTracker(), {
      uuid: 'abc', runtime_id: 42, username: 'Michael',
      position: { x: 10, y: 64, z: 20 },
    });

    t = handleRemoveEntity(t, 42);
    assert.equal(t.players.size, 0);
  });

  it('ignores remove_entity for unknown id', () => {
    const t = handleRemoveEntity(createEntityTracker(), 999);
    assert.equal(t.players.size, 0);
  });

  it('player_list updates names', () => {
    const t = handlePlayerList(createEntityTracker(), {
      entries: [
        { runtime_entity_id: 42, name: 'Michael' },
        { runtime_entity_id: 99, name: 'ClawBot' },
      ],
    });

    assert.equal(t.playerNames.size, 2);
    assert.equal(t.playerNames.get(42), 'Michael');
    assert.equal(t.playerNames.get(99), 'ClawBot');
  });

  it('nearbyEntities filters by radius', () => {
    let t = createEntityTracker();

    // Player within radius
    t = handleAddPlayer(t, {
      uuid: 'abc', runtime_id: 42, username: 'Michael',
      position: { x: 5, y: 64, z: 5 },
    });

    // Player far away
    t = handleAddPlayer(t, {
      uuid: 'xyz', runtime_id: 99, username: 'FarAway',
      position: { x: 100, y: 64, z: 200 },
    });

    const nearby = nearbyEntities(t, { x: 0, y: 64, z: 0 }, 32);
    assert.equal(nearby.players.length, 1);
    assert.equal(nearby.players[0].name, 'Michael');
  });

  it('nearbyEntities returns empty when nothing nearby', () => {
    const t = createEntityTracker();
    const nearby = nearbyEntities(t, { x: 0, y: 64, z: 0 }, 32);
    assert.equal(nearby.players.length, 0);
    assert.equal(nearby.mobs.length, 0);
    assert.equal(nearby.items.length, 0);
  });
});
