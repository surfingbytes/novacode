/**
 * Decide whether an incoming chat `history` frame should replace local messages.
 *
 * The chat WS used to register the socket, then await DB history, then send it.
 * A fast first prompt could deliver `prompt-started` before that stale empty
 * snapshot arrived, and replacing wiped the turn (named session, empty pane).
 */
export function shouldRetainLocalChatHistory(
  incomingLength: number,
  localLength: number
): boolean {
  return incomingLength === 0 && localLength > 0;
}
