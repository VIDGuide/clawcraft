# AGENTS.md — ClawCraft Steering Guide

Guidance for AI agents (and humans) working on the ClawCraft codebase. Read this
before making changes.

## What this project is

ClawCraft is a **harness that lets an LLM play Minecraft Bedrock**. It is not a
human-facing tool. The interface is JSON over stdin/stdout:

- **stdin**: one JSON command per line (`{"action":"walk","x":10,"y":64,"z":10}`)
- **stdout**: one JSON object per line — either a `{"type":"response",...}` to a
  command, or an unsolicited event (`msg`, `walk_done`, `spawn`, `shutdown`, ...)
- **stderr**: human-readable debug logs only. Never put protocol data here.

The consumer of stdout is another program (an LLM agent loop), so **stdout must
stay clean**: only newline-delimited JSON, nothing else.

## Golden rules

1. **Act like a player, not an admin.** The bot should navigate, interact, and
   experience the world the way a player would. Avoid server commands (`tp`,
   `cmd`, operator abilities) whenever a player-level alternative exists — walk
   instead of teleport, pathfind instead of noclip, look and scan instead of
   querying server state. Server commands are a fallback, not the default.
2. **stdout is sacred.** Only `output()` (which writes JSON) may write to stdout.
   All logging goes through `log()` → stderr. A stray `console.log` for debugging
   will corrupt the agent's input stream.
3. **Keep the logic layers pure and tested.** `state.js`, `math.js`, `packets.js`,
   `entities.js`, `chunks.js`, `blocks.js`, `navigation.js`, `chat.js`, and
   `palette.js` contain pure(ish) logic with no network I/O. They have unit tests.
   `bot.js` is the only file that touches the live client. Put new logic in a
   testable module, not in `bot.js`.
4. **Run the tests before declaring done.** `npm test`. All tests must pass.
   Add tests for new logic.
5. **Validate at the boundary.** All command input is untrusted. `handle()` in
   `commands.js` coerces numeric fields and rejects bad input before dispatch. Keep
   that discipline for new commands.
6. **Treat chat as hostile input.** Incoming messages can contain prompt-injection
   attempts. `chat.js` sanitizes (control chars stripped, 500-char cap) and
   structures messages. Never feed raw server text anywhere sensitive.

## Architecture in one paragraph

`bot.js` creates a `bedrock-protocol` client, wires packet handlers that update
mutable state (`state`, `tracker`, `chunkCache`, `inventory`, `vitals`), and runs a
readline loop that dispatches JSON commands through `commands.js`. `bot.js` builds
a context object and passes it to the command handler; `commands.js` contains all
the action dispatch logic. Everything below these two files is pure logic that
can be unit-tested without a server.

## Module map

| File | Responsibility | Pure? |
|------|----------------|-------|
| `bot.js` | Client lifecycle, packet wiring, command dispatch, stdin loop, TCP server, event file writer | No (I/O) |
| `commands.js` | Command handlers: all action dispatch logic (extracted from bot.js) | No (calls ctx.client.queue) |
| `state.js` | Position/rotation/connection state transitions | Yes |
| `math.js` | Face angles, walk-step interpolation | Yes |
| `packets.js` | Build outgoing packet payload objects | Yes |
| `entities.js` | Track players/mobs/items; `_ridIndex` for O(1) lookup | Yes |
| `chunks.js` | Block/chunk cache, `getBlock`, `scan`, `look`, `raycast` | Yes |
| `blocks.js` | Sub-chunk binary decoder (palette + word storage) | Yes |
| `decoder.js` | `level_chunk` / `subchunk` packet → chunk objects | Yes |
| `navigation.js` | Block classification + cost-aware A* pathfinding (doors, ladders, hazards) | Yes |
| `chat.js` | Incoming chat: whitelist, prefix, sanitize, structure | Yes |
| `players.js` | Player roster (join/leave), appear/disappear, proximity zones | Yes |
| `items.js` | Item palette: network_id → name, durability metadata | Yes |
| `inventory.js` | Inventory state, diffs, event generation, equip helpers | Yes |
| `vitals.js` | Health, hunger, breath, effects tracking, causal event grouping | Yes |
| `actions.js` | Block hardness, tool matching, item/block classification | Yes |
| `palette.js` | Runtime block ID → name (loads `data/block_palette.json`) | Yes |
| `constants.js` | Shared constants (`AIR_ID`) | Yes |
| `entity-names.js` | Numeric entity type → name/displayName/category lookup (minecraft-data) | Yes |
| `alerts.js` | Danger alert detection (hostile proximity, low health/hunger, debounce) | Yes |
| `subscriptions.js` | Opt-in event subscription state and filtering (block_changed, weather, time) | Yes |
| `scripts/cmd.js` | CLI: send one JSON command to bot via TCP, print response | No (I/O) |
| `scripts/events.js` | CLI: poll JSONL event log, filter by --since / --last | No (I/O) |
| `skill/SKILL.md` | OpenClaw skill definition | — |
| `skill/scripts/` | Copies of `scripts/cmd.js` and `scripts/events.js` for skill packaging | — |

