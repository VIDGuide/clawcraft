---
name: clawcraft
description: "Control a Minecraft Bedrock bot: navigate the world, interact with players, scan surroundings, and perceive the environment. Use when you need to move the bot, look around, chat with players, teleport, pathfind, or read block/entity data from a Minecraft Bedrock server. Requires a running ClawCraft bot instance connected to a server."
user-invocable: true
metadata:
  author: "ClawCraft"
  version: "0.5.0"
  homepage: "https://github.com/misaunders/clawcraft"
  license: "MIT"
  tags: ["minecraft", "bedrock", "gaming", "bot", "navigation"]
---

# Skill: clawcraft

## Agent Capability Requirements

| Capability | Required | Details |
|---|---|---|
| **Shell command execution** | Yes | Must run `node ./scripts/cmd.js` and `node ./scripts/events.js` and capture stdout |
| **Environment variables** | Yes | Must read `CLAWCRAFT_PORT` and `CLAWCRAFT_EVENTS` from the shell environment |
| **JSON parsing** | Yes | All command responses and events are JSON |
| **Persistent background process** | Yes | The ClawCraft bot must already be running before using this skill |

## CRITICAL: How This Skill Works

**The ClawCraft bot must be running as a background process before any commands will work.**

All interaction goes through two scripts:
- `scripts/cmd.js` — sends one JSON command to the bot over TCP and returns the response
- `scripts/events.js` — reads async game events (chat, emotes, movement completion) from a JSONL log file

**Never try to start the bot from within a skill invocation.** The bot maintains a persistent connection to the Minecraft server that must stay alive.

## Configurations

- CLAWCRAFT_PORT: `{{env.CLAWCRAFT_PORT}}` (Default: `4099`)
- CLAWCRAFT_EVENTS: `{{env.CLAWCRAFT_EVENTS}}` (Default: `./events.jsonl`)
- SKILL_DIR: The directory containing this `SKILL.md` file. Resolve it from the path you loaded this file from (e.g. if you read `/home/user/skills/clawcraft/SKILL.md`, then `SKILL_DIR` is `/home/user/skills/clawcraft`).

## Environment Setup

### Required Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAWCRAFT_PORT` | `4099` | TCP port the bot's command server listens on |
| `CLAWCRAFT_EVENTS` | `./events.jsonl` | Path to the bot's JSONL event log |

### Bot Environment Variables (set when starting the bot)

| Variable | Default | Description |
|---|---|---|
| `HOST` | `192.168.1.10` | Minecraft server address |
| `PORT` | `19132` | Minecraft server port |
| `USERNAME` | `ClawBot` | Bot's in-game username |
| `OFFLINE` | `true` | Offline mode (no Xbox auth). Set to `false` for online mode |
| `CLAWCRAFT_AUTH_DIR` | (system default) | Directory to cache Xbox auth tokens (online mode only) |
| `SEND_CMD` | (empty) | Server command tool (required for `tp`, `say`, `cmd` actions) |
| `CHAT_WHITELIST` | (empty) | Comma-separated player names to accept messages from (empty = all) |
| `CHAT_PREFIX` | (empty) | Message prefix that marks a message as directed at the bot |
| `CLAWCRAFT_RESPAWN` | `false` | Auto-respawn on death (`true`/`false`) |
| `CLAWCRAFT_RECONNECT` | `false` | Auto-reconnect on disconnect with exponential backoff |
| `CLAWCRAFT_MAX_EVENTS_MB` | `5` | Max events.jsonl size in MB before rotating to `.1` backup |
| `CLAWCRAFT_CHUNK_CACHE_MAX` | `512` | Max chunks to keep in memory (LRU eviction) |
| `CLAWCRAFT_CHUNK_EVICT_DIST` | `256` | Distance in blocks beyond which stale chunks are evicted |
| `CLAWCRAFT_DANGER_MOB_DIST` | `8` | Distance for hostile mob danger alerts (blocks) |
| `CLAWCRAFT_DANGER_HEALTH` | `6` | Health threshold for low-health danger alerts |
| `CLAWCRAFT_DANGER_HUNGER` | `4` | Hunger threshold for low-hunger danger alerts |

