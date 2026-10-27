/**
 * f(kill) authoritative relay.
 *
 * A small Node process that hosts rooms, validates intents and broadcasts the
 * authoritative match state over WebSockets. The browser client never decides
 * hits, damage, scores, cooldowns or turn ownership.
 *
 * Environment:
 *   PORT                  default 8787
 *   FKILL_ALLOWED_ORIGIN  comma-separated allowed browser origins (optional)
 *
 * Run: npm run relay
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomAuthority, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, sanitiseName } from './dist/authority.mjs';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGINS = (process.env.FKILL_ALLOWED_ORIGIN || '')
	.split(',')
	.map((o) => o.trim())
	.filter(Boolean);

const authority = new RoomAuthority();
authority.startTicking(250);

const MAX_MESSAGES_PER_WINDOW = 60;
const WINDOW_MS = 10_000;

const server = http.createServer((req, res) => {
	if (req.url === '/health') {
		const body = JSON.stringify({ ok: true, rooms: authority.roomCodes().length, protocol: PROTOCOL_VERSION });
		res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		res.end(body);
		return;
	}
	if (req.url === '/') {
		res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
		res.end('f(kill) relay is running. Connect a WebSocket to /ws.\n');
		return;
	}
	res.writeHead(404, { 'content-type': 'text/plain' });
	res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
	let pathname = '';
	try {
		pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
	} catch {
		socket.destroy();
		return;
	}
	if (pathname !== '/ws') {
		socket.destroy();
		return;
	}
	const origin = req.headers.origin;
	if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
		socket.destroy();
		return;
	}
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

/** ws -> connection metadata. */
const connections = new Map();

function send(ws, message) {
	if (ws.readyState !== 1) return;
	try {
		ws.send(JSON.stringify(message));
	} catch {
		ws.close();
	}
}

function sendSnapshot(ws, conn, now, force = true) {
	if (!conn.playerId) return;
	const room = authority.roomForPlayer(conn.playerId);
	if (!room) return;
	const snapshot = room.snapshot(conn.playerId, now);
	const changed = snapshot.revision !== conn.lastRevision;
	const stale = now - (conn.lastSentAt ?? 0) > 2000;
	if (!force && !changed && !stale) return;
	if (ws.readyState !== 1) return;
	send(ws, { t: 'snapshot', snapshot });
	conn.lastRevision = snapshot.revision;
	conn.lastSentAt = now;
}

