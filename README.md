# ClawCraft 🦀⛏️

[![CI](https://github.com/VIDGuide/clawcraft/actions/workflows/ci.yml/badge.svg)](https://github.com/VIDGuide/clawcraft/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

**An AI agent harness for Minecraft Bedrock.** Not a CLI tool. Not a UI. A JSON-in/JSON-out interface that lets an LLM perceive the world and act within it.

Built on [`bedrock-protocol`](https://github.com/PrismarineJS/bedrock-protocol).

## Why?

Existing Minecraft bots assume a human operator. ClawCraft assumes an **AI agent** — a read-eval-act loop that sends structured commands and receives structured observations. The "UI" is stdin/stdout JSON. This project exists because the PrismarineJS ecosystem is mature for Java Edition (mineflayer) but has no equivalent for Bedrock.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (LLM)                        │
│  (reads observations, decides actions, sends JSON)       │
└──────┬────────────────────────────┬──────────────────────┘
       │ stdin (commands)            │ stdout (observations)
       │ — OR —                      │ — AND —
       │ TCP :4099 (cmd.js)          │ events.jsonl (events.js)
┌──────┴────────────────────────────┴──────────────────────┐
│                    ClawCraft Harness                        │
├───────────────────────────┬───────────────────────────────┤
│  Perception Layer         │  Action Layer                  │
│  ─────────────            │  ──────────                    │
│  • Position tracking      │  • Movement (step-by-step)     │
│  • Entity tracking        │  • Teleport (via SEND_CMD)     │
│  • Chat listening         │  • Face / look at              │
│  • Emote detection        │  • Chat / say / whisper        │
│  • Chunk decoding         │  • Emotes                      │
│  • Block awareness        │  • Paced pathfinding walk      │
│  • Named blocks           │  • Server commands             │
│  • A* pathfinding         │  • Mine, eat, drop, throw      │
└───────────────────────────┴───────────────────────────────┘
       │ RakNet UDP
┌──────┴────────────────────────────────────────────────────┐
│               Minecraft Bedrock Server                      │
└────────────────────────────────────────────────────────────┘
```

### Layers (in order)

| Layer | Status | Description |
|-------|--------|-------------|
| 0. Connection | ✅ | Connect, auth, keepalive, tick sync |
| 1. Self-awareness | ✅ | Position, rotation, movement |
| 2. World awareness (entities) | ✅ | Players, mobs, items, emotes |
| 3. World awareness (blocks) | ✅ | Chunk decoding, block map, named blocks, scan |
| 4. Navigation | ✅ | A* pathfinding on the block map |
| 5. Interaction | ✅ | Mining, eating, dropping, throwing, giving, interactions, attacking |

## Commands (for the AI agent)

Send JSON commands via stdin, one per line. Responses come back on stdout.

```json
{"action":"pos"}
{"action":"status"}
{"action":"vitals"}
{"action":"chat","message":"Hello world"}
{"action":"say","message":"Visible chat message"}
{"action":"whisper","to":"Michael","message":"private message"}
{"action":"emote","name":"wave"}
{"action":"tp","x":0,"y":64,"z":0}
{"action":"move","x":10,"y":64,"z":10}
{"action":"setpos","x":10,"y":64,"z":10}
{"action":"face","x":100,"y":64,"z":100}
{"action":"nearby","radius":32}
{"action":"players"}
{"action":"block","x":10,"y":64,"z":10}
{"action":"blocks","x1":0,"y1":60,"z1":0,"x2":10,"y2":70,"z2":10}
{"action":"chunks","radius":4}
{"action":"scan","radius":4,"radiusY":2}
{"action":"compact_scan","radius":4,"radiusY":2}
{"action":"look","distance":10}
{"action":"raycast","x":50,"y":64,"z":50}
{"action":"path","x":50,"y":64,"z":50}
{"action":"walk","x":50,"y":64,"z":50}
{"action":"abort_walk"}
{"action":"reachable","x":50,"y":64,"z":50}
{"action":"distance","x":50,"y":64,"z":50}
{"action":"inventory"}
{"action":"equip","item":"diamond_pickaxe"}
{"action":"unequip","target":"offhand"}
{"action":"mine","x":10,"y":64,"z":10,"autoTool":true}
{"action":"abort_mine"}
{"action":"eat","item":"cooked_beef"}
{"action":"abort_eat"}
{"action":"drop","slot":0,"count":1}
{"action":"throw","x":50,"y":64,"z":50}
{"action":"give","to":"Michael","item":"diamond","count":1}
{"action":"interact","x":10,"y":64,"z":10}
{"action":"sleep","x":10,"y":64,"z":20}
{"action":"place","item":"cobblestone","x":10,"y":65,"z":20}
{"action":"find","block":"iron_ore","radius":32,"count":5}
{"action":"attack","entity":"zombie"}
{"action":"cmd","cmd":"time set day"}
{"action":"subscribe","event":"block_changed","radius":16}
{"action":"unsubscribe","event":"block_changed"}
{"action":"subscriptions"}
```

| Command | Layer | Description |
|---------|-------|-------------|
| `pos` | 1 | Get current position and rotation |
| `status` | 1 | Bot health: uptime, loaded chunks, entity counts, position, vitals summary |
| `vitals` | 1 | Full vitals: health, hunger, saturation, absorption, breath, active effects |
| `chat` | 0 | Send a raw-text message |
| `say` | 0 | Send a server `/say` message (requires `SEND_CMD`) |
| `whisper` | 0 | Send a private message to a named player (needs `to`) |
| `emote` | 0 | Perform an emote by `name` or `emoteId` |
| `tp` | 1 | Teleport to coordinates (requires `SEND_CMD`) |
| `move` | 1 | Walk toward coordinates (immediate, step-by-step, no pathfinding) |
| `setpos` | 1 | Client-side position override (no server teleport) |
| `face` | 1 | Rotate to look at a point |
| `nearby` | 2 | List nearby players, mobs, items |
| `players` | 2 | List all online players (server-wide roster) |
| `block` | 3 | Get the block at a coordinate (with resolved name) |
| `blocks` | 3 | Get blocks in a cuboid, optionally filtered by name |
| `chunks` | 3 | Report which chunks are loaded near the bot |
| `scan` | 3 | Structured scan: layers, walls, floor, ceiling; notable blocks exclude common fill; uses text names |
| `compact_scan` | 3 | Filtered scan: only notable/interesting blocks (no air, no common fill), text names only — ideal for LLM decision-making |
| `look` | 3 | Blocks in the direction the bot is facing |
| `raycast` | 3 | Line-of-sight check between two points |
| `path` | 4 | Compute an A* path to a target (no movement) |
| `walk` | 4 | Pathfind and walk to a target (paced, async) |
| `abort_walk` | 4 | Cancel an in-progress walk operation |
| `reachable` | 4 | Check if a target is reachable (pathfind with limit, no movement) |
| `distance` | 4 | Euclidean distance and direction vector to a target (no pathfinding) |
| `inventory` | 5 | Query current inventory, armor, held item (optional `view:"summary"`) |
| `equip` | 5 | Equip item by `item` name or `slot` number (0-8 hotbar) |
| `unequip` | 5 | Unequip armor/offhand by `target` (helmet/chestplate/leggings/boots/offhand) |
| `mine` | 5 | Break a block at coordinates (async, emits `mine_done`; optional `autoTool`) |
| `abort_mine` | 5 | Cancel an in-progress mine operation |
| `eat` | 5 | Consume held food item (async, emits `eat_done`; optional `item` to auto-equip) |
| `abort_eat` | 5 | Cancel an in-progress eat operation |
| `drop` | 5 | Drop items from inventory (`slot`, `count`) |
| `throw` | 5 | Throw a held projectile item (egg, snowball, ender pearl) |
| `give` | 5 | Drop items toward a nearby player (`to`, `item`, `count`) |
| `interact` | 5 | Interact with a block (doors, levers, buttons, trapdoors, beds) |
| `attack` | 5 | Attack a nearby entity by name or runtime ID |
| `sleep` | 5 | Sleep in a bed at the given coordinates |
| `place` | 5 | Place a block item from inventory at a target position (auto-detects face) |
| `find` | 3 | Search loaded chunks for nearest block(s) matching a name pattern |
| `cmd` | 0 | Pass an arbitrary command to the server (requires `SEND_CMD`) |
| `subscribe` | 0 | Subscribe to an opt-in event type (`event`, optional `radius`) |
| `unsubscribe` | 0 | Unsubscribe from an event type |
| `subscriptions` | 0 | List active subscriptions and available event types |

### Scan response: `loaded` field

`scan` reports whether block data is available for the queried area:

```json
{"type":"response","loaded":true,"unloaded":0,"total":245,"totalNonAir":12,...}
```

- `loaded: false` means chunks haven't arrived yet — retry after 1–2 seconds
- `unloaded` is the count of positions with no data (not confirmed air, not confirmed solid)

### Async events

Some commands return immediately and emit a follow-up event:

- `walk` → `{"type":"response","walking":true,"steps":N,"path":[...]}` then `{"type":"walk_done","id":N,"walked":N,"pos":{...}}`
- `mine` → `{"type":"response","mining":true,"block":"...","breakTime":N}` then `{"type":"mine_done","id":N,"block":"...","pos":{...},"ticks":N}`
- `eat` → `{"type":"response","eating":true,"item":"...","duration":1610}` then `{"type":"eat_done","id":N,"item":"..."}`

Other unsolicited events:

- `{"type":"startup","version":"0.5.0","timestamp":N}` — emitted on launch
- `{"type":"auth_required","url":"...","code":"...","timestamp":N}` — Xbox device code auth needed (online mode only)
- `{"type":"ready","timestamp":N}` / `{"type":"spawn","timestamp":N}` — connection lifecycle
- `{"type":"msg","from":"...","msg":"...","direct":bool,"whisper":bool,"system":bool,"timestamp":N}` — incoming chat
- `{"type":"emote","from":"...","emote":"wave","emoteId":"...","known":bool,"timestamp":N}` — player emote
- `{"type":"player_join","name":"...","uuid":"...","platform":"windows","timestamp":N}` — player joined server
- `{"type":"player_leave","name":"...","uuid":"...","timestamp":N}` — player left server
- `{"type":"player_appear","name":"...","uuid":"...","position":{...},"timestamp":N}` — player entered render distance
- `{"type":"player_disappear","name":"...","uuid":"...","timestamp":N}` — player left render distance
- `{"type":"player_nearby","name":"...","uuid":"...","zone":"close|near","distance":N,"timestamp":N}` — player crossed proximity threshold toward bot
- `{"type":"player_left_nearby","name":"...","uuid":"...","zone":"close|near","distance":N,"timestamp":N}` — player moved away from bot
- `{"type":"shutdown","timestamp":N}` — emitted on graceful shutdown
- `{"type":"item_added","item":{...},"slot":N,"windowId":"...","source":"pickup","entityPosition":{...},"timestamp":N}` — item appeared in inventory (source/entityPosition present if correlated with pickup)
- `{"type":"item_removed","item":{...},"slot":N,"windowId":"...","timestamp":N}` — item disappeared from inventory
- `{"type":"tool_broken","item":{...},"slot":N,"windowId":"...","timestamp":N}` — durable item broke (durability exhausted)
- `{"type":"item_damaged","item":{...},"slot":N,"windowId":"...","previousDurability":N,"durability":N,"timestamp":N}` — item durability decreased
- `{"type":"item_count_changed","item":{...},"slot":N,"windowId":"...","oldCount":N,"newCount":N,"timestamp":N}` — item stack count changed
- `{"type":"damage_taken","cause":"attack|fall|drown|starvation|unknown","health":{"old":N,"new":N,"max":N},"timestamp":N}` — health decreased (causally grouped)
- `{"type":"health_restored","cause":"regeneration|natural_regeneration","health":{"old":N,"new":N,"max":N},"timestamp":N}` — health increased
- `{"type":"hunger_changed","hunger":{"old":N,"new":N,"max":N},"timestamp":N}` — hunger changed without health change
- `{"type":"effect_added","effect":"speed","effectId":N,"amplifier":N,"duration":N,"timestamp":N}` — status effect applied
- `{"type":"effect_updated","effect":"poison","effectId":N,"amplifier":N,"duration":N,"timestamp":N}` — effect amplifier/duration changed
- `{"type":"effect_removed","effect":"regeneration","effectId":N,"timestamp":N}` — status effect expired/removed
- `{"type":"death","cause":"...","messages":[...],"timestamp":N}` — bot died
- `{"type":"death_details","pos":{...},"items":[...],"cause":"...","messages":[...],"timestamp":N}` — snapshot at death (inventory + position)
- `{"type":"respawn","timestamp":N}` — bot respawned

All events carry a `timestamp` (Unix ms).

New in this release:
- `{"type":"danger","threat":"zombie","distance":5.2,"entityType":32,"runtimeId":N,"pos":{...},"timestamp":N}` — hostile mob nearby, or low health/hunger
- `{"type":"sleep_started","bedPos":{...},"timestamp":N}` — bot began sleeping
- `{"type":"disconnected","reason":"...","timestamp":N}` — connection lost
- `{"type":"reconnecting","attempt":N,"delay":N,"timestamp":N}` — reconnect attempt
- `{"type":"reconnected","timestamp":N}` — reconnected successfully
- `{"type":"chunks_evicted","count":N,"remaining":N,"timestamp":N}` — LRU cache eviction
- `{"type":"command_timeout","command":"mine","id":N,"timestamp":N}` — stuck command aborted
- `{"type":"position_desync","serverPos":{...},"localPos":{...},"drift":N,"mode":"teleport","timestamp":N}` — position correction

Opt-in events (via `subscribe` command):
- `{"type":"block_changed","pos":{...},"block":"minecraft:oak_door","distance":N,"timestamp":N}` — nearby block state change
- `{"type":"weather","weather":"rain","started":true,"timestamp":N}` — weather change
- `{"type":"time","gameTime":N,"phase":"day|dawn|dusk|night","timestamp":N}` — game time (throttled)

## Chat & incoming messages

Incoming chat is filtered and structured before reaching the agent:

- **Whitelist** (`CHAT_WHITELIST`): comma-separated player names. If set, only messages from these players are forwarded. Empty = allow all.
- **Prefix** (`CHAT_PREFIX`): if set, messages must start with this prefix to be marked `direct:true` (with the prefix stripped). Non-prefixed messages still pass through as ambient chat with `direct:false`.
- **Bot-name mentions**: messages containing the bot's username are auto-flagged `direct:true`.
- **Sanitization**: control characters are stripped and messages are capped at 500 characters (mitigates prompt-injection via chat).
- Whispers are always `direct:true`. Own messages are ignored.

## Agent Loop (how an LLM uses this)

1. **Observe** → `pos` + `nearby` + `scan` → position, entities, blocks
2. **Check events** → `scripts/events.js --since <last_timestamp>` → chat, emotes, walk_done
3. **Decide** → pick an action based on observations and events
4. **Act** → send the action command (`walk`, `face`, `chat`, etc.)
5. **Repeat**

Example "come find me":

```
→ {"action":"nearby"}
← {"type":"response","nearby":{"players":[{"name":"Michael","position":{"x":-6,"y":134,"z":-23}}]}}

→ {"action":"walk","x":-6,"y":134,"z":-23}
← {"type":"response","walking":true,"steps":42,"path":[...]}
← {"type":"walk_done","walked":42,"pos":{"x":-6,"y":134,"z":-23},"timestamp":N}
```

## OpenClaw Skill

ClawCraft ships as an [OpenClaw](https://openclaw.dev) skill, letting any OpenClaw-compatible agent (including Kiro) control the bot through two script-based interfaces.

### How it works

```
Agent → node scripts/cmd.js '{"action":"scan"}' → TCP :4099 → bot
Agent → node scripts/events.js --since 1234567 → reads events.jsonl → game events
```

- **`scripts/cmd.js`** sends one JSON command to the running bot over TCP and prints the response
- **`scripts/events.js`** reads async game events (chat, emotes, walk completion) from the JSONL event log

### Install the skill

```bash
npm run skill:install
```

This creates a symlink at `~/.kiro/skills/clawcraft` pointing to the `skill/` directory.

### Start the bot for skill mode

```bash
HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot \
  CLAWCRAFT_PORT=4099 CLAWCRAFT_EVENTS=/tmp/clawcraft-events.jsonl \
  npm start
```

The bot runs its full stdin/stdout interface and the TCP server simultaneously — no special flags needed.

### Quick usage example

```bash
# Verify the bot is connected
node scripts/cmd.js '{"action":"status"}'

# Walk to a player
node scripts/cmd.js '{"action":"nearby","radius":32}'
node scripts/cmd.js '{"action":"walk","x":-6,"y":134,"z":-23}'

# Poll for walk completion and chat messages
node scripts/events.js --since 1750000000000
```

### Environment Variables (skill interface)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWCRAFT_PORT` | `4099` | TCP port for the command server |
| `CLAWCRAFT_EVENTS` | `./events.jsonl` | Path to the JSONL event log |

## Block names & the palette

Bedrock 1.21+ sends block IDs as **FNV-1a hashes** of the block-state NBT (the `block_network_ids_are_hashes` flag). ClawCraft maps these hashes back to names like `minecraft:stone` using a pre-computed palette in `data/block_palette.json`.

The palette is generated from [pmmp/BedrockData](https://github.com/pmmp/BedrockData)'s `canonical_block_states.nbt`. Hashes are **version-stable** — a block's hash is the same across versions — so an exact server-version match is not required, only that the canonical states file contains the blocks your server uses.

To regenerate or update the palette:

```bash
# Download the canonical block states for your target version:
curl -sL "https://raw.githubusercontent.com/pmmp/BedrockData/bedrock-1.26.30/canonical_block_states.nbt" \
  -o data/canonical_block_states.nbt

# Build data/block_palette.json and verify against the live server:
node test_capture_palette.js
```

The script reports a match rate against blocks actually present in a loaded chunk. 100% means every block the server sent resolved to a name.

> **Implementation note:** sub-chunk palette entries are **zigzag-encoded signed varints** (FNV-1a hashes are signed 32-bit ints). Decoding them as unsigned varints yields wrong IDs — see `src/blocks.js`.

## Testing

```bash
npm test             # unit tests (pure logic, no server required)
npm run test:watch   # watch mode

npm run live-test                     # live tests against real server (bot must be running)
npm run live-test -- --suite vision   # one live suite
npm run live-test -- --list           # list available suites
```

Unit tests cover packet formats, math, decoding, and pure logic layers. Live tests verify end-to-end behavior against a real Minecraft server. See `TESTING.md` for setup.

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
| `OFFLINE` | `true` | Offline mode (no Xbox auth). Set to `false` for online mode |
| `CLAWCRAFT_AUTH_DIR` | (system default) | Directory to cache Xbox auth tokens (online mode only) |
| `SEND_CMD` | (empty) | Server command tool path (required for `tp`, `say`, `cmd`) |
| `CHAT_WHITELIST` | (empty) | Comma-separated player names allowed to message the bot (empty = all) |
| `CHAT_PREFIX` | (empty) | Required prefix for a message to count as directed at the bot |
| `CLAWCRAFT_PORT` | `4099` | TCP port for the skill command server |
| `CLAWCRAFT_EVENTS` | `./events.jsonl` | Path to the JSONL event log |
| `CLAWCRAFT_RESPAWN` | `false` | Auto-respawn on death |
| `CLAWCRAFT_RECONNECT` | `false` | Auto-reconnect on disconnect (exponential backoff) |
| `CLAWCRAFT_MAX_EVENTS_MB` | `5` | Max events.jsonl size before rotation |
| `CLAWCRAFT_CHUNK_CACHE_MAX` | `512` | Max chunks in memory (LRU eviction) |
| `CLAWCRAFT_CHUNK_EVICT_DIST` | `256` | Distance threshold for chunk eviction (blocks) |
| `CLAWCRAFT_DANGER_MOB_DIST` | `8` | Hostile mob proximity for danger alerts (blocks) |
| `CLAWCRAFT_DANGER_HEALTH` | `6` | Health threshold for low-health danger alerts |
| `CLAWCRAFT_DANGER_HUNGER` | `4` | Hunger threshold for low-hunger danger alerts |

## Online Authentication (Xbox Live)

By default, ClawCraft connects in offline mode (`OFFLINE=true`). For servers that require Xbox authentication:

```bash
OFFLINE=false HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot npm start
```

On first connection, the bot emits an `auth_required` event with a Microsoft device code:

```json
{"type":"auth_required","url":"https://microsoft.com/link","code":"ABCD1234","timestamp":N}
```

A human (or the LLM agent relaying to one) must visit the URL and enter the code to authorize the Xbox account. After first auth, tokens are cached to `CLAWCRAFT_AUTH_DIR` and reused silently.

**Important notes:**
- The bot needs its **own Xbox/Microsoft account** — a single account cannot be logged in from two clients simultaneously
- In online mode, `USERNAME` is a cache key for tokens; the in-game name is the Xbox Gamer Tag
- Private servers with allowlists must add the bot's Xbox Gamer Tag or XUID
- Tokens last ~14 days with refresh. Extended downtime may require re-authentication

## Teleport Setup

For teleport (`tp` action) you need the server's `send-command` tool available.
For itzg/minecraft-bedrock-server Docker containers:

```bash
SEND_CMD="docker exec minecraft-survival send-command" npm start
```

## Project Structure

```
src/
  bot.js          — Entry point: stdin loop, TCP server, event wiring, command dispatch
  commands.js     — Command handlers: all action dispatch logic (extracted from bot.js)
  state.js        — Pure state management (position, rotation, connection)
  math.js         — Coordinate math (face angles, walk steps)
  packets.js      — Packet structure builders
  entities.js     — Entity tracking (players, mobs, items) with runtimeId index
  chunks.js       — Block/chunk cache, block queries, scan/look/raycast perception
  blocks.js       — Standalone Bedrock sub-chunk decoder (palette + word storage)
  decoder.js      — level_chunk / subchunk packet decoding
  navigation.js   — Block classification + cost-aware A* pathfinding (doors, ladders, hazards)
  chat.js         — Incoming chat filtering, whitelist, prefix, sanitization
  emotes.js       — Emote UUID ↔ name mapping
  palette.js      — Runtime block ID → name lookup (loads data/block_palette.json)
  constants.js    — Shared constants (AIR_ID hash)
scripts/
  cmd.js          — Send one JSON command to bot via TCP, print response
  events.js       — Poll JSONL event log, filter by --since / --last
skill/
  SKILL.md        — OpenClaw skill definition
  scripts/        — Copies of scripts/cmd.js and scripts/events.js
live-test/
  runner.js       — Live test framework (cmd, waitForEvent, assert, report)
  suites/         — Live test suites (connection, position, chat, vision, navigation, ...)
test/
  *.test.js       — Unit + integration tests (node --test)
data/
  block_palette.json       — Pre-computed block hash → name mapping
test_capture_palette.js    — Generates/verifies data/block_palette.json
TESTING.md                 — Live test setup and quick command reference
AGENTS.md                  — Steering guide for AI agents working on this codebase
```

## Version Notes

- Built and tested against a **Bedrock 1.26.31** server (protocol negotiated as 1.26.30).
- Block palette built from **pmmp/BedrockData `bedrock-1.26.30`** canonical states.
- Requires **Node.js ≥ 18** (uses the built-in test runner and ESM).

## License

MIT — this is open source for the community. The Bedrock ecosystem needs a mineflayer equivalent. This is that start.