### Starting the Bot

```bash
HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot \
  CLAWCRAFT_PORT=4099 CLAWCRAFT_EVENTS=/tmp/clawcraft-events.jsonl \
  node src/bot.js &
```

For Docker-hosted servers (itzg/minecraft-bedrock-server):
```bash
SEND_CMD="docker exec minecraft-survival send-command" \
  HOST=192.168.1.10 USERNAME=ClawBot node src/bot.js &
```

### Verifying the Bot is Running

```bash
node $SKILL_DIR/scripts/cmd.js '{"action":"status"}'
```

Expected response: `{"type":"response","id":0,"connected":true,"pos":{...},"uptime":N,...}`

If you get `BOT_NOT_RUNNING`, the bot is not running or `CLAWCRAFT_PORT` is wrong.

## Script Commands

**ALL bot interactions MUST go through these scripts.**

**Important:** All script paths below use `$SKILL_DIR` as a placeholder. Resolve it from the path you loaded this SKILL.md from, or `cd` into the skill directory and use `./scripts/...`.

### Status & Position Commands

```bash
# Get current position and rotation
node $SKILL_DIR/scripts/cmd.js '{"action":"pos"}'
# Returns: {"type":"response","id":N,"pos":{"x":0,"y":64,"z":0},"yaw":0,"pitch":0}

# Get bot status: uptime, loaded chunks, entity counts, position, vitals summary
node $SKILL_DIR/scripts/cmd.js '{"action":"status"}'
# Returns: {"type":"response","id":N,"connected":true,"pos":{...},"uptime":N,"chunks":N,"entities":{...},"vitals":{"health":20,"maxHealth":20,"hunger":20,"alive":true,"effectCount":0}}

# Get full vitals: health, hunger, saturation, absorption, breath, active effects
node $SKILL_DIR/scripts/cmd.js '{"action":"vitals"}'
# Returns: {"type":"response","id":N,"health":20,"maxHealth":20,"hunger":20,"saturation":5,"absorption":0,"breath":0,"level":0,"alive":true,"effects":[]}

# Client-side position set (no server teleport, just updates bot's local state)
node $SKILL_DIR/scripts/cmd.js '{"action":"setpos","x":0,"y":64,"z":0}'
# Optional: "yaw":0,"pitch":0
```

### Communication Commands

```bash
# Send a raw text message (appears in chat without player name prefix)
node $SKILL_DIR/scripts/cmd.js '{"action":"chat","message":"Hello world"}'

# Send a visible chat message using server command (requires SEND_CMD)
node $SKILL_DIR/scripts/cmd.js '{"action":"say","message":"Hello everyone"}'

# Send a private whisper to a named player
node $SKILL_DIR/scripts/cmd.js '{"action":"whisper","to":"PlayerName","message":"private message"}'

# Perform an emote (by name or UUID)
node $SKILL_DIR/scripts/cmd.js '{"action":"emote","name":"wave"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"emote","emoteId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}'
```

**Communication parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `chat` | `message` | string | Yes | Message text |
| `say` | `message` | string | Yes | Message text (requires `SEND_CMD`) |
| `whisper` | `to` | string | Yes | Target player name |
| `whisper` | `message` | string | Yes | Message text |
| `emote` | `name` | string | One of name/emoteId | Emote name (fuzzy matched) |
| `emote` | `emoteId` | string | One of name/emoteId | Emote UUID |

### Navigation Commands

