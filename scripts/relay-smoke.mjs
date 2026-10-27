/**
 * End-to-end relay smoke test: two real WebSocket clients, room create/join,
 * ready, start, attack, reconnect. Run while the relay is listening:
 *   node scripts/relay-smoke.mjs [ws://localhost:8787/ws]
 */
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://localhost:8787/ws';
const clients = [];

function connect(name) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const client = { ws, name, messages: [], snapshots: [] };
		ws.on('message', (data) => {
			const msg = JSON.parse(data.toString());
			client.messages.push(msg);
			if (msg.t === 'welcome') {
				client.playerId = msg.playerId;
				client.token = msg.resumeToken;
				client.roomCode = msg.roomCode;
			}
			if (msg.t === 'snapshot') client.snapshots.push(msg.snapshot);
			if (msg.t === 'error') client.lastError = msg;
			if (msg.t === 'welcome') {
				client.snapshots.push(msg.snapshot);
				resolve(client);
			}
		});
		ws.on('error', reject);
		ws.on('open', () => {
			ws.send(JSON.stringify({ t: 'create', name }));
		});
		clients.push(client);
	});
}

function latest(client) {
	return client.snapshots[client.snapshots.length - 1];
}

function waitFor(predicate, timeoutMs = 10000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			const value = predicate();
			if (value) {
				clearInterval(timer);
				resolve(value);
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(timer);
				reject(new Error('timed out waiting for condition'));
			}
		}, 100);
	});
}

function send(client, message) {
	client.ws.send(JSON.stringify(message));
}

async function main() {
	const host = await connect('Relay Host');
	console.log('created room', host.roomCode);

	const guestWs = new WebSocket(url);
	const guest = { ws: guestWs, name: 'Guest', messages: [], snapshots: [] };
	guestWs.on('message', (data) => {
		const msg = JSON.parse(data.toString());
		guest.messages.push(msg);
		if (msg.t === 'welcome') {
			guest.playerId = msg.playerId;
			guest.token = msg.resumeToken;
			guest.snapshots.push(msg.snapshot);
		}
		if (msg.t === 'snapshot') guest.snapshots.push(msg.snapshot);
		if (msg.t === 'error') guest.lastError = msg;
	});
	await new Promise((resolve) => guestWs.on('open', resolve));
	send(guest, { t: 'join', code: host.roomCode, name: 'Guest' });
	await waitFor(() => guest.snapshots.length > 0);
	console.log('guest joined', guest.playerId);

	send(host, { t: 'intent', seq: 1, intent: { kind: 'ready', ready: true } });
	send(guest, { t: 'intent', seq: 1, intent: { kind: 'ready', ready: true } });
	await waitFor(() => latest(host)?.players.every((p) => p.ready));

	send(host, { t: 'intent', seq: 2, intent: { kind: 'start' } });
	const running = await waitFor(() => {
		const snap = latest(host);
		return snap?.phase === 'running' ? snap : null;
	});
	console.log('match running; graphers', running.state.graphers.length);

	const own = running.state.graphers.find((g) => g.ownerId === host.playerId);
	const enemy = running.state.graphers.find((g) => g.ownerId === guest.playerId);
	if (!own || !enemy) throw new Error('missing graphers');
	send(host, {
		t: 'intent',
		seq: 3,
		intent: {
			kind: 'submit-attack',
			grapherId: own.id,
			components: [{ kind: 'function', expression: `y = ${enemy.position.y}` }]
		}
	});
	const after = await waitFor(() => {
		const snap = latest(host);
		return snap?.state?.attacks?.length > 0 ? snap : null;
	});
	console.log('attack recorded:', after.state.attacks[0].totalScore, 'points,', after.state.attacks[0].targetsHit, 'hits');

	// Reconnect: open a fresh socket and resume with the token.
	host.ws.close();
	await new Promise((r) => setTimeout(r, 500));
	const resumed = new WebSocket(url);
	const resumedMessages = [];
	const welcome = await new Promise((resolve, reject) => {
		resumed.on('open', () => {
			resumed.send(JSON.stringify({ t: 'resume', token: host.token }));
		});
		resumed.on('message', (data) => {
			const msg = JSON.parse(data.toString());
			resumedMessages.push(msg);
			if (msg.t === 'welcome') resolve(msg);
			if (msg.t === 'error') reject(new Error(msg.message));
		});
	});
	if (welcome.playerId !== host.playerId) throw new Error('identity changed after reconnect');
	console.log('reconnected with the same player id');

	resumed.close();
	guestWs.close();
	await new Promise((r) => setTimeout(r, 200));
	console.log('relay smoke test passed');
	process.exit(0);
}

main().catch((err) => {
	console.error('SMOKE TEST FAILED:', err.message);
	process.exit(1);
});
