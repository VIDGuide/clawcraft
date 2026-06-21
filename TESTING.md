# Live Testing

## Two isolated instances

The interactive (LLM) bot and the live-test bot run as **separate instances** so
tests never disturb the LLM's session:

| | Interactive (LLM) | Live tests |
|---|---|---|
| Start script | `start.sh` | `start-test.sh` |
| Username | `ClawBot` | `ClawTest` |
| TCP command port | `4099` | `4100` |
| Event log | `events.jsonl` | `events-test.jsonl` |

`npm run live-test` auto-starts (and restarts, for fresh code) the **test** bot
on port 4100 via `start-test.sh`. It only ever touches port 4100 — the LLM's bot
on 4099 keeps running untouched. Both can be connected to the Minecraft server
at the same time.

When you have solid updates for the LLM to try, tell it to restart its own
instance via the skill (it reconnects on 4099 with the new code).


## Environment

| Setting | Value |
|---|---|
| Server | `192.168.1.10:19132` (Bedrock 1.26.31.1 survival) |
| Bot username | `ClawBot` |
| Project | `/home/misaunders/source/clawcraft/` |
| tmux session | `clawbot` |
| SEND_CMD | `docker exec minecraft-survival send-command` |

## Start / Restart the Bot

```bash
cd /home/misaunders/source/clawcraft

# Kill old bot
tmux send-keys -t clawbot C-c

# Start fresh
tmux send-keys -t clawbot 'cd /home/misaunders/source/clawcraft && SEND_CMD="docker exec minecraft-survival send-command" node src/bot.js > /tmp/bot_out.log 2>&1' Enter
```

## Verify Running

```bash
node scripts/cmd.js '{"action":"status"}'
```

## Quick Commands

```bash
# Position
node scripts/cmd.js '{"action":"pos"}'

# Scan surroundings
node scripts/cmd.js '{"action":"scan","radius":4,"radiusY":2}'

# Nearby entities
node scripts/cmd.js '{"action":"nearby","radius":32}'

# Teleport (requires SEND_CMD)
node scripts/cmd.js '{"action":"tp","x":0,"y":64,"z":0}'

# Chat
node scripts/cmd.js '{"action":"chat","message":"hello"}'

# Recent events
node scripts/events.js --last 20
```

## Logs

```bash
tail -f /tmp/bot_out.log
```

## Direct Agent Usage (stdin/stdout, no skill)

For debugging sessions where an LLM agent talks to the bot directly via stdin/stdout, attach to the tmux session or pipe commands manually.

### Attach to bot stdin/stdout

The bot running in tmux has its stdout redirected to `/tmp/bot_out.log`. To interact via stdin directly, start the bot without the log redirect:

```bash
tmux send-keys -t clawbot C-c
tmux send-keys -t clawbot 'cd /home/misaunders/source/clawcraft && SEND_CMD="docker exec minecraft-survival send-command" node src/bot.js' Enter
```

Then send commands by typing directly into the tmux session:
```bash
tmux send-keys -t clawbot '{"action":"status"}' Enter
tmux send-keys -t clawbot '{"action":"nearby","radius":32}' Enter
```

### One-liner pipe (non-interactive)

```bash
echo '{"action":"scan"}' | SEND_CMD="docker exec minecraft-survival send-command" node src/bot.js
```

### Agent observe-decide-act loop (manual)

```bash
# 1. Observe
echo '{"action":"pos"}' | node src/bot.js 2>/dev/null
echo '{"action":"nearby","radius":32}' | node src/bot.js 2>/dev/null
echo '{"action":"scan","radius":4,"radiusY":2}' | node src/bot.js 2>/dev/null

# 2. Act
echo '{"action":"walk","x":10,"y":64,"z":10}' | node src/bot.js 2>/dev/null
```

> **Note:** Each pipe invocation starts a new bot connection. For multi-step sessions use the tmux approach (persistent process) or the TCP skill interface (`scripts/cmd.js`).

### Useful context for agent prompts

```
Bot is ClawBot on Minecraft Bedrock server 192.168.1.10:19132 (survival, 1.26.31).
Send JSON commands via: node scripts/cmd.js '{"action":"..."}' 
Read events via: node scripts/events.js --last 20
TCP port: 4099 (CLAWCRAFT_PORT env var)
Event log: ./events.jsonl (CLAWCRAFT_EVENTS env var)
All commands: pos, status, chat, say, whisper, emote, tp, move, setpos, face, nearby, block, blocks, chunks, scan, look, raycast, path, walk, cmd
```