```bash
# Teleport to coordinates (requires SEND_CMD)
node $SKILL_DIR/scripts/cmd.js '{"action":"tp","x":0,"y":64,"z":0}'
# Optional: "yaw":0

# Walk directly toward coordinates (immediate step-by-step, no pathfinding)
node $SKILL_DIR/scripts/cmd.js '{"action":"move","x":10,"y":64,"z":10}'

# Rotate to face a point
node $SKILL_DIR/scripts/cmd.js '{"action":"face","x":100,"y":64,"z":100}'

# Compute A* path to target (no movement, just returns the path)
node $SKILL_DIR/scripts/cmd.js '{"action":"path","x":50,"y":64,"z":50}'

# Pathfind and walk to target (ASYNC — returns immediately, emits walk_done event when done)
node $SKILL_DIR/scripts/cmd.js '{"action":"walk","x":50,"y":64,"z":50}'
# With sprint (30% faster):
node $SKILL_DIR/scripts/cmd.js '{"action":"walk","x":50,"y":64,"z":50,"sprint":true}'
# Disable auto-build (pillar/bridge) if you don't want the bot to place blocks:
node $SKILL_DIR/scripts/cmd.js '{"action":"walk","x":50,"y":64,"z":50,"autoBuild":false}'
# Returns immediately: {"type":"response","walking":true,"steps":N,"path":[...]}
# Walk_done event appears in event log when movement completes

# Cancel an in-progress walk
node $SKILL_DIR/scripts/cmd.js '{"action":"abort_walk"}'
# Returns: {"type":"response","id":N,"aborted":true,"walked":N,"pos":{...}}

# Check if target is reachable (pathfind with iteration limit, no movement)
node $SKILL_DIR/scripts/cmd.js '{"action":"reachable","x":50,"y":64,"z":50}'
# Returns: {"type":"response","id":N,"reachable":true,"distance":N,"euclidean":N,"estimatedTime":N}

# Get euclidean distance and direction vector to target (no pathfinding)
node $SKILL_DIR/scripts/cmd.js '{"action":"distance","x":50,"y":64,"z":50}'
# Returns: {"type":"response","id":N,"euclidean":N,"direction":{"x":N,"y":N,"z":N}}
```

**Navigation parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `tp` | `x`,`y`,`z` | number | Yes | Target coordinates |
| `tp` | `yaw` | number | No | Target rotation |
| `move` | `x`,`y`,`z` | number | Yes | Target coordinates |
| `face` | `x`,`y`,`z` | number | Yes | Point to look at |
| `path` | `x`,`y`,`z` | number | Yes | Target coordinates |
| `walk` | `x`,`y`,`z` | number | Yes | Target coordinates |
| `walk` | `sprint` | boolean | No | Sprint for ~30% faster travel (default: false) |
| `walk` | `autoBuild` | boolean | No | Auto-place blocks to pillar/bridge obstacles (default: true) |
| `reachable` | `x`,`y`,`z` | number | Yes | Target coordinates |
| `distance` | `x`,`y`,`z` | number | Yes | Target coordinates |

### Perception Commands

```bash
# List nearby entities (players, mobs, items) within radius
node $SKILL_DIR/scripts/cmd.js '{"action":"nearby","radius":32}'

# List all online players (server-wide roster with metadata)
node $SKILL_DIR/scripts/cmd.js '{"action":"players"}'
# Returns: {"type":"response","id":N,"players":[{"name":"...","uuid":"...","platform":"windows","joinedAt":N}],"count":N}

# Get block at specific coordinates
node $SKILL_DIR/scripts/cmd.js '{"action":"block","x":10,"y":64,"z":10}'

# Get all blocks in a cuboid volume (optionally filtered by name)
node $SKILL_DIR/scripts/cmd.js '{"action":"blocks","x1":0,"y1":60,"z1":0,"x2":10,"y2":70,"z2":10}'
node $SKILL_DIR/scripts/cmd.js '{"action":"blocks","x1":0,"y1":60,"z1":0,"x2":10,"y2":70,"z2":10,"filter":"minecraft:diamond_ore"}'

# Report which chunks are loaded near the bot
node $SKILL_DIR/scripts/cmd.js '{"action":"chunks","radius":4}'

# Structured scan of blocks around a point (returns layers, walls, floor, ceiling)
# Uses text names (no state IDs); notable filters out common fill blocks
node $SKILL_DIR/scripts/cmd.js '{"action":"scan"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"scan","radius":4,"radiusY":2}'
node $SKILL_DIR/scripts/cmd.js '{"action":"scan","x":0,"y":64,"z":0,"radius":4,"radiusY":2}'
# Key response fields: loaded (bool), unloaded (count), totalNonAir, notable, layers

# Compact scan: only notable/interesting blocks, no air, no common fill (stone, dirt, etc.)
# Ideal for LLM decision-making — minimal output, text names only
node $SKILL_DIR/scripts/cmd.js '{"action":"compact_scan"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"compact_scan","radius":4,"radiusY":2}'
# Key response fields: loaded (bool), totalNonAir, notableCount, notable [{x,y,z,name}]

# Blocks in the direction the bot is facing
node $SKILL_DIR/scripts/cmd.js '{"action":"look","distance":10}'

# Line-of-sight check from bot's position to a point
node $SKILL_DIR/scripts/cmd.js '{"action":"raycast","x":50,"y":64,"z":50}'

# Search loaded chunks for nearest block(s) matching a name pattern
node $SKILL_DIR/scripts/cmd.js '{"action":"find","block":"iron_ore"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"find","block":"diamond_ore","radius":48,"count":3}'
# Returns: {"type":"response","id":N,"count":N,"blocks":[{"x":N,"y":N,"z":N,"name":"minecraft:iron_ore","distance":N}]}
```

