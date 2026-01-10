// Filename: server.js


const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route → index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {

  socket.on('join', (roomId) => {
    socket.join(roomId);

    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients) {
      const existing = [...clients].filter(id => id !== socket.id);
      if (existing.length > 0) {
        socket.emit('existing_users', existing);
      }
    }

    socket.to(roomId).emit('user_joined', socket.id);
  });

  socket.on('offer', (data) => {
    socket.to(data.targetId).emit('offer', {
      senderId: socket.id,
      offer: data.offer
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.targetId).emit('answer', {
      senderId: socket.id,
      answer: data.answer
    });
  });

  socket.on('ice_candidate', (data) => {
    socket.to(data.targetId).emit('ice_candidate', {
      senderId: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnecting', () => {
    const rooms = [...socket.rooms].filter(r => r !== socket.id);
    rooms.forEach(r => socket.to(r).emit('user_left', socket.id));
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
