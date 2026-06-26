#!/bin/bash
# Launch the capture relay fully detached from the controlling shell.
cd /home/misaunders/source/clawcraft
export DEBUG='minecraft-protocol'
export RELAY_PORT=19200
export DEST_HOST=192.168.1.10
export DEST_PORT=19132
export VERSION=1.26.30
export OFFLINE=true
# FILTER='*' logs the FULL packet sequence (every name + order), with heavy
# packets (chunks, big tables) recorded as name+size only. Override by exporting
# FILTER before running, e.g. FILTER=player_auth_input for a movement-only capture.
export FILTER="${FILTER:-*}"
exec node tools/capture-relay.js