**Perception parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `nearby` | `radius` | number | No | Search radius in blocks (default: 32) |
| `block` | `x`,`y`,`z` | number | Yes | Block coordinates |
| `blocks` | `x1`,`y1`,`z1`,`x2`,`y2`,`z2` | number | Yes | Cuboid corners |
| `blocks` | `filter` | string | No | Block name filter (e.g. `minecraft:stone`) |
| `chunks` | `radius` | number | No | Chunk radius to check (default: 4) |
| `scan` | `x`,`y`,`z` | number | No | Center (defaults to bot position) |
| `scan` | `radius` | number | No | XZ radius (default: 4) |
| `scan` | `radiusY` | number | No | Y radius (default: 2) |
| `compact_scan` | `x`,`y`,`z` | number | No | Center (defaults to bot position) |
| `compact_scan` | `radius` | number | No | XZ radius (default: 4) |
| `compact_scan` | `radiusY` | number | No | Y radius (default: 2) |
| `look` | `distance` | number | No | Look distance in blocks (default: 10) |
| `raycast` | `x`,`y`,`z` | number | Yes | Target point |
| `find` | `block` | string | Yes | Block name pattern (substring match, e.g. `iron_ore`) |
| `find` | `radius` | number | No | Search radius in blocks (default: 32) |
| `find` | `count` | number | No | Max results to return (default: 5) |

### Inventory & Equipment Commands

```bash
# Query full inventory (all slots, armor, offhand, held item)
node $SKILL_DIR/scripts/cmd.js '{"action":"inventory"}'
# Returns: {"type":"response","id":N,"slots":[...],"armor":[...],"offhand":null,"heldSlot":N,"heldItem":{...},"summary":{...}}

# Query summary only (lighter for context)
node $SKILL_DIR/scripts/cmd.js '{"action":"inventory","view":"summary"}'
# Returns: {"type":"response","id":N,"heldSlot":N,"heldItem":{...},"summary":{"occupied":N,"total":36,"items":[...]}}

# Equip item by name (searches inventory, moves to hotbar if needed)
node $SKILL_DIR/scripts/cmd.js '{"action":"equip","item":"diamond_pickaxe"}'

# Equip by hotbar slot number (0-8)
node $SKILL_DIR/scripts/cmd.js '{"action":"equip","slot":3}'

# Unequip armor piece or offhand back to inventory
node $SKILL_DIR/scripts/cmd.js '{"action":"unequip","target":"helmet"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"unequip","target":"offhand"}'
```

**Inventory parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `inventory` | `view` | string | No | `"summary"` for compact view |
| `equip` | `item` | string | One of item/slot | Item name (fuzzy matched) |
| `equip` | `slot` | number | One of item/slot | Hotbar slot 0-8 |
| `unequip` | `target` | string | Yes | `helmet`, `chestplate`, `leggings`, `boots`, or `offhand` |

### Action Commands

