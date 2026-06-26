# Real-client packet capture findings (1.26.31 server, captured via relay)

Captured 736 `player_auth_input` packets from a real Bedrock console client
walking, mining, and placing blocks, proxied through `tools/capture-relay.js`.
Raw decoded data: `tools/capture.jsonl`. Representative samples:
`tools/REAL-CLIENT-FINDINGS.json`.

## Headline: our bot's movement model was wrong on three counts

### 1. Movement is driven by `move_vector`, NOT the `up` input flag
The real client **never sets `up:true`** while walking. It expresses movement
purely through the analog move vectors:
- `move_vector`, `analogue_move_vector`, `raw_move_vector` all carry the same
  value, an **analog magnitude 0..1** in LOCAL space (z = forward).
- On key press it **ramps up**: `0.0348 → 0.3913 → 0.7565 → 0.9043 → 0.9304 → ... → 1.0`,
  and ramps back down to 0 on release. Full speed is magnitude ~1.0 (273/736
  packets were >0.9).

Our bot sent `up:true` + `move_vector:{x:0,z:1}`. The `up` boolean is not how
the modern client signals walking; the server reads the analog vector.

### 2. `tick` is a simple monotonic counter from session start — NOT server current_tick
- Captured ticks were **203, 204, 205, ... 938** — strictly +1 per packet, **zero
  gaps** across all 736 packets.
- The server's `start_game.current_tick` was ~2.6 million. The client's input
  `tick` is its OWN frame counter that began at 0 when the session started
  (~203 ticks / ~10s before our first captured packet).

Our bot extrapolated the server's `current_tick` by wall-clock. That produced a
tick wildly out of range, which (under server-auth-with-rewind) the server
rejects. **Fix: maintain a local tick counter starting at 0 (or seeded from the
first move_player), incremented by exactly 1 each input packet sent at 20 Hz.**

### 3. Rotation IS in degrees (confirms our earlier fix)
`yaw: -94.27`, `head_yaw: -98.11`, `pitch: 0` — degrees, range ±180. Confirms the
radians→degrees fix was correct. Note head_yaw can differ from yaw (head vs body).

## Other observed details
- `position` is the client-predicted position, updated every tick (local
  prediction); it drifts smoothly as the client moves. `delta` is the per-tick
  velocity (small values like `{x:0.0018, y:-0.0784, z:-0.0001}`).
- `input_mode`, `play_mode`, `interaction_model` carried by the client — see
  REAL-CLIENT-FINDINGS.json for exact values per sample.
- Flags seen TRUE across the session: `block_action`, `block_breaking_delay_enabled`,
  `horizontal_collision`, `vertical_collision`, `jumping`, `jump_down`,
  `start_jumping`, `jump_pressed_raw/current_raw/released_raw`, `want_up`,
  `persist_sneak`. So collision flags and jump-raw flags ARE used by the real
  client; `block_breaking_delay_enabled` is set even at rest.
- Mining/placing happen via `block_action` in the auth-input stream (consistent
  with our server-auth block-breaking code path).

## Implications for the bot's movement implementation
To replicate real-client walking:
1. Drive movement with `move_vector`/`analogue_move_vector`/`raw_move_vector` as
   a local-space analog vector (z=forward), magnitude up to 1.0; leave `up` false.
2. Use a **local monotonic tick** starting at 0, +1 per 20 Hz input packet — do
   NOT use server current_tick.
3. Keep yaw/pitch/head_yaw in degrees (already fixed).
4. Update `position` as the client-predicted position each tick (we already do),
   and set `delta` to the per-tick velocity.
5. Set collision flags (`horizontal_collision`/`vertical_collision`) based on
   movement outcome if we want to match the client closely (optional v1).

## Protocol-version caveat (still relevant)
The server is 1.26.31; bedrock-protocol 3.57.0 negotiates 1.26.30. `player_auth_input`
DID decode cleanly under 1.26.30, so the movement packet layout is compatible.
However some clientbound packets (e.g. `biome_definition_list`) do NOT parse under
1.26.30 — the relay forwards those raw. For the BOT (which only needs to SEND
auth_input and a few packets, and parse the ones it cares about), the 1.26.30
schema appears workable for movement IF we fix the model above. The earlier
`command_request` rejection is a separate issue (still under investigation).

## UPDATE: ground-truth verification of the rewritten movement (still rejected)

After rewriting `buildPlayerAuthInput` to match the capture (analog move_vector,
local tick from 0, degrees, ground flags) we verified server-side via
`querytarget` (docker logs). Findings:

