'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'battle-royale.html')));

const rooms = new Map(); // roomId -> { host, hostName, players:[{id,name,color}], started }

function makeRoomId() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += ch[Math.floor(Math.random() * ch.length)];
  return id;
}

function getRoomList() {
  const list = [];
  for (const [id, room] of rooms.entries()) {
    if (!room.started) {
      list.push({ id, hostName: room.hostName, playerCount: room.players.length, maxPlayers: 50 });
    }
  }
  return list;
}

function broadcastRoomList() {
  io.to('global-lobby').emit('room-list', getRoomList());
}

io.on('connection', socket => {
  socket.roomId = null;

  socket.on('join-global-lobby', () => {
    socket.join('global-lobby');
    socket.emit('room-list', getRoomList());
  });

  socket.on('create-room', ({ name }) => {
    let roomId;
    do { roomId = makeRoomId(); } while (rooms.has(roomId));

    rooms.set(roomId, {
      host: socket.id,
      hostName: name,
      players: [{ id: socket.id, name, color: '' }],
      started: false
    });
    socket.join(roomId);
    socket.leave('global-lobby');
    socket.roomId = roomId;

    socket.emit('room-created', { roomId });
    broadcastRoomList();
    console.log(`[+] Room ${roomId} created by ${name}`);
  });

  socket.on('join-room', ({ roomId, name }) => {
    const rid = roomId.toUpperCase();
    const room = rooms.get(rid);
    if (!room)                    { socket.emit('join-error', '방을 찾을 수 없습니다'); return; }
    if (room.started)             { socket.emit('join-error', '이미 시작된 게임입니다'); return; }
    if (room.players.length >= 50){ socket.emit('join-error', '방이 가득 찼습니다 (최대 50명)'); return; }

    room.players.push({ id: socket.id, name, color: '' });
    socket.join(rid);
    socket.leave('global-lobby');
    socket.roomId = rid;

    socket.emit('join-success', {
      playerIndex: room.players.length - 1,
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
    io.to(rid).emit('players-updated', room.players.map(p => ({ id: p.id, name: p.name })));
    broadcastRoomList();
    console.log(`[+] ${name} joined room ${rid} (${room.players.length} players)`);
  });

  socket.on('leave-room', () => {
    const room = rooms.get(socket.roomId);
    if (!room) {
      socket.join('global-lobby');
      socket.emit('room-list', getRoomList());
      return;
    }
    if (socket.id === room.host) {
      socket.to(socket.roomId).emit('room-closed', '호스트가 방을 나갔습니다');
      rooms.delete(socket.roomId);
      broadcastRoomList();
      console.log(`[-] Room ${socket.roomId} closed by host`);
    } else {
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(socket.roomId).emit('players-updated', room.players.map(p => ({ id: p.id, name: p.name })));
      broadcastRoomList();
    }
    socket.leave(socket.roomId);
    socket.roomId = null;
    socket.join('global-lobby');
    socket.emit('room-list', getRoomList());
  });

  socket.on('chat-message', ({ msg }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    io.to(socket.roomId).emit('chat-message', { name: player.name, msg });
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(socket.roomId).emit('game-started', {
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
    broadcastRoomList();
    console.log(`[>] Game started in room ${socket.roomId}`);
  });

  socket.on('game-state', state => {
    if (socket.roomId) socket.to(socket.roomId).emit('game-state', state);
  });

  socket.on('game-event', evt => {
    if (socket.roomId) socket.to(socket.roomId).emit('game-event', evt);
  });

  socket.on('player-input', input => {
    const room = rooms.get(socket.roomId);
    if (room) io.to(room.host).emit('player-input', { id: socket.id, input });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    if (socket.id === room.host) {
      socket.to(socket.roomId).emit('room-closed', '호스트 연결이 끊겼습니다');
      rooms.delete(socket.roomId);
      broadcastRoomList();
      console.log(`[-] Room ${socket.roomId} closed (host disconnected)`);
    } else {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (!room.started) {
        io.to(socket.roomId).emit('players-updated', room.players.map(p => ({ id: p.id, name: p.name })));
        broadcastRoomList();
      }
      io.to(room.host).emit('player-disconnected', { id: socket.id });
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🥊 배틀로얄 서버 실행 중: http://localhost:${PORT}\n`);
});