```bash
# Mine a block (async — emits mine_done event when complete)
node $SKILL_DIR/scripts/cmd.js '{"action":"mine","x":10,"y":64,"z":10}'
# With auto tool selection:
node $SKILL_DIR/scripts/cmd.js '{"action":"mine","x":10,"y":64,"z":10,"autoTool":true}'
# Returns: {"type":"response","id":N,"mining":true,"block":"minecraft:stone","breakTime":6,"tool":"diamond_pickaxe"}
# Event: {"type":"mine_done","id":N,"block":"minecraft:stone","pos":{"x":10,"y":64,"z":10},"ticks":6,"confirmed":true}
# IMPORTANT: check `confirmed`. true = the server removed the block (expect an item drop / item_added event).
# false = the server did NOT break the block (it is still there); no drop will appear. mine_done fires either way.

# Cancel an in-progress mine
node $SKILL_DIR/scripts/cmd.js '{"action":"abort_mine"}'

# Eat food (async — emits eat_done event when complete)
node $SKILL_DIR/scripts/cmd.js '{"action":"eat","item":"cooked_beef"}'
# Returns: {"type":"response","id":N,"eating":true,"item":"cooked_beef","duration":1610}
# Event: {"type":"eat_done","id":N,"item":"cooked_beef"}

# Cancel eating
node $SKILL_DIR/scripts/cmd.js '{"action":"abort_eat"}'

# Drop items from inventory
node $SKILL_DIR/scripts/cmd.js '{"action":"drop","slot":0,"count":1}'
# Returns: {"type":"response","id":N,"dropped":true,"item":"minecraft:cobblestone","count":1}

# Throw a projectile item (egg, snowball, ender pearl)
node $SKILL_DIR/scripts/cmd.js '{"action":"throw","x":50,"y":64,"z":50}'
# Returns: {"type":"response","id":N,"thrown":true,"item":"minecraft:egg"}

# Give items to a nearby player
node $SKILL_DIR/scripts/cmd.js '{"action":"give","to":"Michael","item":"diamond","count":1}'
# Returns: {"type":"response","id":N,"given":true,"to":"Michael","item":"minecraft:diamond","count":1,"distance":5}

# Interact with a block (doors, levers, buttons, trapdoors, beds)
node $SKILL_DIR/scripts/cmd.js '{"action":"interact","x":10,"y":64,"z":10}'
# Returns: {"type":"response","id":N,"interacted":true,"block":"minecraft:oak_door","pos":{"x":10,"y":64,"z":10}}

# Sleep in a bed (must be night or thunderstorm; emits sleep_started event)
node $SKILL_DIR/scripts/cmd.js '{"action":"sleep","x":10,"y":64,"z":20}'
# Returns: {"type":"response","id":N,"sleeping":true,"bedPos":{"x":10,"y":64,"z":20},"block":"minecraft:red_bed"}

# Place a block from inventory at a target air position
node $SKILL_DIR/scripts/cmd.js '{"action":"place","item":"dirt","x":10,"y":65,"z":20}'
# Optional: specify which adjacent block face to click (0=bottom,1=top,2=north,3=south,4=west,5=east)
node $SKILL_DIR/scripts/cmd.js '{"action":"place","item":"cobblestone","x":10,"y":65,"z":20,"face":1}'
# Returns: {"type":"response","id":N,"placed":true,"block":"dirt","pos":{...},"face":N,"against":{...}}

# Attack a nearby entity (by name or runtime ID)
node $SKILL_DIR/scripts/cmd.js '{"action":"attack","entity":"zombie"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"attack","entity":42}'
# Returns: {"type":"response","id":N,"attacked":true,"entity":{"name":"zombie","runtimeId":42},"distance":3}
```

**Action parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `mine` | `x`,`y`,`z` | number | Yes | Block coordinates |
| `mine` | `autoTool` | boolean | No | Auto-equip best tool for the block |
| `eat` | `item` | string | No | Food item name to auto-equip |
| `drop` | `slot` | number | No | Inventory slot (default: held slot) |
| `drop` | `count` | number | No | Items to drop (default: full stack) |
| `throw` | `x`,`y`,`z` | number | No | Direction to face before throwing |
| `give` | `to` | string | Yes | Target player name |
| `give` | `item` | string | No | Item name to equip and give |
| `give` | `count` | number | No | Items to give (default: 1) |
| `interact` | `x`,`y`,`z` | number | Yes | Block coordinates |
| `sleep` | `x`,`y`,`z` | number | Yes | Bed block coordinates |
| `place` | `x`,`y`,`z` | number | Yes | Target air position to place into |
| `place` | `item` | string | Yes | Block item name to place (e.g. `dirt`, `cobblestone`) |
| `place` | `face` | number | No | Adjacent face to click (0-5, auto-detected if omitted) |
| `attack` | `entity` | string/number | Yes | Entity name or runtime ID |