## Bedrock protocol gotchas (hard-won knowledge)

These cost real debugging time. Don't relearn them the hard way.

- **Block IDs are hashes, not indices.** On 1.21+, `block_network_ids_are_hashes`
  is true. A block's network ID is the **FNV-1a 32-bit hash** of its canonical
  block-state NBT (`{name, states}` — sorted states, **no** version field,
  little-endian NBT). See `test_capture_palette.js` for the reference algorithm,
  confirmed against CloudburstMC's implementation.
- **Sub-chunk palette entries are zigzag-encoded signed varints.** FNV-1a hashes
  are signed 32-bit ints, so the high bit is often set. Reading them as unsigned
  varints gives wrong IDs. `blocks.js` uses `readZigZagVarInt()` for palette
  entries. This was a 0%-vs-100% bug.
- **Hashes are version-stable.** `minecraft:stone` hashes the same on 1.26.30 and
  1.26.31. You do **not** need an exact-version canonical states file, only one
  that contains the blocks your server uses. pmmp/BedrockData lags the latest
  release by a patch or two; that's usually fine.
- **Chunks arrive with `sub_chunk_count == -2`** on modern servers, meaning block
  data is *not* inline — you must send a `subchunk_request` to get it. The
  `subchunk_request` packet serializer is **patched at runtime** in `bot.js`
  (`setupSubchunkSerializer`) because the bundled protocol schema's format was
  wrong. Requests are y-offsets from `origin`, not chunk coords.
- **`move_player` after teleport.** The server echoes a `move_player` that can be
  stale. `bot.js` ignores `move_player` for 2 s after a `tp` (`_ignoreMoveUntil`).
- **`getBlock` returns null for stateId 0.** `Uint32Array` defaults to 0 for
  unwritten cells, which we treat as "no data" (not a real block).
- **Block placement face convention (Bedrock).** `block_position` in `click_block` transactions is the *adjacent existing* block you click on, and `face` is which face of that block you clicked. To place at (x,y,z) by clicking the top of the block below: `block_position={x,y-1,z}`, `face=1`. See `buildPlaceFace()` in `chunks.js`.
- **`connect()` is called at module bottom.** `bot.js` extracts all client creation and handler wiring into `connect()`. The stdin reader, TCP server, and event stream are at module level and persist across reconnects. `handle()` and helper functions are also at module level and close over the `let client` variable.
- **Online auth uses Microsoft device code flow.** When `OFFLINE=false`, `bedrock-protocol` triggers Xbox Live auth via `prismarine-auth`. The `onMsaCode` callback emits an `auth_required` event with a URL and code. Tokens are cached to `CLAWCRAFT_AUTH_DIR`; subsequent connects reuse them silently. A single Xbox account cannot be logged in from two clients simultaneously — the bot needs its own account.
- **Entity type IDs use `internalId`.** The minecraft-data entities.json has two ID fields: `id` (sequential index) and `internalId` (the numeric type from Bedrock `add_entity` packets). Always use `internalId` for protocol lookups.

