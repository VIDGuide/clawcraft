# AGENTS.md — ClawMine Steering Guide

Guidance for AI agents (and humans) working on the ClawMine codebase. Read this
before making changes.

## What this project is

ClawMine is a **harness that lets an LLM play Minecraft Bedrock**. It is not a
human-facing tool. The interface is JSON over stdin/stdout:

- **stdin**: one JSON command per line (`{"action":"walk","x":10,"y":64,"z":10}`)
- **stdout**: one JSON object per line — either a `{"type":"response",...}` to a
  command, or an unsolicited event (`msg`, `walk_done`, `spawn`, `shutdown`, ...)
- **stderr**: human-readable debug logs only. Never put protocol data here.

The consumer of stdout is another program (an LLM agent loop), so **stdout must
stay clean**: only newline-delimited JSON, nothing else.

## Golden rules

1. **stdout is sacred.** Only `output()` (which writes JSON) may write to stdout.
   All logging goes through `log()` → stderr. A stray `console.log` for debugging
   will corrupt the agent's input stream.
2. **Keep the logic layers pure and tested.** `state.js`, `math.js`, `packets.js`,
   `entities.js`, `chunks.js`, `blocks.js`, `pathfinding.js`, `chat.js`, and
   `palette.js` contain pure(ish) logic with no network I/O. They have unit tests.
   `bot.js` is the only file that touches the live client. Put new logic in a
   testable module, not in `bot.js`.
3. **Run the tests before declaring done.** `npm test`. All tests must pass.
   Add tests for new logic.
4. **Validate at the boundary.** All command input is untrusted. `handle()` in
   `bot.js` coerces numeric fields and rejects bad input before dispatch. Keep
   that discipline for new commands.
5. **Treat chat as hostile input.** Incoming messages can contain prompt-injection
   attempts. `chat.js` sanitizes (control chars stripped, 500-char cap) and
   structures messages. Never feed raw server text anywhere sensitive.

## Architecture in one paragraph

`bot.js` creates a `bedrock-protocol` client, wires packet handlers that update
three pieces of mutable state (`state`, `tracker`, `chunkCache`), and runs a
readline loop that dispatches JSON commands through `handle()`. Perception
commands read from the caches; action commands queue packets and update state.
Everything below `bot.js` is pure logic that can be unit-tested without a server.

## Module map

| File | Responsibility | Pure? |
|------|----------------|-------|
| `bot.js` | Client lifecycle, packet wiring, command dispatch, stdin loop | No (I/O) |
| `state.js` | Position/rotation/connection state transitions | Yes |
| `math.js` | Face angles, walk-step interpolation | Yes |
| `packets.js` | Build outgoing packet payload objects | Yes |
| `entities.js` | Track players/mobs/items; `_ridIndex` for O(1) lookup | Yes |
| `chunks.js` | Block/chunk cache, `getBlock`, `scan`, `look`, `raycast` | Yes |
| `blocks.js` | Sub-chunk binary decoder (palette + word storage) | Yes |
| `decoder.js` | `level_chunk` / `subchunk` packet → chunk objects | Yes |
| `pathfinding.js` | A* over the block map (binary-heap queue) | Yes |
| `chat.js` | Incoming chat: whitelist, prefix, sanitize, structure | Yes |
| `palette.js` | Runtime block ID → name (loads `data/block_palette.json`) | Yes |
| `constants.js` | Shared constants (`AIR_ID`) | Yes |

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

## Adding a new command

1. Add a `case '<name>':` in the `switch` in `bot.js` `handle()`.
2. Validate required fields early; return `ok({ error: '...' })` on bad input.
   (Numeric coords are already coerced/validated before the switch.)
3. Read perception data from `chunkCache` / `tracker` / `state`; for actions,
   `client.queue(...)` the packet(s) and update `state` via the pure helpers.
4. Always return through `ok(...)` so the response carries the command `id`.
5. If the command does real work (new math, decoding, filtering), put that logic
   in a module and unit-test it. Add an integration test in `test/handle.test.js`
   if it has interesting protocol-level behavior.
6. Update the command table in `README.md`.

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

## Current status & roadmap

Layers 0–4 (connection, self-awareness, entities, blocks, navigation) are
complete. Layer 5 (interaction: mining, placing, containers) is the next frontier
and is not yet implemented. When starting Layer 5, expect to need:
inventory-state tracking, block-break packets with the correct action sequence,
and item-palette resolution (the item equivalent of the block palette).

## Environment

- Node ≥ 18, ESM modules.
- Target server: Bedrock 1.26.31 (protocol negotiated as 1.26.30).
- `npm test` to verify, `npm start` to run (see README for env vars).