### Server Control Commands

```bash
# Send an arbitrary server command (requires SEND_CMD)
node $SKILL_DIR/scripts/cmd.js '{"action":"cmd","cmd":"weather clear"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"cmd","cmd":"time set day"}'
```

### Event Subscription Commands

The bot has opt-in world events that you can subscribe/unsubscribe to as needed. Existing events (chat, walk_done, damage, etc.) are always-on. These additional events are off by default to avoid noise.

```bash
# List available event types and current subscriptions
node $SKILL_DIR/scripts/cmd.js '{"action":"subscriptions"}'
# Returns: {"type":"response","id":N,"active":[],"available":[{"event":"block_changed","description":"...","hasRadius":true,"defaultRadius":16,"subscribed":false},...]

# Subscribe to nearby block changes (doors, levers, blocks placed/broken)
node $SKILL_DIR/scripts/cmd.js '{"action":"subscribe","event":"block_changed","radius":16}'
# Returns: {"type":"response","id":N,"subscribed":"block_changed","radius":16}

# Subscribe to weather changes
node $SKILL_DIR/scripts/cmd.js '{"action":"subscribe","event":"weather"}'

# Subscribe to time-of-day changes (throttled, major phase transitions only)
node $SKILL_DIR/scripts/cmd.js '{"action":"subscribe","event":"time"}'

# Unsubscribe from an event type
node $SKILL_DIR/scripts/cmd.js '{"action":"unsubscribe","event":"block_changed"}'
```

**Available subscribable events:**

| Event | Has Radius | Default Radius | Description |
|---|---|---|---|
| `block_changed` | Yes | 16 | Block state changes nearby (doors, levers, placed/broken blocks) |
| `weather` | No | — | Rain/thunder start/stop |
| `time` | No | — | Game time phase changes (dawn/day/dusk/night), throttled to every 60s |

**Subscription parameters:**

| Command | Parameter | Type | Required | Description |
|---|---|---|---|---|
| `subscribe` | `event` | string | Yes | Event type to subscribe to |
| `subscribe` | `radius` | number | No | Override default radius (for radius-based events) |
| `unsubscribe` | `event` | string | Yes | Event type to unsubscribe from |

## Event Polling

Async game events are written to the event log file (`CLAWCRAFT_EVENTS`). Poll this file regularly to receive chat messages, walk completion notifications, and other game events.

```bash
# Get all events since a Unix timestamp (milliseconds)
node $SKILL_DIR/scripts/events.js --since 1750000000000

# Get the last N events
node $SKILL_DIR/scripts/events.js --last 20

# Get all events
node $SKILL_DIR/scripts/events.js

# Real-time follow mode: streams new events as they arrive (one JSON per line)
node $SKILL_DIR/scripts/events.js --follow --since 1750000000000
```

Output is always a JSON array: `[{...}, {...}]` or `[]` if no matching events.
In `--follow` mode, events are output one per line as they arrive.

### Event Types