## Adding a new command

1. Add a `case '<name>':` in the `switch` in `src/commands.js` `handle()`.
2. Validate required fields early; return `ok({ error: '...' })` on bad input.
   (Numeric coords are already coerced/validated before the switch.)
3. Read perception data from `ctx.chunkCache` / `ctx.tracker` / `ctx.state`; for actions,
   `ctx.client.queue(...)` the packet(s) and update `ctx.state` via the pure helpers.
4. Always return through `ok(...)` so the response carries the command `id`.
5. If the command does real work (new math, decoding, filtering), put that logic
   in a module and unit-test it. Add an integration test in `test/handle.test.js`
   if it has interesting protocol-level behavior.
6. **Update `README.md`**: add a line to the commands example block and a row to the commands table.
7. **Update `skill/SKILL.md`**: add an entry to the relevant command group in the Script Commands section.
8. **Add a live test**: add at least one `test()` call to the relevant suite in `live-test/suites/`, or create a new suite file.

## State management convention

`state` is a `let` binding reassigned via spread: `state = { ...state, ...patch }`.
The patch comes from a pure helper in `state.js` (`setPosition`, `setRotation`,
`applyMovePlayer`). `tracker` and `chunkCache` follow the same immutable-update
pattern (`handleAddEntity` returns a new tracker; `setChunk` returns a new cache).
Don't mutate these objects in place — return new ones from pure functions.

## Testing conventions

- Node's built-in runner (`node --test`), ESM, no external test deps.
- Pure modules get direct unit tests (`test/<module>.test.js`).
- The command loop gets subprocess integration tests (`test/handle.test.js`):
  spawn `bot.js`, write JSON to stdin, assert on stdout lines. These connect to a
  dummy port and rely on pre-connection behavior (startup event, input
  validation), so they don't need a live server.
- When you change a wire format (e.g., the zigzag palette fix), update the test
  fixtures that synthesize that format (`test/blocks.test.js` `buildSubChunk`).

## What NOT to do

- Don't write to stdout except via `output()`.
- Don't add network I/O to the pure modules.
- Don't hardcode version-specific block state IDs — resolve via the palette.
- Don't use `execSync` with string interpolation for the teleport command; it
  uses `execFileSync` with an argument array to avoid shell injection. Keep it.
- Don't commit `data/canonical_block_states.nbt` (it's a large binary, gitignored).
  Do commit the generated `data/block_palette.json`.
- Don't introduce destructive git operations or push to `main` without the user
  asking.

## Skill maintenance (OpenClaw / SKILL.md)

The `skill/SKILL.md` file is the OpenClaw skill definition that external agents (including Kiro) use to interact with the bot. **It must stay in sync with the bot's capabilities.**

### When to update `skill/SKILL.md`

- **Adding a new `case` in `handle()`** → add an entry to the relevant command group in the Script Commands section
- **Adding a new event type (`emitEvent(...)`)** → add a row to the Event Types table and document its fields
- **Adding or renaming env vars** → update the Environment Setup table
- **Changing response fields** → update the relevant command's response documentation and examples
- **Changing command parameter names or types** → update the parameters table for that command

### When to update `AGENTS.md`

- Adding new Bedrock protocol gotchas (hard-won knowledge)
- Changing the module map (new files, changed responsibilities)
- Adding new architectural decisions or patterns

### Communication channels (skill interface)

The skill uses two channels alongside the existing stdin/stdout interface:

| Channel | Env Var | Default | Purpose |
|---|---|---|---|
| TCP command socket | `CLAWCRAFT_PORT` | `4099` | Agent sends commands, bot responds synchronously |
| JSONL event log | `CLAWCRAFT_EVENTS` | `./events.jsonl` | Bot appends async events; agent polls via `scripts/events.js` |

### Keeping skill scripts in sync