wss.on('connection', (ws) => {
	const conn = {
		playerId: null,
		roomCode: null,
		windowStart: Date.now(),
		windowCount: 0,
		lastRevision: -1,
		lastSentAt: 0
	};
	connections.set(ws, conn);

	ws.on('message', (data, isBinary) => {
		const now = Date.now();
		if (isBinary) {
			send(ws, { t: 'error', code: 'binary', message: 'Binary frames are not supported.' });
			return;
		}
		if (now - conn.windowStart > WINDOW_MS) {
			conn.windowStart = now;
			conn.windowCount = 0;
		}
		conn.windowCount++;
		if (conn.windowCount > MAX_MESSAGES_PER_WINDOW) {
			send(ws, {
				t: 'error',
				code: 'rate-limited',
				message: 'Too many messages. Slow down.'
			});
			ws.close(1008, 'rate limit');
			return;
		}
		const raw = data.toString();
		if (raw.length > MAX_MESSAGE_BYTES) {
			send(ws, { t: 'error', code: 'too-large', message: 'Message too large.' });
			return;
		}
		let message;
		try {
			message = JSON.parse(raw);
		} catch {
			send(ws, { t: 'error', code: 'bad-json', message: 'Malformed message.' });
			return;
		}
		if (!message || typeof message !== 'object' || typeof message.t !== 'string') {
			send(ws, { t: 'error', code: 'bad-message', message: 'Malformed message.' });
			return;
		}

		try {
			switch (message.t) {
				case 'create': {
					if (conn.playerId) {
						send(ws, { t: 'error', code: 'already-in-room', message: 'Leave your current room first.' });
						return;
					}
					const result = authority.createRoom(
						sanitiseName(message.name, 'Host'),
						message.config ?? null,
						now
					);
					if (!result.ok) {
						send(ws, { t: 'error', code: result.code, message: result.message });
						return;
					}
					conn.playerId = result.player.id;
					conn.roomCode = result.code;
					conn.lastRevision = -1;
					send(ws, {
						t: 'welcome',
						protocol: PROTOCOL_VERSION,
						playerId: result.player.id,
						resumeToken: result.player.token,
						roomCode: result.code,
						snapshot: result.room.snapshot(result.player.id, now)
					});
					break;
				}
				case 'join': {
					if (conn.playerId) {
						send(ws, { t: 'error', code: 'already-in-room', message: 'Leave your current room first.' });
						return;
					}
					if (typeof message.code !== 'string') {
						send(ws, { t: 'error', code: 'bad-message', message: 'Missing room code.' });
						return;
					}
					const result = authority.join(
						message.code,
						sanitiseName(message.name, 'Player'),
						now,
						typeof message.resumeToken === 'string' ? message.resumeToken : undefined
					);
					if (!result.ok) {
						send(ws, { t: 'error', code: result.code, message: result.message });
						return;
					}
					conn.playerId = result.player.id;
					conn.roomCode = result.room.code;
					conn.lastRevision = -1;
					send(ws, {
						t: 'welcome',
						protocol: PROTOCOL_VERSION,
						playerId: result.player.id,
						resumeToken: result.player.token,
						roomCode: result.room.code,
						snapshot: result.room.snapshot(result.player.id, now)
					});
					break;
				}
				case 'resume': {
					if (typeof message.token !== 'string') {
						send(ws, { t: 'error', code: 'bad-message', message: 'Missing resume token.' });
						return;
					}
					const result = authority.resume(message.token, now);
					if (!result.ok) {
						send(ws, { t: 'error', code: result.code, message: result.message });
						return;
					}
					conn.playerId = result.player.id;
					conn.roomCode = result.room.code;
					conn.lastRevision = -1;
					send(ws, {
						t: 'welcome',
						protocol: PROTOCOL_VERSION,
						playerId: result.player.id,
						resumeToken: result.player.token,
						roomCode: result.room.code,
						snapshot: result.room.snapshot(result.player.id, now)
					});
					break;
				}
				case 'intent': {
					if (!conn.playerId) {
						send(ws, { t: 'error', code: 'no-session', message: 'Create or join a room first.' });
						return;
					}
					const intent = message.intent;
					if (!intent || typeof intent !== 'object' || typeof intent.kind !== 'string') {
						send(ws, { t: 'error', code: 'bad-intent', message: 'Malformed action.' });
						return;
					}
					const result = authority.intent(conn.playerId, intent, now);
					if (!result.ok) {
						send(ws, {
							t: 'error',
							code: result.code ?? 'rejected',
							message: result.message ?? 'Action rejected.'
						});
						return;
					}
					if (intent.kind === 'leave') {
						conn.playerId = null;
						conn.roomCode = null;
					}
					sendSnapshot(ws, conn, now);
					break;
				}
				case 'ping': {
					send(ws, { t: 'pong', at: message.at, serverTime: now });
					break;
				}
				default:
					send(ws, { t: 'error', code: 'unknown-message', message: 'Unknown message type.' });
			}
		} catch (err) {
			console.error('relay: failed to handle message', err);
			send(ws, { t: 'error', code: 'server-error', message: 'The relay could not process that request.' });
		}
	});

	ws.on('close', () => {
		if (conn.playerId) authority.disconnect(conn.playerId, Date.now());
		connections.delete(ws);
	});
	ws.on('error', () => {
		/* close handler cleans up */
	});
});

setInterval(() => {
	const now = Date.now();
	try {
		authority.tick(now);
	} catch (err) {
		console.error('relay: tick failed', err);
	}
	for (const [ws, conn] of connections) {
		if (!conn.playerId) continue;
		const room = authority.roomForPlayer(conn.playerId);
		if (!room) continue;
		if (room.phase === 'closed') {
			send(ws, { t: 'closed', reason: 'The room was closed.' });
			conn.playerId = null;
			continue;
		}
		sendSnapshot(ws, conn, now, false);
	}
}, 250);

server.listen(PORT, () => {
	console.log(`f(kill) relay listening on http://localhost:${PORT} (WebSocket: /ws)`);
});

function shutdown() {
	console.log('relay: shutting down');
	authority.stopTicking();
	for (const ws of connections.keys()) ws.close(1001, 'server shutting down');
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