| Type | Description | Key Fields |
|---|---|---|
| `startup` | Bot started and connected to server | `version`, `timestamp` |
| `auth_required` | Xbox device code auth needed (online mode only) | `url`, `code`, `timestamp` |
| `ready` | Bot joined the game world | `timestamp` |
| `spawn` | Bot spawned in the world | `timestamp` |
| `msg` | Incoming chat message | `from`, `msg`, `direct`, `whisper`, `system`, `timestamp` |
| `emote` | Player performed an emote | `from`, `emote`, `emoteId`, `known`, `timestamp` |
| `player_join` | Player joined the server | `name`, `uuid`, `platform`, `timestamp` |
| `player_leave` | Player left the server | `name`, `uuid`, `timestamp` |
| `player_appear` | Player entered render distance | `name`, `uuid`, `position`, `timestamp` |
| `player_disappear` | Player left render distance | `name`, `uuid`, `timestamp` |
| `player_nearby` | Player crossed proximity threshold toward bot | `name`, `uuid`, `zone`, `distance`, `timestamp` |
| `player_left_nearby` | Player moved away from proximity zone | `name`, `uuid`, `zone`, `distance`, `timestamp` |
| `walk_done` | Walk command completed | `id`, `walked`, `pos`, `timestamp` |
| `mine_done` | Mine command completed | `id`, `block`, `pos`, `ticks`, `timestamp` |
| `eat_done` | Eat command completed | `id`, `item`, `timestamp` |
| `item_added` | Item appeared in inventory | `item`, `slot`, `windowId`, `source`, `entityPosition`, `timestamp` |
| `item_removed` | Item disappeared from inventory | `item`, `slot`, `windowId`, `timestamp` |
| `tool_broken` | Durable item broke (durability exhausted) | `item`, `slot`, `windowId`, `timestamp` |
| `item_damaged` | Item durability decreased | `item`, `slot`, `windowId`, `previousDurability`, `durability`, `timestamp` |
| `item_count_changed` | Item stack count changed | `item`, `slot`, `windowId`, `oldCount`, `newCount`, `timestamp` |
| `damage_taken` | Bot took damage (causally grouped) | `cause`, `health`, `absorption?`, `hunger?`, `timestamp` |
| `health_restored` | Bot health increased | `cause`, `health`, `timestamp` |
| `hunger_changed` | Hunger changed without health change | `hunger`, `timestamp` |
| `effect_added` | Status effect applied | `effect`, `effectId`, `amplifier`, `duration`, `timestamp` |
| `effect_updated` | Effect amplifier/duration changed | `effect`, `effectId`, `amplifier`, `duration`, `timestamp` |
| `effect_removed` | Status effect expired/removed | `effect`, `effectId`, `timestamp` |
| `death` | Bot died | `cause`, `messages`, `timestamp` |
| `death_details` | Snapshot at death (inventory + position) | `pos`, `items`, `cause`, `messages`, `timestamp` |
| `respawn` | Bot respawned | `timestamp` |
| `sleep_started` | Bot began sleeping in a bed | `bedPos`, `timestamp` |
| `danger` | Threat detected (mob, low health, or low hunger) | `threat`, `distance?`, `entityType?`, `health?`, `hunger?`, `timestamp` |
| `disconnected` | Bot lost connection to server | `reason`, `timestamp` |
| `reconnecting` | Auto-reconnect attempt starting | `attempt`, `delay`, `timestamp` |
| `reconnected` | Bot successfully reconnected | `timestamp` |
| `chunks_evicted` | Old/distant chunks evicted from cache | `count`, `remaining`, `timestamp` |
| `command_timeout` | Async command exceeded watchdog timeout | `command` (mine/eat/walk), `id`, `timestamp` |
| `position_desync` | Server position differs from bot's local position | `serverPos`, `localPos`, `drift`, `mode`, `timestamp` |
| `shutdown` | Bot is shutting down | `timestamp` |
| `block_changed` | **Opt-in.** Nearby block state change | `pos`, `block`, `distance`, `timestamp` |
| `weather` | **Opt-in.** Weather change | `weather` (rain/thunder), `started` (bool), `timestamp` |
| `time` | **Opt-in.** Game time phase change (throttled) | `gameTime`, `phase` (dawn/day/dusk/night), `timestamp` |

**`msg` event fields:**

| Field | Type | Description |
|---|---|---|
| `from` | string | Player name who sent the message |
| `msg` | string | Message content (sanitized, max 500 chars) |
| `direct` | boolean | True if message is directed at the bot (by name or prefix) |
| `whisper` | boolean | True if sent as a private message |
| `system` | boolean | True if it's a server/system message |
| `timestamp` | number | Unix timestamp in milliseconds |

**`walk_done` event fields:**

| Field | Type | Description |
|---|---|---|
| `id` | number | Matches the `id` from the original `walk` response |
| `walked` | number | Number of steps taken |
| `pos` | object | Final position `{x, y, z}` |
| `timestamp` | number | Unix timestamp in milliseconds |

## Output Format

