# ClawMine 🦀⛏️

A Bedrock Minecraft bot — mining, movement, and container interaction built on [`bedrock-protocol`](https://github.com/PrismarineJS/bedrock-protocol).

**Status:** Early development. Connect, chat, teleport, and basic movement working.

## Quick Start

```bash
npm install
HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot npm start
```

## Commands

Send JSON commands via stdin:

```json
{"action":"chat","message":"Hello world"}
{"action":"pos"}
{"action":"tp","x":0,"y":64,"z":0}
{"action":"move","x":10,"y":64,"z":10}
{"action":"face","x":100,"y":64,"z":100}
```

| Command | Description |
|---------|-------------|
| `chat` | Send a raw-text chat message |
| `say` | Send a chat-type message (with sender name) |
| `pos` | Get current position and rotation |
| `tp` | Teleport to coordinates (via server console) |
| `move` | Walk step-by-step toward coordinates |
| `setpos` | Client-side position set (teleport packet) |
| `face` | Rotate to look at a specific coordinate |

## Features

| Feature | Status |
|---------|--------|
| Connect & authenticate | ✅ |
| Chat (raw + typed) | ✅ |
| Keepalive (tick sync) | ✅ |
| Teleport (server command) | ✅ |
| Client-side position set | ✅ |
| Step-by-step movement | ✅ |
| Face / look at coords | ✅ |
| Position tracking | ✅ |
| Block breaking | 🔜 |
| Block placement | 🔜 |
| Container interaction | 🔜 |
| Inventory management | 🔜 |
| Pathfinding | 🔜 |

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
src/bot.js          — Main bot entry point
```

## License

MIT — contributions welcome!
