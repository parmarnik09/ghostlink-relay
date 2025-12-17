/**
 * GhostLink Relay Server
 * A RAM-only, zero-log WebSocket relay.
 * 
 * Logic:
 * 1. Clients connect and send JOIN {roomHash}.
 * 2. Server groups clients into rooms (Max 2 per room).
 * 3. Server forwards messages to the other peer in the room.
 * 4. On disconnect, the room is cleared.
 */

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Memory store: { roomHash: Set<WebSocket> }
const rooms = new Map();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 1. Handle JOIN
      if (data.type === 'JOIN') {
        const roomHash = data.payload;
        
        if (!rooms.has(roomHash)) {
          rooms.set(roomHash, new Set());
        }

        const room = rooms.get(roomHash);

        if (room.size >= 2) {
          ws.send(JSON.stringify({ type: 'FULL', payload: 'Room is full' }));
          return;
        }

        room.add(ws);
        ws.room = roomHash;
        
        // Notify peer if exists
        if (room.size === 2) {
          broadcastToRoom(ws, { type: 'HELLO' });
        }
        return;
      }

      // 2. Handle Forwarding
      if (ws.room && rooms.has(ws.room)) {
        broadcastToRoom(ws, data);
      }

    } catch (e) {
      console.error('Invalid message format');
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      const room = rooms.get(ws.room);
      room.delete(ws);
      
      // Notify remaining peer
      room.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'DISCONNECT' }));
        }
      });

      if (room.size === 0) {
        rooms.delete(ws.room);
      }
    }
  });
});

function broadcastToRoom(sender, data) {
  const room = rooms.get(sender.room);
  if (!room) return;

  room.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Heartbeat to keep connections alive
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

console.log(`GhostLink Relay active on port ${PORT}`);