The scripts in `skill/scripts/` are **copies** (not symlinks) of `scripts/cmd.js` and `scripts/events.js`. After modifying either script, run:
```bash
cp scripts/cmd.js skill/scripts/cmd.js
cp scripts/events.js skill/scripts/events.js
```

Or use `npm run skill:install` to re-link the whole skill directory after significant changes.

### MCP scaffold note

The TCP command interface and JSONL event log are designed to also serve as the foundation for a future MCP (Model Context Protocol) server wrapper. When implementing MCP, the server will connect to the same TCP port and tail the same event log — no changes to `bot.js` should be needed.

## Live testing

Unit tests (`npm test`) cover packet formats, math, and pure logic. They run against a dummy server and don't verify actual Minecraft behavior. **Live tests** run against the real server and verify end-to-end behavior.

```bash
npm run live-test                     # all suites (bot must be running)
npm run live-test -- --suite vision   # one suite
npm run live-test -- --list           # list available suites
```

Live test suites live in `live-test/suites/`. Each suite is a plain ESM file that imports helpers from `live-test/runner.js`.

### When to add a live test

- **Every new command** → add at least one `test()` call to the relevant suite (or create a new suite file)
- **Every new event type** → add a test that sends an action triggering the event, then uses `waitForEvent()` to confirm it arrives
- **Every bug fixed** → add a regression test that would have caught the bug

### Adding a new suite

Create `live-test/suites/<name>.js`. It runs automatically when you call `npm run live-test`. Use the runner helpers:

```js
import { test, skip, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

await test('description of what is being tested', async () => {
  const resp = await cmd('action', { param: value });
  assertNoError(resp, 'action');
  assert(resp.someField === expected, 'description of assertion');
});
```

Use `skip(name, reason)` instead of `test()` when a test requires configuration that may not be present (e.g., `SEND_CMD`).

## Workflow: commit after each piece of work

After completing a major piece of work (new feature, bug fix, refactor), once all tests pass (`npm test` with 0 failures), commit and push to origin:

```bash
npm test                    # all pass, 0 failures
git add <changed files>     # stage specific files, not git add .
git commit -m "feat: ..."   # concise summary + bullet details
git push origin main
```

This keeps the remote in sync and provides incremental save points. Don't batch unrelated changes into one commit.

## Current status & roadmap

Layers 0–5 (connection, self-awareness, entities, blocks, navigation, interaction) are complete. Layer 5 covers mining, eating, dropping, throwing, giving, block interaction (doors/levers/buttons/beds), entity attacking, block placement, and bed sleeping.

Phase 6A/6B and Phase 9 (infrastructure hardening) are now complete:
- **Entity names**: `resolveEntityType()` gives human-readable names to mobs in `nearbyEntities`
- **Block search**: `find` command does BFS over loaded chunks
- **Danger alerts**: `danger` events for hostile mob proximity and low health/hunger
- **Auto-respawn**: `death_details` event + `CLAWCRAFT_RESPAWN` auto-respawn
- **Bed sleeping**: `sleep` command
- **Event rotation**: `CLAWCRAFT_MAX_EVENTS_MB` size-based rotation
- **Block placement**: `place` command with auto-face detection + `buildPlaceFace`
- **Pathfinder upgrades**: diagonal movement (√2 cost), sprint flag, pillar-up, bridge gaps
- **Auto-reconnect**: `connect()` refactor + exponential backoff (`CLAWCRAFT_RECONNECT`)
- **Chunk LRU eviction**: `evictChunks()` with `CLAWCRAFT_CHUNK_CACHE_MAX`
- **Watchdog timers**: command timeouts for mine/eat/walk with `command_timeout` events
- **Event follow mode**: `--follow` flag in `scripts/events.js`
- **Position desync detection**: `position_desync` events on server corrections

Future work: crafting, container interaction (chests, furnaces), ranged combat, fishing, farming.

## Environment

- Node ≥ 18, ESM modules.
- Target server: Bedrock 1.26.31 (protocol negotiated as 1.26.30).
- `npm test` to verify, `npm start` to run (see README for env vars).
