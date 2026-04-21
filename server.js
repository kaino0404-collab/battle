'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'battle-royale.html')));

const rooms = new Map(); // roomId -> { host, players:[{id,name}], started }

function makeRoomId() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += ch[Math.floor(Math.random() * ch.length)];
  return id;
}

io.on('connection', socket => {
  socket.roomId = null;

  socket.on('create-room', ({ name }) => {
    let roomId;
    do { roomId = makeRoomId(); } while (rooms.has(roomId));

    rooms.set(roomId, {
      host: socket.id,
      players: [{ id: socket.id, name }],
      started: false
    });
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit('room-created', { roomId });
    console.log(`[+] Room ${roomId} created by ${name}`);
  });

  socket.on('join-room', ({ roomId, name }) => {
    const rid = roomId.toUpperCase();
    const room = rooms.get(rid);
    if (!room)          { socket.emit('join-error', '방을 찾을 수 없습니다'); return; }
    if (room.started)   { socket.emit('join-error', '이미 시작된 게임입니다'); return; }
    if (room.players.length >= 10) { socket.emit('join-error', '방이 가득 찼습니다'); return; }

    room.players.push({ id: socket.id, name });
    socket.join(rid);
    socket.roomId = rid;

    socket.emit('join-success', {
      playerIndex: room.players.length - 1,
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
    // 방 전원에게 갱신 전송
    io.to(rid).emit('players-updated', room.players.map(p => ({ id: p.id, name: p.name })));
    console.log(`[+] ${name} joined room ${rid} (${room.players.length} players)`);
  });

  // 호스트가 게임 시작
  socket.on('start-game', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(socket.roomId).emit('game-started', {
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
    console.log(`[>] Game started in room ${socket.roomId}`);
  });

  // 호스트 → 클라이언트 게임 상태 브로드캐스트
  socket.on('game-state', state => {
    if (socket.roomId) socket.to(socket.roomId).emit('game-state', state);
  });

  // 호스트 → 클라이언트 이벤트 (파티클/폭발/로그 등)
  socket.on('game-event', evt => {
    if (socket.roomId) socket.to(socket.roomId).emit('game-event', evt);
  });

  // 클라이언트 → 호스트 입력 릴레이
  socket.on('player-input', input => {
    const room = rooms.get(socket.roomId);
    if (room) io.to(room.host).emit('player-input', { id: socket.id, input });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    if (socket.id === room.host) {
      // 호스트 나감 → 방 해산
      socket.to(socket.roomId).emit('room-closed', '호스트 연결이 끊겼습니다');
      rooms.delete(socket.roomId);
      console.log(`[-] Room ${socket.roomId} closed (host left)`);
    } else {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (!room.started) {
        io.to(socket.roomId).emit('players-updated', room.players.map(p => ({ id: p.id, name: p.name })));
      }
      io.to(room.host).emit('player-disconnected', { id: socket.id });
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🥊 배틀로얄 서버 실행 중: http://localhost:${PORT}\n`);
});
