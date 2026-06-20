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
│  • Chunk parsing (WIP) │  • Chat (send)                │
│  • Block awareness(WIP)│  • Block breaking (WIP)       │
│                        │  • Container interaction (WIP)│
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
| 3. World awareness (blocks) | 🔜 | Chunk decoding, block map |
| 4. Navigation | 🔜 | Pathfinding via A* on block map |
| 5. Interaction | 🔜 | Mining, placing, containers |

## Commands (for the AI agent)

Send JSON commands via stdin:

```json
{"action":"pos"}
{"action":"chat","message":"Hello world"}
{"action":"tp","x":0,"y":64,"z":0}
{"action":"move","x":10,"y":64,"z":10}
{"action":"face","x":100,"y":64,"z":100}
{"action":"nearby"}
```

| Command | Layer | Description |
|---------|-------|-------------|
| `pos` | 1 | Get current position and rotation |
| `chat` | 0 | Send a raw-text message |
| `say` | 0 | Send a chat-type message |
| `tp` | 1 | Teleport to coordinates |
| `move` | 1 | Walk toward coordinates |
| `setpos` | 1 | Client-side position set |
| `face` | 1 | Rotate to look at a point |
| `nearby` | 2 | List nearby players, mobs, items |

## Agent Loop (how an LLM uses this)

The AI agent runs a simple loop:

1. **Observe** → `{"action":"pos"}` + `{"action":"nearby"}` → get position and entities
2. **Decide** → pick an action based on observations
3. **Act** → send the action command (`move`, `dig`, `chat`, etc.)
4. **Repeat**

Example sequence for "come find me":

```
→ {"action":"nearby"}
← {"type":"response","nearby":{"players":[{"name":"Michael","position":{"x":-6,"y":134,"z":-23}}]}}

→ {"action":"face","x":-6,"y":134,"z":-23}
← {"type":"response","yaw":1.2,"pitch":-0.1}

→ {"action":"move","x":-6,"y":134,"z":-23}
← {"type":"response","moved":true,"pos":{"x":-6,"y":134,"z":-23}}
```

## Testing Philosophy

Unit tests protect against regressions in the **packet formats and math**. The bedrock-protocol library does the network I/O — we test the logic layer on top of it. Tests use Node 22's built-in test runner (`node --test`).

```bash
npm test          # run all tests
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

## Teleport Setup

For teleport (`tp` action) you need the server's `send-command` tool available.
For itzg/minecraft-bedrock-server Docker containers:

```bash
SEND_CMD="docker exec minecraft-survival send-command" npm start
```

## Project Structure

```
src/bot.js          — Entry point: stdin loop, event wiring, command dispatch
src/state.js        — Pure state management (position, rotation, connection)
src/math.js         — Coordinate math (face angles, walk steps)
src/packets.js      — Packet structure builders
src/entities.js     — Entity tracking (players, mobs, items)
test/*.test.js      — Unit tests (node --test)
```

## License

MIT — this is open source for the community. The Bedrock ecosystem needs a mineflayer equivalent. This is that start.
