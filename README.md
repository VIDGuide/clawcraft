# ClawMine 🦀⛏️

**An AI agent harness for Minecraft Bedrock.** Not a CLI tool. Not a UI. A JSON-in/JSON-out interface that lets an LLM perceive the world and act within it.

Built on [`bedrock-protocol`](https://github.com/PrismarineJS/bedrock-protocol).

## Why?

Existing Minecraft bots assume a human operator. ClawMine assumes an **AI agent** — a read-eval-act loop that sends structured commands and receives structured observations. The "UI" is stdin/stdout JSON. This project exists because the PrismarineJS ecosystem is mature for Java Edition (mineflayer) but has no equivalent for Bedrock.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AI Agent (LLM)                     │
│  (reads observations, decides actions, sends JSON)   │
└──────┬────────────────────────────────────┬──────────┘
       │ JSON stdin (commands)              │ JSON stdout (observations)
┌──────┴────────────────────────────────────┴──────────┘
│                   ClawMine Harness                     │
├────────────────────────────────────────────────────────┤
│  Perception Layer      │  Action Layer                 │
│  ─────────────         │  ──────────                   │
│  • Position tracking   │  • Movement (step-by-step)    │
│  • Entity tracking     │  • Teleport                   │
│  • Chat listening      │  • Face / look at             │
│  • Chunk decoding      │  • Chat / say / whisper       │
│  • Block awareness     │  • Paced pathfinding walk     │
│  • Named blocks        │  • Block breaking (WIP)       │
│  • A* pathfinding      │  • Container interaction (WIP)│
└────────────────────────┴──────────────────────────────┘
       │ RakNet UDP
┌──────┴────────────────────────────────────────────────┘
│               Minecraft Bedrock Server                  │
└────────────────────────────────────────────────────────┘
```

### Layers (in order)

| Layer | Status | Description |
|-------|--------|-------------|
| 0. Connection | ✅ | Connect, auth, keepalive |
| 1. Self-awareness | ✅ | Position, rotation, movement |
| 2. World awareness (entities) | ✅ | Players, mobs, items |
| 3. World awareness (blocks) | ✅ | Chunk decoding, block map, named blocks |
| 4. Navigation | ✅ | A* pathfinding on the block map |
| 5. Interaction | 🔜 | Mining, placing, containers |

## Commands (for the AI agent)

Send JSON commands via stdin, one per line. Responses come back on stdout, one JSON object per line.

```json
{"action":"pos"}
{"action":"status"}
{"action":"chat","message":"Hello world"}
{"action":"say","message":"Visible chat message"}
{"action":"whisper","to":"Michael","message":"private message"}
{"action":"tp","x":0,"y":64,"z":0}
{"action":"move","x":10,"y":64,"z":10}
{"action":"face","x":100,"y":64,"z":100}
{"action":"nearby","radius":32}
{"action":"block","x":10,"y":64,"z":10}
{"action":"scan","radius":4,"radiusY":2}
{"action":"look","distance":10}
{"action":"path","x":50,"y":64,"z":50}
{"action":"walk","x":50,"y":64,"z":50}
```

| Command | Layer | Description |
|---------|-------|-------------|
| `pos` | 1 | Get current position and rotation |
| `status` | 1 | Bot health: uptime, loaded chunks, entity counts, position |
| `chat` | 0 | Send a raw-text message |
| `say` | 0 | Send a chat-type message (visible to players) |
| `whisper` | 0 | Send a private message to a named player (needs `to`) |
| `tp` | 1 | Teleport to coordinates (requires `SEND_CMD`) |
| `move` | 1 | Walk toward coordinates (immediate, step-by-step) |
| `setpos` | 1 | Client-side position set |
| `face` | 1 | Rotate to look at a point |
| `nearby` | 2 | List nearby players, mobs, items |
| `block` | 3 | Get the block at a coordinate (with name) |
| `blocks` | 3 | Get blocks in a cuboid, optionally filtered by name |
| `chunks` | 3 | Report which chunks are loaded near the bot |
| `scan` | 3 | Structured scan of blocks around a point (layers, walls, floor) |
| `look` | 3 | Blocks in the direction the bot is facing |
| `raycast` | 3 | Line-of-sight check between two points |
| `path` | 4 | Compute an A* path to a target (no movement) |
| `walk` | 4 | Pathfind and walk to a target (paced, async) |

### Async events

Some commands return immediately and emit a follow-up event:

- `walk` returns `{"walking":true,"steps":N,"path":[...]}` then emits `{"type":"walk_done","id":N,"walked":N,"pos":{...}}` when movement finishes.

Other unsolicited events the agent may receive:

- `{"type":"startup","version":"0.4.0"}` — emitted on launch
- `{"type":"ready"}` / `{"type":"spawn"}` — connection lifecycle
- `{"type":"msg","from":"...","msg":"...","direct":bool,"whisper":bool,"system":bool,"timestamp":N}` — incoming chat
- `{"type":"shutdown"}` — emitted on graceful shutdown

## Chat & incoming messages

Incoming chat is filtered and structured before reaching the agent:

- **Whitelist** (`CHAT_WHITELIST`): comma-separated player names. If set, only messages from these players are forwarded. Empty = allow all.
- **Prefix** (`CHAT_PREFIX`): if set, messages must start with this prefix to be marked `direct:true` (with the prefix stripped). Non-prefixed messages still pass through as ambient chat with `direct:false`.
- **Bot-name mentions**: messages containing the bot's username are auto-flagged `direct:true`.
- **Sanitization**: control characters are stripped and messages are capped at 500 characters (mitigates prompt-injection via chat).
- Whispers are always `direct:true`. Own messages are ignored.

## Agent Loop (how an LLM uses this)

1. **Observe** → `{"action":"pos"}` + `{"action":"nearby"}` + `{"action":"scan"}` → position, entities, blocks
2. **Decide** → pick an action based on observations
3. **Act** → send the action command (`walk`, `face`, `chat`, etc.)
4. **Repeat**

Example "come find me":

```
→ {"action":"nearby"}
← {"type":"response","nearby":{"players":[{"name":"Michael","position":{"x":-6,"y":134,"z":-23}}]}}

→ {"action":"walk","x":-6,"y":134,"z":-23}
← {"type":"response","walking":true,"steps":42,"path":[...]}
← {"type":"walk_done","walked":42,"pos":{"x":-6,"y":134,"z":-23}}
```

## Block names & the palette

Bedrock 1.21+ sends block IDs as **FNV-1a hashes** of the block-state NBT (the `block_network_ids_are_hashes` flag). ClawMine maps these hashes back to names like `minecraft:stone` using a pre-computed palette in `data/block_palette.json`.

The palette is generated from [pmmp/BedrockData](https://github.com/pmmp/BedrockData)'s `canonical_block_states.nbt`. Hashes are **version-stable** — a block's hash is the same across versions — so an exact server-version match is not required, only that the canonical states file contains the blocks your server uses.

To regenerate or update the palette:

```bash
# Download the canonical block states for your target version (branch/tag on pmmp/BedrockData):
curl -sL "https://raw.githubusercontent.com/pmmp/BedrockData/bedrock-1.26.30/canonical_block_states.nbt" \
  -o data/canonical_block_states.nbt

# Build data/block_palette.json and verify against the live server:
node test_capture_palette.js
```

The script reports a match rate against blocks actually present in a loaded chunk. 100% means every block the server sent resolved to a name.

> **Implementation note:** sub-chunk palette entries are **zigzag-encoded signed varints** (FNV-1a hashes are signed 32-bit ints). Decoding them as unsigned varints yields wrong IDs — see `src/blocks.js`.

## Testing Philosophy

Unit tests protect against regressions in the **packet formats, math, decoding, and pure logic layers**. The bedrock-protocol library does the network I/O — we test the logic on top of it. Integration tests for the stdin/stdout command loop spawn the bot as a subprocess.

```bash
npm test            # run all tests (Node's built-in runner)
npm run test:watch  # watch mode
```

## Quick Start

```bash
npm install
HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `192.168.1.10` | Server address |
| `PORT` | `19132` | Bedrock port |
| `USERNAME` | `ClawBot` | Bot name |
| `OFFLINE` | `true` | Offline mode (no Xbox auth) |
| `SEND_CMD` | (empty) | Path to server `send-command` tool for teleport |
| `CHAT_WHITELIST` | (empty) | Comma-separated player names allowed to message the bot (empty = all) |
| `CHAT_PREFIX` | (empty) | Required prefix for a message to count as directed at the bot |

## Teleport Setup

For teleport (`tp` action) you need the server's `send-command` tool available.
For itzg/minecraft-bedrock-server Docker containers:

```bash
SEND_CMD="docker exec minecraft-survival send-command" npm start
```

## Project Structure

```
src/bot.js          — Entry point: stdin loop, event wiring, command dispatch, graceful shutdown
src/state.js        — Pure state management (position, rotation, connection)
src/math.js         — Coordinate math (face angles, walk steps)
src/packets.js      — Packet structure builders
src/entities.js     — Entity tracking (players, mobs, items) with runtimeId index
src/chunks.js       — Block/chunk cache, block queries, scan/look/raycast perception
src/blocks.js       — Standalone Bedrock sub-chunk decoder (palette + word storage)
src/decoder.js      — level_chunk / subchunk packet decoding
src/pathfinding.js  — A* pathfinding (binary-heap priority queue)
src/chat.js         — Incoming chat filtering, whitelist, prefix, sanitization
src/palette.js      — Runtime block ID → name lookup (loads data/block_palette.json)
src/constants.js    — Shared constants (AIR_ID hash)
test/*.test.js      — Unit + integration tests (node --test)
test_capture_palette.js — Generates/verifies data/block_palette.json from canonical states
data/block_palette.json — Pre-computed runtime ID → block name mapping
```

## Version Notes

- Built and tested against a **Bedrock 1.26.31** server (protocol negotiated as 1.26.30).
- Block palette built from **pmmp/BedrockData `bedrock-1.26.30`** canonical states.
- Requires **Node.js ≥ 18** (uses the built-in test runner and ESM).

## License

MIT — this is open source for the community. The Bedrock ecosystem needs a mineflayer equivalent. This is that start.
