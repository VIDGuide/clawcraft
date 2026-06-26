#!/bin/bash
# Launch the capture relay tagged for capturing the BOT's own handshake
# (writes tools/capture-bot.jsonl) so it doesn't overwrite the real-client capture.
cd /home/misaunders/source/clawcraft
export DEBUG=''
export RELAY_PORT=19200
export DEST_HOST=192.168.1.10
export DEST_PORT=19132
export VERSION=1.26.30
export OFFLINE=true
export FILTER='*'
export CAPTURE_TAG='-bot'
exec node tools/capture-relay.js
