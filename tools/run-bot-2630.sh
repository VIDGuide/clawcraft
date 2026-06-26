#!/bin/bash
# Run the bot against the 1.26.30 test server (mc-test-2630, port 19136).
cd /home/misaunders/source/clawcraft
export BOT=Move2630 CLAWCRAFT_PORT=4140
export HOST=192.168.1.10 PORT=19136 BOT_USERNAME=$BOT OFFLINE=true
export CLAWCRAFT_EVENTS=/tmp/move2630.jsonl
export SEND_CMD="docker exec mc-test-2630 send-command"
exec node src/bot.js
