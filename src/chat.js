/**
 * ClawMine — Chat processing
 *
 * Handles incoming messages with:
 * - Whitelist filtering (CHAT_WHITELIST env)
 * - Prefix detection (CHAT_PREFIX env)
 * - Message sanitization (control chars, length cap)
 * - Structured output for the LLM agent
 */

const MAX_MSG_LENGTH = 500;

/**
 * Create chat config from environment variables.
 */
export function createChatConfig(env = process.env) {
  const whitelist = env.CHAT_WHITELIST
    ? env.CHAT_WHITELIST.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const prefix = env.CHAT_PREFIX || '';
  return { whitelist, prefix };
}

/**
 * Sanitize a message: strip control characters, cap length.
 */
export function sanitize(msg) {
  if (typeof msg !== 'string') return '';
  // Strip control characters (keep newlines for multiline messages)
  const cleaned = msg.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  return cleaned.length > MAX_MSG_LENGTH ? cleaned.slice(0, MAX_MSG_LENGTH) : cleaned;
}

/**
 * Process an incoming text packet. Returns a structured message object
 * to emit to the agent, or null if the message should be filtered out.
 */
export function processIncoming(pkt, config, botName) {
  if (!pkt || !pkt.message) return null;

  const msgType = pkt.type; // 'chat', 'whisper', 'system', 'announcement', etc.
  const from = pkt.source_name || '';
  const fromLower = from.toLowerCase();
  const botLower = (botName || '').toLowerCase();

  // Ignore own messages
  if (fromLower === botLower) return null;

  // Whitelist check (empty whitelist = allow all)
  if (config.whitelist.length > 0 && !config.whitelist.includes(fromLower)) {
    return null;
  }

  const raw = sanitize(pkt.message);
  if (!raw) return null;

  const whisper = msgType === 'whisper' || msgType === 'json_whisper';
  const system = msgType === 'system' || msgType === 'announcement';

  // Determine if message is directed at the bot
  let msg = raw;
  let direct = whisper; // whispers are always direct

  // Prefix check (if configured)
  if (config.prefix && !whisper && !system) {
    if (raw.toLowerCase().startsWith(config.prefix.toLowerCase())) {
      msg = raw.slice(config.prefix.length).trim();
      direct = true;
    } else {
      // Not prefixed — still emit as ambient chat but mark not direct
      direct = false;
    }
  }

  // Check for bot name mention
  if (!direct && botLower && raw.toLowerCase().includes(botLower)) {
    direct = true;
  }

  return {
    type: 'msg',
    from,
    msg,
    direct,
    whisper,
    system,
    timestamp: Date.now(),
  };
}