- **A real-client `player_auth_input` round-trips BYTE-IDENTICAL through the
  bundled 1.26.30 serializer.** We decoded a captured moving packet (move_vector
  {0,1}) and re-encoded it: `buf.equals(re) === true`. So our wire encoding is
  not the problem — we can produce the exact bytes the real client sent.
- Despite that, a bot that sends those byte-identical inputs **does not move
  server-side**, and receives **zero `correct_player_move_prediction`**. The
  server accepts our RESTING position (querytarget confirms it) and `tp` works,
  but move_vector-driven walking is silently ignored.
- Tested exhaustively, all REJECTED (0.00 blocks server-side, 0 corrections):
  - paced 20 Hz vs synchronous burst
  - position advanced ~0.2/tick along yaw, with matching `delta` velocity
  - position held constant (pure server-authority)
  - from natural spawn (no tp) and after a confirmed tp to solid ground
  - continuous idle stream established first so the player is "live"/simulated
- The differentiator between the real client and our bot is therefore NOT in the
  per-packet `player_auth_input` contents. It is almost certainly **session/state**:
  the real client completes a fuller spawn/init handshake (resource packs, entity
  init, server settling) that transitions the server-side player into the
  movement-simulated state. Our bot reaches `spawn` and streams input the server
  accepts at rest, but the server never simulates our movement.
- The bit-field `_value` differs between idle and moving only in already-named
  flags (persist_sneak bit24, vertical_collision bit50) — no unknown 1.26.31 bits.

### Recommended next steps (not yet done)
1. Capture the FULL serverbound handshake from the real client (login → spawn →
   first movement) via the relay with FILTER='*', and diff the bot's handshake
   sequence against it. Look for packets the real client sends that the bot does
   not (e.g. `set_local_player_as_initialized` timing, `player_action` spawn,
   `respawn` ack, `interact`, `tick_sync`, request_chunk_radius, container/close).
2. In particular check whether the client sends a specific packet right before its
   first accepted movement, and whether `handled_teleport` / a teleport-ack is
   required after server `move_player`.
3. Consider testing against a 1.26.30 server (matches the bundled protocol) to
   rule out residual version drift in the movement-simulation path.

The capture artifacts (`capture.jsonl`, `capture-raw.log`) are preserved for this
handshake diff.

## BREAKTHROUGH: full-handshake capture reveals the real cause (session sequencing)

Full-sequence capture (FILTER='*', `tools/capture.jsonl`, 13932 packets) of a real
console client's login→spawn→movement shows the bot's connection lifecycle is
WRONG in ways that prevent server-side movement simulation:

### Real client's spawn/init order (serverbound highlights)
```
client_cache_status
resource_pack_client_response (x2)
... (server sends start_game, registries, chunks) ...
request_chunk_radius
serverbound_loading_screen {type: 1}   ← loading STARTED
... many client_cache_blob_status + subchunk_request (chunks loading) ...
interact, mob_equipment, emote_list
player_auth_input  (tick=115)          ← STREAMING INPUT STARTS (idle, mv=0)
... ~11 more player_auth_input + subchunk_request, chunks finish ...
serverbound_loading_screen {type: 2}   ← loading FINISHED
set_local_player_as_initialized        ← SENT ONLY NOW (tick ~126)
player_auth_input ...                   (continues; movement works after this)
```

Key facts:
- The client **streams `player_auth_input` (idle) BEFORE** `set_local_player_as_initialized`.
  ~11 auth_input packets are sent first.
- `set_local_player_as_initialized` is sent **late** — only after chunks load and a
  `serverbound_loading_screen {type:2}` (loading finished) — at input tick ~126.
- The client sends `serverbound_loading_screen` (type 1 = start, type 2 = finish)
  around the load. The bot sends neither.
- The first auth_input tick is 115 (not 0) — the client counts ticks from the
  start of its spawn process, before init.

### What the bot does WRONG (src/bot.js `join` handler, ~line 240)
- Sends `set_local_player_as_initialized` **500ms after join — IMMEDIATELY**,
  before chunks load and before ANY player_auth_input is streamed.
- Never sends `serverbound_loading_screen`.
- Starts its auth_input heartbeat only on `spawn` (after init), so the server never
  sees the "idle input stream during loading, THEN init" sequence.

### Hypothesis (high confidence)
The server only transitions the player into the movement-simulated state when it
receives `set_local_player_as_initialized` in the RIGHT context: after the client
has loaded chunks AND has been streaming auth_input. The bot's premature init (no
prior input stream, no loading-screen, before chunks) leaves the server-side player
in a state where it accepts resting position and teleports but never simulates
move_vector. This explains why byte-identical move packets are silently ignored
with zero corrections.

