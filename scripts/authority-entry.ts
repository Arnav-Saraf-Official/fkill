/**
 * Entry point bundled for the Node relay. The relay runs the same room and
 * match code as the app; bundling with esbuild keeps TypeScript out of the
 * runtime path without duplicating logic.
 */

export { RoomAuthority, Room, projectStateForViewer } from '../src/lib/multiplayer/room';
export { PROTOCOL_VERSION, MAX_MESSAGE_BYTES, sanitiseName, parseMessage } from '../src/lib/multiplayer/protocol';
export type { ClientMessage, ClientIntent, ServerMessage, RoomSnapshot } from '../src/lib/multiplayer/protocol';
