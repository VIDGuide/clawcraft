# ClawMine 🦀⛏️

A Bedrock Minecraft bot — mining, movement, and container interaction built on [`bedrock-protocol`](https://github.com/PrismarineJS/bedrock-protocol).

**Status:** Early development. Currently connects to Bedrock servers, stays alive, and can send/receive chat. Building up to full mining, container, and pathfinding capabilities.

## Quick Start

```bash
npm install
# Connect to a server
HOST=192.168.1.10 PORT=19132 USERNAME=ClawBot npm start
```

## Commands

The bot reads JSON commands from stdin:

```json
{"action":"chat","message":"Hello world"}
{"action":"pos"}
{"action":"players"}
```

## Features

| Feature | Status |
|---------|--------|
| Connect & authenticate | ✅ |
| Chat (raw text) | ✅ |
| Keepalive (tick sync) | ✅ |
| Movement | 🔜 |
| Block breaking | 🔜 |
| Block placement | 🔜 |
| Container interaction | 🔜 |
| Pathfinding | 🔜 |
| Inventory management | 🔜 |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `192.168.1.10` | Server address |
| `PORT` | `19132` | Bedrock port |
| `USERNAME` | `ClawBot` | Bot name |
| `OFFLINE` | `true` | Offline mode (no Xbox auth) |

## License

MIT