### Fix to implement (connection lifecycle rewrite)
1. On `join`/`start_game`: begin the 20Hz `player_auth_input` heartbeat (idle,
   move_vector 0) immediately, with the local tick counting from 0.
2. Send `serverbound_loading_screen {type:1}` early, `request_chunk_radius`, then
   request subchunks; let chunks load while the idle input stream runs.
3. Send `serverbound_loading_screen {type:2}` and THEN
   `set_local_player_as_initialized` once chunks/position are settled (mirror the
   real client: ~a dozen idle auth_inputs in, after chunk load).
4. Only after that does movement (non-zero move_vector) get simulated.

NOTE: this reorders the existing chicken-and-egg subchunk workaround — verify
chunks still arrive. The bedrock-protocol lib auto-sends client_cache_status and
resource_pack responses; we add the loading-screen + reordered init + early
heartbeat.

## RESEARCH: how mature implementations solve this (gophertunnel + bedrock-protocol)

Researched the reference implementations. This IS a solved problem; our bot
diverged from the standard sequence.

### gophertunnel (Go, the de-facto reference) — conn.go
The client spawn sequence is gated on TWO server signals, then sends init:
1. receive `StartGame` → send `RequestChunkRadius{16}`
2. receive `ChunkRadiusUpdated` → mark gameDataReceived
3. receive `PlayStatus{PlayerSpawn}` → mark waitingForSpawn
4. `tryFinaliseClientConn()`: only when BOTH ChunkRadiusUpdated AND
   PlayStatus{PlayerSpawn} have arrived, it sends `SetLocalPlayerAsInitialised`.
So init is sent **after the server says PlayerSpawn**, never on a timer.

### PrismarineJS bedrock-protocol (the lib THIS bot uses) — client.js onPlayStatus()
The library ALREADY implements the correct logic, identical to gophertunnel:
```js
onPlayStatus (statusPacket) {
  if (this.status === Initializing && this.options.autoInitPlayer === true) {
    if (statusPacket.status === 'player_spawn') {
      this.status = Initialized
      this.write('set_local_player_as_initialized', { runtime_entity_id: this.entityId })
      this.emit('spawn')
    }
  }
}
```
`autoInitPlayer` defaults to `true`, and our bot does NOT disable it.

### Confirmed against our capture
- `chunk_radius_update` at index 97
- `play_status {player_spawn}` at index 849
- real client sends `set_local_player_as_initialized` at index 1162 (after spawn)
Exactly matches gophertunnel/bedrock-protocol's "wait for player_spawn" rule.

### THE ACTUAL BUG (much simpler than a lifecycle rewrite)
src/bot.js `join` handler sends `set_local_player_as_initialized` on a **500ms
timer**, immediately after join — BEFORE chunks, BEFORE play_status:player_spawn.
This premature/duplicate init (the library would also send the correct one on
player_spawn) corrupts the spawn sequence, leaving the server-side player in a
state that accepts resting position + teleport but never simulates move_vector.

The bot's own comment calls it a workaround for a "chunk deadlock" (server won't
send subchunks until init). But the right fix per the reference impls is to let
the library's `play_status: player_spawn` → init fire naturally, and request
chunks at the right time, NOT to force init early on a timer.

### FIX (revised — minimal)
1. REMOVE the manual `set_local_player_as_initialized` 500ms timer in the `join`
   handler. Let the library send it on `play_status: player_spawn` (autoInitPlayer).
2. Start the 20Hz idle player_auth_input heartbeat early (it's harmless and the
   real client streams idle input during loading), tick from 0.
3. Move subchunk requests to AFTER the `spawn` event (which now fires at the
   correct time) instead of the artificial post-init timer.
4. Verify chunks still arrive (the original deadlock the workaround addressed) —
   if the server truly needs init before subchunks, request chunk radius via the
   normal flow and rely on the library's spawn, not a manual early init.

## How to reproduce the capture
1. `bash tools/run-relay.sh` (listens UDP 19200 → 192.168.1.10:19132, offline)
2. Console → bedrock-connect → "🔬 Survival (CAPTURE relay)"
3. Walk/act, then Ctrl-C the relay for a packet-count summary.
Requires the login-chain patch in
`node_modules/bedrock-protocol/src/handshake/loginVerify.js` (decode MCToken
without x5u verification — see git diff / that file).
