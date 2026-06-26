/**
 * commands.js — Command dispatch for ClawCraft
 *
 * Extracts the handle() switch from bot.js into a testable module.
 * Each command handler receives a context object (ctx) with access to
 * bot state, caches, and I/O primitives. bot.js remains the I/O wiring layer.
 *
 * Pure? No — handlers call ctx.client.queue() and ctx.execFileSync().
 * But the dispatch logic itself is isolated and individually testable.
 */
import { faceAngles, walkSteps } from './math.js';
import { setPosition, setRotation } from './state.js';
import { buildMovePlayer, buildPlayerAuthInput, buildChat, buildMobEquipment, buildInventoryTransaction, buildPlayerAction, buildItemUseTransaction, buildItemUseOnEntityTransaction, buildItemReleaseTransaction } from './packets.js';
import { nearbyEntities } from './entities.js';
import { getBlock, getBlocks, chunkStatus, scan, compactScan, direction, raycast, findBlocks, buildPlaceFace } from './chunks.js';
import { findPath, euclideanDistance } from './navigation.js';
import { subscribe, unsubscribe, listSubscriptions } from './subscriptions.js';
import { titleFor, uuidFor, count as emoteCount } from './emotes.js';
import { findItemByName } from './items.js';
import { getBreakTime, findBestTool, isInteractable, isFood, isThrowable } from './actions.js';
import { getHeldItem, getSummary } from './inventory.js';
import { getVitalsSummary, getVitalsSnapshot } from './vitals.js';

let cid = 0;

/**
 * Dispatch a JSON command.
 *
 * @param {object} cmd - Parsed JSON command with `action` field
 * @param {object} ctx - Bot context (state, caches, client, helpers)
 * @param {function} outputFn - Response writer
 */
