/** Per-route limits for expensive agent / automation actions. Login has its own caps. */
export const AGENT_ROUTE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' as const };

/** WebSocket upgrade (chat, terminal, session lists). */
export const WS_ROUTE_RATE_LIMIT = { max: 60, timeWindow: '1 minute' as const };

/** Revealing / copying the SSH private key from settings. */
export const SSH_PRIVATE_KEY_RATE_LIMIT = { max: 5, timeWindow: '1 minute' as const };