### Command Responses

**Success:**
```json
{"type":"response","id":N, ...fields}
```

**Error:**
```json
{"type":"response","id":N,"error":"error message"}
```

### Events Array

```json
[
  {"type":"msg","from":"Michael","msg":"hello bot","direct":true,"whisper":false,"system":false,"timestamp":1750000000000},
  {"type":"walk_done","id":5,"walked":42,"pos":{"x":10,"y":64,"z":10},"timestamp":1750000001000}
]
```

## Error Handling

| Error | Meaning | Agent Response |
|---|---|---|
| `BOT_NOT_RUNNING` | TCP connection refused | Inform user the bot is not running |
| `TIMEOUT` | No response within timeout | Bot may be busy; retry after 2s |
| `error: "No SEND_CMD configured"` | `tp`/`say`/`cmd` require SEND_CMD | Inform user to configure SEND_CMD |
| `error: "No path found"` | A* could not find a route | Area may not be loaded; scan first, try again |
| `error: "No position"` | Bot not yet spawned | Check status; bot may still be connecting |
| `error: "Unknown action: ..."` | Invalid action name | Check command name spelling |

## Constraints

- **One command at a time:** Each `cmd.js` invocation opens one TCP connection, sends one command, and exits. Do not attempt to pipeline commands.
- **Walk is async:** `walk` returns immediately with `walking: true`. The bot is moving in the background. Poll events for `walk_done` before issuing the next navigation command.
- **Chunks take time to load after teleport:** After `tp`, always run `scan` and check `loaded: true` before navigating or querying blocks. Retry with a 1-2 second delay if `loaded: false`.
- **Event file grows over time:** The event file is append-only. Always use `--since <last_timestamp>` to avoid re-reading old events. Store the timestamp of the last event you processed.
- **SEND_CMD required for some actions:** `tp`, `say`, and `cmd` require the `SEND_CMD` environment variable to be set when starting the bot.

## Logic & Rules

### 1. Always Verify Bot is Running First

Before any other command, run:
```bash
node $SKILL_DIR/scripts/cmd.js '{"action":"status"}'
```

If you get `BOT_NOT_RUNNING`, stop and inform the user the bot needs to be started.

### 2. Observe-Decide-Act Loop

For any task, follow this pattern:

**Step A — Observe:**
```bash
node $SKILL_DIR/scripts/cmd.js '{"action":"pos"}'
node $SKILL_DIR/scripts/cmd.js '{"action":"nearby","radius":32}'
node $SKILL_DIR/scripts/cmd.js '{"action":"scan"}'
```

**Step B — Check for events:**
```bash
node $SKILL_DIR/scripts/events.js --since <last_checked_timestamp>
```

**Step C — Decide and act** based on observations and events.

### 3. Handling Async Walk

```bash
# Issue walk command — returns immediately
node $SKILL_DIR/scripts/cmd.js '{"action":"walk","x":50,"y":64,"z":50}'
# Response: {"type":"response","id":5,"walking":true,"steps":42}

# Poll events until walk_done appears
node $SKILL_DIR/scripts/events.js --since <timestamp_before_walk>
# Wait 2-3 seconds between polls; walk_done will have matching "id":5
```

### 4. After Teleport — Wait for Chunks

```bash
node $SKILL_DIR/scripts/cmd.js '{"action":"tp","x":100,"y":64,"z":100}'
# Wait 1-2 seconds
node $SKILL_DIR/scripts/cmd.js '{"action":"scan"}'
# If response has "loaded":false, wait another 1-2 seconds and retry
```

### 5. Responding to Chat

Check events regularly for `msg` events. Messages with `direct: true` are directed at the bot and warrant a response:

```bash
node $SKILL_DIR/scripts/events.js --since <last_check>
# Look for {"type":"msg","direct":true,...} entries
# Respond with:
node $SKILL_DIR/scripts/cmd.js '{"action":"chat","message":"your response here"}'
```

### 6. Tracking Event Cursor

Always track the timestamp of the last event you processed and use `--since` on subsequent calls:

```
first call:  events.js --last 10  → get initial events, note last timestamp T
later calls: events.js --since T  → only get new events, update T after each call
```