export function handle(cmd, ctx, outputFn) {
  if (!cmd || typeof cmd !== 'object' || !cmd.action) {
    return outputFn({ type: 'response', error: 'Invalid command: need {action}' });
  }
  for (const k of ['x', 'y', 'z', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'yaw', 'pitch', 'radius', 'distance']) {
    if (k in cmd) {
      cmd[k] = Number(cmd[k]);
      if (Number.isNaN(cmd[k])) return outputFn({ type: 'response', error: `Invalid ${k}: must be a number` });
    }
  }
  const id = cmd.id ?? cid++;
  const ok = (d) => outputFn({ type: 'response', id, ...d });

  try {
    switch (cmd.action) {

      case 'chat':
        ctx.client.queue('text', {
          type: 'chat', needs_translation: false, category: 'authored',
          source_name: ctx.USERNAME, message: cmd.message,
          xuid: '', platform_chat_id: '', has_filtered_message: false,
        });
        return ok({ sent: true });

      case 'say': {
        if (!ctx.SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const sayCmd = 'say <ClawBot> ' + (cmd.message ?? '');
        const parts = ctx.SEND_CMD.split(/\s+/);
        ctx.execFileSync(parts[0], [...parts.slice(1), sayCmd], { timeout: 5000 });
        return ok({ sent: true });
      }

      case 'whisper':
        if (!cmd.to) return ok({ error: 'Need "to" player name' });
        ctx.client.queue('text', { ...buildChat(cmd.message, 'whisper'), source_name: ctx.USERNAME, parameters: [cmd.to, cmd.message] });
        return ok({ sent: true, to: cmd.to });

      case 'emote': {
        const emoteId = cmd.emoteId || (cmd.name ? uuidFor(cmd.name) : null);
        if (!emoteId) return ok({ error: cmd.name ? `Unknown emote: ${cmd.name}` : 'Need emoteId or name' });
        ctx.client.queue('emote', {
          entity_id: ctx.state.runtimeId ?? 0n,
          emote_id: emoteId, emote_length_ticks: 0,
          xuid: '', platform_id: '', flags: 'server_side',
        });
        return ok({ sent: true, emoteId, emote: titleFor(emoteId) || emoteId });
      }

      case 'pos':
        return ok({ pos: ctx.state.pos, yaw: ctx.state.yaw, pitch: ctx.state.pitch });

      case 'movement_info':
        // Diagnostic: report negotiated movement authority + local position.
        return ok({
          authority: ctx.state.movementAuthority,
          rewindHistorySize: ctx.state.rewindHistorySize,
          pos: ctx.state.pos,
        });

      case 'server_pos': {
        // SERVER-TRUTH position via `querytarget @s`. Unlike `pos` (which returns the
        // optimistic local prediction), this asks the server where the bot actually is.
        // Requires command permission on the bot account. Resolves asynchronously.
        if (typeof ctx.queryServerPosition !== 'function') {
          return ok({ error: 'server_pos unavailable (no query hook)' });
        }
        ctx.queryServerPosition()
          .then((sp) => ok({ serverPos: { x: sp.x, y: sp.y, z: sp.z }, yaw: sp.yaw, localPos: ctx.state.pos }))
          .catch((e) => ok({ error: `server_pos failed: ${e.message}` }));
        return; // response delivered via the promise above
      }

      case 'tp': {
        if (!ctx.SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const cmdStr = `tp ${ctx.USERNAME} ${cmd.x} ${cmd.y} ${cmd.z}${cmd.yaw !== undefined ? ' ' + cmd.yaw : ''}`;
        const parts = ctx.SEND_CMD.split(/\s+/);
        ctx.execFileSync(parts[0], [...parts.slice(1), cmdStr], { timeout: 5000 });
        ctx.state = { ...ctx.state, ...setPosition(ctx.state, cmd.x, cmd.y, cmd.z) };
        if (cmd.yaw !== undefined) ctx.state = { ...ctx.state, ...setRotation(ctx.state, cmd.yaw, ctx.state.pitch) };
        ctx.setIgnoreMoveUntil(Date.now() + 2000);
        ctx.requestSubChunksNear(cmd.x, cmd.z);
        return ok({ teleported: true, pos: ctx.state.pos });
      }

      case 'move': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        const target = { x: cmd.x, y: cmd.y, z: cmd.z };
        const toTarget = faceAngles(ctx.state.pos, target);
        const isHorizontal = Math.abs(target.y - ctx.state.pos.y) < 1;
        const usePitch = isHorizontal ? 0 : toTarget.pitch;
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, toTarget.yaw, usePitch) };
        // Total distance for step count estimate (server may move differently)
        const dx = target.x - ctx.state.pos.x;
        const dz = target.z - ctx.state.pos.z;
        const totalDist = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.max(1, Math.ceil(totalDist / 0.31));
        if (ctx.getActiveWalk && ctx.getActiveWalk()) return ok({ error: 'Already moving — abort_walk first' });
        const moveId = id;
        let mi = 0;
        // Walk toward target: each tick we compute a step from the CURRENT
        // (possibly server-corrected) position toward the target. This means
        // corrections are naturally absorbed — no drift accumulation.
        const moveTimer = setInterval(() => {
          const aw = ctx.getActiveWalk();
          if (!aw || aw.id !== moveId) { clearInterval(moveTimer); return; }
          const remainingDist = Math.hypot(target.x - ctx.state.pos.x, target.z - ctx.state.pos.z);
          if (remainingDist < 0.15) {
            clearInterval(moveTimer);
            ctx.setActiveWalk(null);
            ctx.emitEvent({ type: 'walk_done', id: moveId, walked: mi, pos: ctx.state.pos });
            return;
          }
          mi++;
          // Take a step of ~0.18 blocks toward target from current position
          const frac = Math.min(1, 0.31 / remainingDist);
          const step = {
            x: ctx.state.pos.x + (target.x - ctx.state.pos.x) * frac,
            y: ctx.state.pos.y,
            z: ctx.state.pos.z + (target.z - ctx.state.pos.z) * frac,
          };
          ctx.client.queue('player_auth_input', buildPlayerAuthInput(
            ctx.state, step.x, step.y, step.z, toTarget.yaw, usePitch, 'mouse',
            { tick: ctx.getTick(), moveForward: 1 },
          ));
          ctx.state = { ...ctx.state, ...setPosition(ctx.state, step.x, step.y, step.z) };
          ctx.setState(ctx.state);
          aw.stepIdx = mi;
          ctx.client.queue('player_auth_input', buildPlayerAuthInput(
            ctx.state, step.x, step.y, step.z, toTarget.yaw, usePitch, 'mouse',
            { tick: ctx.getTick(), moveForward: 1 },
          ));
          ctx.state = { ...ctx.state, ...setPosition(ctx.state, step.x, step.y, step.z) };
          ctx.setState(ctx.state);
          aw.stepIdx = mi;
        }, 50);
        ctx.setActiveWalk({ timer: moveTimer, id: moveId, steps: steps.length, stepIdx: 0 });
        return ok({ moving: true, steps, pos: target });
      }

      case 'setpos': {
        const pkt = buildMovePlayer(ctx.state, cmd.x, cmd.y, cmd.z, cmd.pitch, cmd.yaw, 'teleport');
        ctx.client.queue('move_player', pkt);
        ctx.client.queue('player_auth_input', buildPlayerAuthInput(ctx.state, cmd.x, cmd.y, cmd.z));
        ctx.state = { ...ctx.state, ...setPosition(ctx.state, cmd.x, cmd.y, cmd.z) };
        if (cmd.yaw !== undefined) ctx.state = { ...ctx.state, ...setRotation(ctx.state, cmd.yaw, cmd.pitch ?? 0) };
        return ok({ pos: ctx.state.pos });
      }

      case 'face': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        const angles = faceAngles(ctx.state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, angles.pitch, angles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, angles.yaw, angles.pitch) };
        return ok({ yaw: angles.yaw, pitch: angles.pitch });
      }

      case 'nearby': {
        const radius = cmd.radius ?? 32;
        const center = cmd.position ?? ctx.state.pos;
        if (!center) return ok({ error: 'No position' });
        const result = nearbyEntities(ctx.tracker, center, radius);
        result.players = result.players.filter(p => p.name.toLowerCase() !== ctx.USERNAME.toLowerCase());
        return ok({ nearby: result });
      }

      case 'block': {
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) return ok({ error: 'Need x, y, z' });
        const block = getBlock(ctx.chunkCache, cmd.x, cmd.y, cmd.z);
        return ok({ block, pos: { x: cmd.x, y: cmd.y, z: cmd.z } });
      }

      case 'blocks': {
        if (cmd.x1 === undefined) return ok({ error: 'Need x1, y1, z1, x2, y2, z2' });
        const blocks = getBlocks(ctx.chunkCache, cmd.x1, cmd.y1, cmd.z1, cmd.x2, cmd.y2, cmd.z2, cmd.filter);
        return ok({ count: blocks.length, blocks });
      }

      case 'chunks':
        return ok({ chunks: chunkStatus(ctx.chunkCache, ctx.state.pos?.x ?? 0, ctx.state.pos?.z ?? 0, cmd.radius ?? 4) });

      case 'find': {
        if (!cmd.block) return ok({ error: 'Need "block" name pattern' });
        if (!ctx.state.pos) return ok({ error: 'No position' });
        const found = findBlocks(ctx.chunkCache, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, cmd.block, cmd.count ?? 5, cmd.radius ?? 32);
        return ok({ count: found.length, blocks: found });
      }

      case 'scan': {
        const sx = cmd.x ?? ctx.state.pos?.x;
        const sy = cmd.y ?? ctx.state.pos?.y;
        const sz = cmd.z ?? ctx.state.pos?.z;
        if (sx === undefined) return ok({ error: 'No position' });
        return ok(scan(ctx.chunkCache, sx, sy, sz, cmd.radius ?? 4, cmd.radiusY ?? 2, cmd.radius ?? 4));
      }

      case 'compact_scan': {
        const sx = cmd.x ?? ctx.state.pos?.x;
        const sy = cmd.y ?? ctx.state.pos?.y;
        const sz = cmd.z ?? ctx.state.pos?.z;
        if (sx === undefined) return ok({ error: 'No position' });
        return ok(compactScan(ctx.chunkCache, sx, sy, sz, cmd.radius ?? 4, cmd.radiusY ?? 2, cmd.radius ?? 4));
      }

      case 'look': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        return ok(direction(ctx.chunkCache, ctx.state.pos, ctx.state.yaw, ctx.state.pitch, cmd.distance ?? 10));
      }

      case 'raycast': {
        if (!ctx.state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        return ok(raycast(ctx.chunkCache, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, cmd.x, cmd.y ?? ctx.state.pos.y, cmd.z));
      }

      case 'path': {
        if (!ctx.state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        const pGround = getBlock(ctx.chunkCache, Math.floor(ctx.state.pos.x), Math.floor(ctx.state.pos.y) - 1, Math.floor(ctx.state.pos.z));
        if (!pGround) return ok({ error: 'Chunks not loaded at current position — wait for chunks to arrive after teleport' });
        const result = findPath(ctx.chunkCache, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, cmd.x, cmd.y ?? ctx.state.pos.y, cmd.z);
        if (!result) return ok({ error: 'No path found' });
        return ok({ path: result.path, length: result.path.length, distance: result.distance, euclidean: result.euclidean, cost: result.cost, start: ctx.state.pos, end: { x: cmd.x, y: cmd.y ?? ctx.state.pos.y, z: cmd.z } });
      }

      case 'reachable': {
        if (!ctx.state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        const rResult = findPath(ctx.chunkCache, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, cmd.x, cmd.y ?? ctx.state.pos.y, cmd.z, { maxIterations: 3000 });
        const euc = euclideanDistance(ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, cmd.x, cmd.y ?? ctx.state.pos.y, cmd.z);
        if (!rResult) return ok({ reachable: false, distance: null, euclidean: euc, estimatedTime: null });
        return ok({ reachable: true, distance: rResult.distance, euclidean: rResult.euclidean, estimatedTime: rResult.distance * 50 });
      }

      case 'distance': {
        if (!ctx.state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        const tx = cmd.x, ty = cmd.y ?? ctx.state.pos.y, tz = cmd.z;
        const dist = euclideanDistance(ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, tx, ty, tz);
        const dx = tx - ctx.state.pos.x, dy = ty - ctx.state.pos.y, dz = tz - ctx.state.pos.z;
        const len = dist || 1;
        return ok({ euclidean: dist, direction: { x: dx / len, y: dy / len, z: dz / len } });
      }

      case 'walk': {
        if (!ctx.state.pos || cmd.x === undefined) return ok({ error: 'Need target' });
        if (ctx.getActiveWalk()) return ok({ error: 'Already walking — abort_walk first' });
        const tx = cmd.x, ty = cmd.y ?? ctx.state.pos.y, tz = cmd.z;
        if (Math.abs(ctx.state.pos.x - tx) < 1 && Math.abs(ctx.state.pos.y - ty) < 1 && Math.abs(ctx.state.pos.z - tz) < 1) {
          return ok({ walked: 0, pos: ctx.state.pos });
        }
        const wGround = getBlock(ctx.chunkCache, Math.floor(ctx.state.pos.x), Math.floor(ctx.state.pos.y) - 1, Math.floor(ctx.state.pos.z));
        if (!wGround) return ok({ error: 'Chunks not loaded at current position — wait for chunks to arrive after teleport' });
        const autoBuild = cmd.autoBuild !== false;
        const pathOpts = {
          allowPillar: autoBuild,
          allowBridge: autoBuild,
        };
        const wResult = findPath(ctx.chunkCache, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, tx, ty, tz, pathOpts);
        if (!wResult) return ok({ error: 'No path found' });
        const wPath = wResult.path;

        const allSteps = [];
        let simPos = { ...ctx.state.pos };
        for (const wp of wPath) {
          if (wp.x === Math.floor(simPos.x) && wp.y === Math.floor(simPos.y) && wp.z === Math.floor(simPos.z)) continue;
          // Carry move type from path waypoint into steps
          const steps = walkSteps(simPos, wp);
          for (const step of steps) {
            allSteps.push({ ...step, move: wp.move });
            simPos = step;
          }
        }
        if (allSteps.length === 0) return ok({ walked: 0, pos: ctx.state.pos });

        // Helper: place a block at (x,y,z) using best available solid block in inventory
        function autoPlace(x, y, z) {
          if (!ctx.itemPalette) return;
          // Find any solid block in hotbar
          const solidTypes = ['dirt', 'cobblestone', 'stone', 'sand', 'gravel', 'planks', 'log'];
          for (const blockType of solidTypes) {
            const found = ctx.inventory.slots.slice(0, 9).find(s => s && s.name && s.name.replace('minecraft:', '').includes(blockType));
            if (!found) continue;
            const placeInfo = buildPlaceFace(ctx.chunkCache, x, y, z);
            if (!placeInfo) return;
            const slotIdx = ctx.inventory.slots.indexOf(found);
            ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, found, slotIdx, slotIdx, 'inventory'));
            ctx.inventory = { ...ctx.inventory, heldSlot: slotIdx };
            ctx.client.queue('inventory_transaction', buildItemUseTransaction(
              'click_block', 'player_input',
              placeInfo.neighborPos, placeInfo.face,
              ctx.inventory.heldSlot, ctx.itemToRaw(found),
              ctx.state.pos, { x: 0.5, y: 0.5, z: 0.5 }, 0,
            ));
            return;
          }
        }

        const walkId = id;
        let stepIdx = 0;
        const sprint = cmd.sprint === true;
        const stepMs = sprint ? 38 : 50;
        const walkTimer = setInterval(() => {
          if (stepIdx >= allSteps.length) {
            clearInterval(walkTimer);
            ctx.setActiveWalk(null);
            ctx.emitEvent({ type: 'walk_done', id: walkId, walked: allSteps.length, pos: ctx.state.pos });
            return;
          }
          const step = allSteps[stepIdx++];

          // Handle special move types before stepping
          if (step.move === 'pillar') {
            // Place block below current position to stand on, then step up
            autoPlace(Math.floor(ctx.state.pos.x), Math.floor(ctx.state.pos.y), Math.floor(ctx.state.pos.z));
          } else if (step.move === 'bridge') {
            // Place block in the gap (one below the target step position)
            autoPlace(Math.floor(step.x), Math.floor(step.y) - 1, Math.floor(step.z));
          }

          // Face toward step and send analog forward movement input.
          const walkAngles = faceAngles(ctx.state.pos, step);
          ctx.state = { ...ctx.state, yaw: walkAngles.yaw, pitch: walkAngles.pitch };
          ctx.client.queue('player_auth_input', buildPlayerAuthInput(
            ctx.state, step.x, step.y, step.z, walkAngles.yaw, walkAngles.pitch, 'mouse',
            { sprinting: sprint, tick: ctx.getTick(), moveForward: 1 },
          ));
          ctx.state = { ...ctx.state, ...setPosition(ctx.state, step.x, step.y, step.z) };
          ctx.setState(ctx.state);
          ctx.getActiveWalk().stepIdx = stepIdx;
        }, stepMs);

        ctx.setActiveWalk({ timer: walkTimer, id: walkId, steps: allSteps.length, stepIdx: 0, allSteps });
        return ok({ walking: true, steps: allSteps.length, path: wPath });
      }

      case 'abort_walk': {
        const aw = ctx.getActiveWalk();
        if (!aw) return ok({ error: 'Not walking' });
        clearInterval(aw.timer);
        const walked = aw.stepIdx;
        ctx.emitEvent({ type: 'walk_done', id: aw.id, walked, pos: ctx.state.pos, aborted: true });
        ctx.setActiveWalk(null);
        return ok({ aborted: true, walked, pos: ctx.state.pos });
      }

      case 'cmd': {
        if (!ctx.SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const cmdStr = cmd.cmd ?? cmd.command;
        if (!cmdStr) return ok({ error: 'Need cmd field' });
        const parts = ctx.SEND_CMD.split(/\s+/);
        ctx.execFileSync(parts[0], [...parts.slice(1), cmdStr], { timeout: 5000 });
        return ok({ cmd: cmdStr });
      }

      case 'status':
        return ok({
          connected: !!ctx.client.status,
          username: ctx.USERNAME,
          pos: ctx.state.pos,
          uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
          chunks: ctx.chunkCache.chunks.size,
          entities: { players: ctx.tracker.players.size, mobs: ctx.tracker.mobs.size, items: ctx.tracker.items.size },
          emotes: emoteCount(),
          vitals: getVitalsSummary(ctx.vitals),
          lastDeath: ctx.getLastDeath ? ctx.getLastDeath() : null,
        });

      case 'vitals':
        return ok(getVitalsSnapshot(ctx.vitals));

      case 'players': {
        const list = [];
        for (const [, p] of ctx.roster.players) {
          list.push({ name: p.name, uuid: p.uuid, platform: p.platform, joinedAt: p.joinedAt });
        }
        return ok({ players: list, count: list.length });
      }

      case 'inventory': {
        const heldItem = getHeldItem(ctx.inventory);
        const summary = getSummary(ctx.inventory);
        if (cmd.view === 'summary') return ok({ heldSlot: ctx.inventory.heldSlot, heldItem, summary });
        return ok({ slots: ctx.inventory.slots, armor: ctx.inventory.armor, offhand: ctx.inventory.offhand, heldSlot: ctx.inventory.heldSlot, heldItem, summary });
      }

      case 'equip': {
        if (cmd.slot !== undefined) {
          const slot = Number(cmd.slot);
          if (slot < 0 || slot > 8) return ok({ error: 'Slot must be 0-8 (hotbar)' });
          const item = ctx.inventory.slots[slot];
          ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, item, slot, slot, 'inventory'));
          ctx.inventory = { ...ctx.inventory, heldSlot: slot };
          return ok({ equipped: true, slot, item });
        }
        if (cmd.item) {
          if (!ctx.itemPalette) return ok({ error: 'Item palette not loaded yet' });
          const found = findItemByName(ctx.itemPalette, cmd.item);
          if (!found) return ok({ error: `Unknown item: ${cmd.item}` });
          let slotIdx = ctx.inventory.slots.findIndex((s, i) => i <= 8 && s && s.networkId === found.networkId);
          if (slotIdx === -1) {
            slotIdx = ctx.inventory.slots.findIndex((s, i) => i > 8 && s && s.networkId === found.networkId);
            if (slotIdx === -1) return ok({ error: `Item not in inventory: ${cmd.item}` });
            const targetSlot = ctx.inventory.heldSlot;
            const srcItem = ctx.inventory.slots[slotIdx];
            const dstItem = ctx.inventory.slots[targetSlot];
            const actions = [
              { source_id: 'inventory', slot: slotIdx, old_item: ctx.itemToRaw(srcItem), new_item: ctx.itemToRaw(dstItem) },
              { source_id: 'inventory', slot: targetSlot, old_item: ctx.itemToRaw(dstItem), new_item: ctx.itemToRaw(srcItem) },
            ];
            ctx.client.queue('inventory_transaction', buildInventoryTransaction(actions));
            const newSlots = [...ctx.inventory.slots];
            newSlots[targetSlot] = srcItem;
            newSlots[slotIdx] = dstItem;
            ctx.inventory = { ...ctx.inventory, slots: newSlots };
            slotIdx = targetSlot;
          }
          const item = ctx.inventory.slots[slotIdx];
          ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, item, slotIdx, slotIdx, 'inventory'));
          ctx.inventory = { ...ctx.inventory, heldSlot: slotIdx };
          return ok({ equipped: true, slot: slotIdx, item });
        }
        return ok({ error: 'Need "item" name or "slot" number' });
      }

      case 'unequip': {
        const target = cmd.target;
        if (!target) return ok({ error: 'Need "target": helmet|chestplate|leggings|boots|offhand' });
        const armorNames = ['helmet', 'chestplate', 'leggings', 'boots'];
        const armorIdx = armorNames.indexOf(target);
        if (armorIdx !== -1) {
          const armorItem = ctx.inventory.armor[armorIdx];
          if (!armorItem) return ok({ error: `No ${target} equipped` });
          const emptySlot = ctx.inventory.slots.findIndex(s => s === null);
          if (emptySlot === -1) return ok({ error: 'Inventory full' });
          const actions = [
            { source_id: 'armor', slot: armorIdx, old_item: ctx.itemToRaw(armorItem), new_item: { network_id: 0 } },
            { source_id: 'inventory', slot: emptySlot, old_item: { network_id: 0 }, new_item: ctx.itemToRaw(armorItem) },
          ];
          ctx.client.queue('inventory_transaction', buildInventoryTransaction(actions));
          const newArmor = [...ctx.inventory.armor];
          newArmor[armorIdx] = null;
          const newSlots = [...ctx.inventory.slots];
          newSlots[emptySlot] = armorItem;
          ctx.inventory = { ...ctx.inventory, armor: newArmor, slots: newSlots };
          return ok({ unequipped: true, target, item: armorItem, movedToSlot: emptySlot });
        }
        if (target === 'offhand') {
          const offItem = ctx.inventory.offhand;
          if (!offItem) return ok({ error: 'No offhand item equipped' });
          const emptySlot = ctx.inventory.slots.findIndex(s => s === null);
          if (emptySlot === -1) return ok({ error: 'Inventory full' });
          const actions = [
            { source_id: 'offhand', slot: 0, old_item: ctx.itemToRaw(offItem), new_item: { network_id: 0 } },
            { source_id: 'inventory', slot: emptySlot, old_item: { network_id: 0 }, new_item: ctx.itemToRaw(offItem) },
          ];
          ctx.client.queue('inventory_transaction', buildInventoryTransaction(actions));
          const newSlots = [...ctx.inventory.slots];
          newSlots[emptySlot] = offItem;
          ctx.inventory = { ...ctx.inventory, offhand: null, slots: newSlots };
          return ok({ unequipped: true, target, item: offItem, movedToSlot: emptySlot });
        }
        return ok({ error: 'Invalid target. Use: helmet|chestplate|leggings|boots|offhand' });
      }

      case 'mine': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) return ok({ error: 'Need x, y, z' });
        if (ctx.getActiveMine()) return ok({ error: 'Already mining — abort_mine first' });
        const mBlock = getBlock(ctx.chunkCache, cmd.x, cmd.y, cmd.z);
        if (!mBlock || mBlock.name === 'minecraft:air') return ok({ error: 'No block at target' });
        const blockName = mBlock.name || '';

        let mTool = getHeldItem(ctx.inventory);
        if (cmd.autoTool) {
          const bestSlot = findBestTool(ctx.inventory.slots, blockName);
          if (bestSlot !== null && bestSlot !== ctx.inventory.heldSlot) {
            const item = ctx.inventory.slots[bestSlot];
            ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, item, bestSlot, bestSlot, 'inventory'));
            ctx.inventory = { ...ctx.inventory, heldSlot: bestSlot };
            mTool = item;
          }
        }

        const mAngles = faceAngles(ctx.state.pos, { x: cmd.x + 0.5, y: cmd.y + 0.5, z: cmd.z + 0.5 });
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, mAngles.pitch, mAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, mAngles.yaw, mAngles.pitch) };

        const breakTicks = getBreakTime(blockName, mTool);
        if (breakTicks === Infinity) return ok({ error: 'Block is unbreakable' });

        const mPos = { x: cmd.x, y: cmd.y, z: cmd.z };
        const mFace = 1;
        // Server-authoritative block breaking: actions ride the continuous 20Hz
        // player_auth_input heartbeat (managed in bot.js). We inject start_break now,
        // continue_break each tick while breaking, then predict_break when done.
        ctx.queueBlockAction('start_break', mPos, mFace);

        const mineId = id;
        const breakMs = breakTicks * 50;
        const startedAt = Date.now();
        const crackTimer = setInterval(() => {
          if (Date.now() - startedAt >= breakMs) {
            clearInterval(crackTimer);
            ctx.queueBlockAction('predict_break', mPos, mFace);
            ctx.setActiveMine(null);
            // The break is server-authoritative: predict_break only destroys the block
            // if the server agrees. Give the server a moment to send update_subchunk_blocks,
            // then verify the block actually became air before reporting success.
            setTimeout(() => {
              const after = getBlock(ctx.chunkCache, mPos.x, mPos.y, mPos.z);
              const confirmed = !after || after.name === 'minecraft:air';
              ctx.emitEvent({
                type: 'mine_done', id: mineId, block: blockName, pos: mPos,
                ticks: breakTicks, confirmed,
                ...(confirmed ? {} : { note: 'server did not confirm break (block still present)' }),
              });
            }, 300);
          } else {
            ctx.queueBlockAction('continue_break', mPos, mFace);
          }
        }, 50);

        ctx.setActiveMine({ timer: null, crackTimer, id: mineId, pos: mPos, block: blockName });
        return ok({ mining: true, block: blockName, breakTime: breakTicks, tool: mTool?.name || null });
      }

      case 'abort_mine': {
        const am = ctx.getActiveMine();
        if (!am) return ok({ error: 'Not mining' });
        clearTimeout(am.timer);
        clearInterval(am.crackTimer);
        ctx.queueBlockAction('abort_break', am.pos, 0);
        ctx.setActiveMine(null);
        return ok({ aborted: true });
      }

      case 'eat': {
        if (ctx.getActiveEat()) return ok({ error: 'Already eating — abort_eat first' });
        if (cmd.item) {
          if (!ctx.itemPalette) return ok({ error: 'Item palette not loaded yet' });
          const found = findItemByName(ctx.itemPalette, cmd.item);
          if (!found) return ok({ error: `Unknown item: ${cmd.item}` });
          let slotIdx = ctx.inventory.slots.findIndex((s, i) => i <= 8 && s && s.networkId === found.networkId);
          if (slotIdx === -1) slotIdx = ctx.inventory.slots.findIndex(s => s && s.networkId === found.networkId);
          if (slotIdx === -1) return ok({ error: `Item not in inventory: ${cmd.item}` });
          if (slotIdx !== ctx.inventory.heldSlot) {
            if (slotIdx > 8) {
              const targetSlot = ctx.inventory.heldSlot;
              const srcItem = ctx.inventory.slots[slotIdx];
              const dstItem = ctx.inventory.slots[targetSlot];
              const actions = [
                { source_id: 'inventory', slot: slotIdx, old_item: ctx.itemToRaw(srcItem), new_item: ctx.itemToRaw(dstItem) },
                { source_id: 'inventory', slot: targetSlot, old_item: ctx.itemToRaw(dstItem), new_item: ctx.itemToRaw(srcItem) },
              ];
              ctx.client.queue('inventory_transaction', buildInventoryTransaction(actions));
              const newSlots = [...ctx.inventory.slots];
              newSlots[targetSlot] = srcItem;
              newSlots[slotIdx] = dstItem;
              ctx.inventory = { ...ctx.inventory, slots: newSlots };
              slotIdx = targetSlot;
            }
            const item = ctx.inventory.slots[slotIdx];
            ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, item, slotIdx, slotIdx, 'inventory'));
            ctx.inventory = { ...ctx.inventory, heldSlot: slotIdx };
          }
        }

        const eatItem = getHeldItem(ctx.inventory);
        if (!eatItem) return ok({ error: 'No item in hand' });
        const eatName = (eatItem.displayName || eatItem.name || '').replace(/^minecraft:/, '');
        if (!isFood(eatName)) return ok({ error: `${eatName} is not food` });

        ctx.client.queue('player_action', buildPlayerAction(ctx.state.runtimeId, 'start_using_item', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0));

        const eatId = id;
        const eatTimer = setTimeout(() => {
          ctx.client.queue('inventory_transaction', buildItemReleaseTransaction('consume', ctx.inventory.heldSlot, ctx.itemToRaw(getHeldItem(ctx.inventory)), ctx.state.pos));
          ctx.setActiveEat(null);
          ctx.emitEvent({ type: 'eat_done', id: eatId, item: eatName });
        }, 1610);

        ctx.setActiveEat({ timer: eatTimer, id: eatId, item: eatName });
        return ok({ eating: true, item: eatName, duration: 1610 });
      }

      case 'abort_eat': {
        const ae = ctx.getActiveEat();
        if (!ae) return ok({ error: 'Not eating' });
        clearTimeout(ae.timer);
        ctx.setActiveEat(null);
        return ok({ aborted: true });
      }

      case 'drop': {
        const dropSlot = cmd.slot !== undefined ? Number(cmd.slot) : ctx.inventory.heldSlot;
        if (dropSlot < 0 || dropSlot >= 36) return ok({ error: 'Invalid slot' });
        const dropItem = ctx.inventory.slots[dropSlot];
        if (!dropItem) return ok({ error: 'No item in slot ' + dropSlot });
        const dropCount = cmd.count !== undefined ? Math.min(Number(cmd.count), dropItem.count) : dropItem.count;

        if (dropSlot !== ctx.inventory.heldSlot && dropSlot <= 8) {
          ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, dropItem, dropSlot, dropSlot, 'inventory'));
          ctx.inventory = { ...ctx.inventory, heldSlot: dropSlot };
        }

        ctx.client.queue('player_action', buildPlayerAction(ctx.state.runtimeId, 'drop_item', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, dropCount));

        const newSlots = [...ctx.inventory.slots];
        if (dropCount >= dropItem.count) { newSlots[dropSlot] = null; }
        else { newSlots[dropSlot] = { ...dropItem, count: dropItem.count - dropCount }; }
        ctx.inventory = { ...ctx.inventory, slots: newSlots };
        return ok({ dropped: true, item: dropItem.name, count: dropCount });
      }

      case 'throw': {
        const throwItem = getHeldItem(ctx.inventory);
        if (!throwItem) return ok({ error: 'No item in hand' });
        const throwName = (throwItem.displayName || throwItem.name || '').replace(/^minecraft:/, '');
        if (!isThrowable(throwName)) return ok({ error: `${throwName} is not throwable` });

        if (cmd.x !== undefined && cmd.y !== undefined && cmd.z !== undefined) {
          const tAngles = faceAngles(ctx.state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
          ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, tAngles.pitch, tAngles.yaw, 'rotation'));
          ctx.state = { ...ctx.state, ...setRotation(ctx.state, tAngles.yaw, tAngles.pitch) };
        }

        ctx.client.queue('inventory_transaction', buildItemUseTransaction('click_air', 'player_input', { x: 0, y: 0, z: 0 }, 0, ctx.inventory.heldSlot, ctx.itemToRaw(throwItem), ctx.state.pos, { x: 0, y: 0, z: 0 }, 0));

        const tSlots = [...ctx.inventory.slots];
        const tSlot = ctx.inventory.heldSlot;
        if (throwItem.count <= 1) { tSlots[tSlot] = null; }
        else { tSlots[tSlot] = { ...throwItem, count: throwItem.count - 1 }; }
        ctx.inventory = { ...ctx.inventory, slots: tSlots };
        return ok({ thrown: true, item: throwItem.name });
      }

      case 'give': {
        if (!cmd.to) return ok({ error: 'Need "to" player name' });
        if (!ctx.state.pos) return ok({ error: 'No position' });

        let giveTarget = null;
        for (const [, p] of ctx.tracker.players) {
          if (p.name && p.name.toLowerCase() === cmd.to.toLowerCase()) { giveTarget = p; break; }
        }
        if (!giveTarget) return ok({ error: 'Player not found nearby' });
        if (!giveTarget.position) return ok({ error: 'Player position unknown' });

        const giveDist = Math.sqrt((ctx.state.pos.x - giveTarget.position.x) ** 2 + (ctx.state.pos.y - giveTarget.position.y) ** 2 + (ctx.state.pos.z - giveTarget.position.z) ** 2);
        if (giveDist > 16) return ok({ error: `Player too far (${Math.round(giveDist)} blocks)` });

        if (cmd.item) {
          if (!ctx.itemPalette) return ok({ error: 'Item palette not loaded yet' });
          const found = findItemByName(ctx.itemPalette, cmd.item);
          if (!found) return ok({ error: `Unknown item: ${cmd.item}` });
          let slotIdx = ctx.inventory.slots.findIndex((s, i) => i <= 8 && s && s.networkId === found.networkId);
          if (slotIdx === -1) slotIdx = ctx.inventory.slots.findIndex(s => s && s.networkId === found.networkId);
          if (slotIdx === -1) return ok({ error: `Item not in inventory: ${cmd.item}` });
          if (slotIdx !== ctx.inventory.heldSlot) {
            const item = ctx.inventory.slots[slotIdx];
            ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, item, slotIdx, slotIdx, 'inventory'));
            ctx.inventory = { ...ctx.inventory, heldSlot: slotIdx };
          }
        }

        const giveItem = getHeldItem(ctx.inventory);
        if (!giveItem) return ok({ error: 'No item in hand' });

        const gAngles = faceAngles(ctx.state.pos, giveTarget.position);
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, gAngles.pitch, gAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, gAngles.yaw, gAngles.pitch) };

        const giveCount = cmd.count !== undefined ? Math.min(Number(cmd.count), giveItem.count) : 1;
        ctx.client.queue('player_action', buildPlayerAction(ctx.state.runtimeId, 'drop_item', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, giveCount));

        const gSlots = [...ctx.inventory.slots];
        const gSlot = ctx.inventory.heldSlot;
        if (giveCount >= giveItem.count) { gSlots[gSlot] = null; }
        else { gSlots[gSlot] = { ...giveItem, count: giveItem.count - giveCount }; }
        ctx.inventory = { ...ctx.inventory, slots: gSlots };
        return ok({ given: true, to: cmd.to, item: giveItem.name, count: giveCount, distance: Math.round(giveDist) });
      }

      case 'interact': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) return ok({ error: 'Need x, y, z' });
        const iBlock = getBlock(ctx.chunkCache, cmd.x, cmd.y, cmd.z);
        if (!iBlock || iBlock.name === 'minecraft:air') return ok({ error: 'No block at target' });
        if (!isInteractable(iBlock.name)) return ok({ error: `${iBlock.name} is not interactable` });

        const iAngles = faceAngles(ctx.state.pos, { x: cmd.x + 0.5, y: cmd.y + 0.5, z: cmd.z + 0.5 });
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, iAngles.pitch, iAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, iAngles.yaw, iAngles.pitch) };

        ctx.client.queue('inventory_transaction', buildItemUseTransaction('click_block', 'player_input', { x: cmd.x, y: cmd.y, z: cmd.z }, 0, ctx.inventory.heldSlot, ctx.itemToRaw(getHeldItem(ctx.inventory)), ctx.state.pos, { x: 0.5, y: 0.5, z: 0.5 }, iBlock.stateId || 0));
        return ok({ interacted: true, block: iBlock.name, pos: { x: cmd.x, y: cmd.y, z: cmd.z } });
      }

      case 'sleep': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) return ok({ error: 'Need x, y, z' });
        const bedBlock = getBlock(ctx.chunkCache, cmd.x, cmd.y, cmd.z);
        if (!bedBlock || bedBlock.name === 'minecraft:air') return ok({ error: 'No block at target position' });
        if (!bedBlock.name || !bedBlock.name.includes('bed')) return ok({ error: `Block at target is not a bed: ${bedBlock.name}` });

        const sAngles = faceAngles(ctx.state.pos, { x: cmd.x + 0.5, y: cmd.y + 0.5, z: cmd.z + 0.5 });
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, sAngles.pitch, sAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, sAngles.yaw, sAngles.pitch) };

        ctx.client.queue('inventory_transaction', buildItemUseTransaction('click_block', 'player_input', { x: cmd.x, y: cmd.y, z: cmd.z }, 1, ctx.inventory.heldSlot, ctx.itemToRaw(getHeldItem(ctx.inventory)), ctx.state.pos, { x: 0.5, y: 0.5, z: 0.5 }, bedBlock.stateId || 0));
        ctx.emitEvent({ type: 'sleep_started', bedPos: { x: cmd.x, y: cmd.y, z: cmd.z } });
        return ok({ sleeping: true, bedPos: { x: cmd.x, y: cmd.y, z: cmd.z }, block: bedBlock.name });
      }

      case 'place': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) return ok({ error: 'Need x, y, z' });
        if (!cmd.item) return ok({ error: 'Need "item" block name' });
        if (!ctx.itemPalette) return ok({ error: 'Item palette not loaded yet' });

        // Validate target is air (or unloaded — allow placement in unloaded areas)
        const targetBlock = getBlock(ctx.chunkCache, cmd.x, cmd.y, cmd.z);
        if (targetBlock && targetBlock.name !== 'minecraft:air') {
          return ok({ error: `Target position is not air: ${targetBlock.name}` });
        }

        // Find and equip the block item
        const found = findItemByName(ctx.itemPalette, cmd.item);
        if (!found) return ok({ error: `Unknown item: ${cmd.item}` });
        let placeSlot = ctx.inventory.slots.findIndex((s, i) => i <= 8 && s && s.networkId === found.networkId);
        if (placeSlot === -1) placeSlot = ctx.inventory.slots.findIndex(s => s && s.networkId === found.networkId);
        if (placeSlot === -1) return ok({ error: `Item not in inventory: ${cmd.item}` });

        if (placeSlot !== ctx.inventory.heldSlot) {
          const pItem = ctx.inventory.slots[placeSlot];
          ctx.client.queue('mob_equipment', buildMobEquipment(ctx.state.runtimeId, pItem, placeSlot, placeSlot, 'inventory'));
          ctx.inventory = { ...ctx.inventory, heldSlot: placeSlot };
        }

        // Determine face: explicit override or auto-detect
        const facePref = cmd.face !== undefined ? Number(cmd.face) : undefined;
        const placeInfo = buildPlaceFace(ctx.chunkCache, cmd.x, cmd.y, cmd.z, facePref);
        if (!placeInfo) return ok({ error: 'No adjacent solid block to place against' });

        // Face the target position
        const pAngles = faceAngles(ctx.state.pos, { x: cmd.x + 0.5, y: cmd.y + 0.5, z: cmd.z + 0.5 });
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, pAngles.pitch, pAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, pAngles.yaw, pAngles.pitch) };

        const heldItem = getHeldItem(ctx.inventory);
        ctx.client.queue('inventory_transaction', buildItemUseTransaction(
          'click_block', 'player_input',
          placeInfo.neighborPos, placeInfo.face,
          ctx.inventory.heldSlot, ctx.itemToRaw(heldItem),
          ctx.state.pos, { x: 0.5, y: 0.5, z: 0.5 },
          heldItem?.blockRuntimeId || 0,
        ));

        return ok({ placed: true, block: cmd.item, pos: { x: cmd.x, y: cmd.y, z: cmd.z }, face: placeInfo.face, against: placeInfo.neighborPos });
      }

      case 'attack': {
        if (!ctx.state.pos) return ok({ error: 'No position' });
        if (!cmd.entity) return ok({ error: 'Need "entity" (player name or runtime ID)' });

        let atkEntity = null;
        let atkRid = null;
        if (typeof cmd.entity === 'string') {
          for (const [, p] of ctx.tracker.players) {
            if (p.name && p.name.toLowerCase() === cmd.entity.toLowerCase()) { atkEntity = p; atkRid = p.runtimeId; break; }
          }
          if (!atkEntity) {
            for (const [, m] of ctx.tracker.mobs) {
              if (m.name && m.name.toLowerCase() === cmd.entity.toLowerCase()) { atkEntity = m; atkRid = m.runtimeId; break; }
            }
          }
        } else {
          const rid = Number(cmd.entity);
          const loc = ctx.tracker._ridIndex.get(rid);
          if (loc) { atkEntity = ctx.tracker[loc.map]?.get(loc.key); atkRid = rid; }
        }
        if (!atkEntity) return ok({ error: 'Entity not found' });
        if (!atkEntity.position) return ok({ error: 'Entity position unknown' });

        const atkDist = Math.sqrt((ctx.state.pos.x - atkEntity.position.x) ** 2 + (ctx.state.pos.y - atkEntity.position.y) ** 2 + (ctx.state.pos.z - atkEntity.position.z) ** 2);
        if (atkDist > 5) return ok({ error: `Entity too far (${Math.round(atkDist)} blocks)` });

        const aAngles = faceAngles(ctx.state.pos, atkEntity.position);
        ctx.client.queue('move_player', buildMovePlayer(ctx.state, ctx.state.pos.x, ctx.state.pos.y, ctx.state.pos.z, aAngles.pitch, aAngles.yaw, 'rotation'));
        ctx.state = { ...ctx.state, ...setRotation(ctx.state, aAngles.yaw, aAngles.pitch) };

        ctx.client.queue('inventory_transaction', buildItemUseOnEntityTransaction(atkRid, 'attack', ctx.inventory.heldSlot, ctx.itemToRaw(getHeldItem(ctx.inventory)), ctx.state.pos, atkEntity.position));
        return ok({ attacked: true, entity: { name: atkEntity.name, runtimeId: atkRid }, distance: Math.round(atkDist) });
      }

      case 'subscribe': {
        if (!cmd.event) return ok({ error: 'Need "event" type' });
        const result = subscribe(ctx.subscriptions, cmd.event, { radius: cmd.radius });
        if (result.error) return ok({ error: result.error });
        ctx.setSubscriptions(result.state);
        return ok({ subscribed: result.subscribed, radius: result.radius });
      }

      case 'unsubscribe': {
        if (!cmd.event) return ok({ error: 'Need "event" type' });
        const result = unsubscribe(ctx.subscriptions, cmd.event);
        if (result.error) return ok({ error: result.error });
        ctx.setSubscriptions(result.state);
        return ok({ unsubscribed: result.unsubscribed });
      }

      case 'subscriptions':
        return ok(listSubscriptions(ctx.subscriptions));

      default:
        return ok({ error: `Unknown action: ${cmd.action}` });
    }
  } catch (e) {
    ok({ error: e.message });
  }
}
