const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = (io) => {
  // In-memory userId -> socketId map for fast lookups (no DB queries on hot path)
  const userSocketMap = new Map();

  // Authenticate socket connections via JWT
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.username = user.username;
      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`🟢 User connected: ${socket.username} (${socket.id})`);

    // Update in-memory map
    userSocketMap.set(socket.userId, socket.id);

    // Update user status to online and store socket ID in DB
    await User.findByIdAndUpdate(socket.userId, {
      status: 'online',
      socketId: socket.id,
    });

    // Broadcast status change to all connected clients
    socket.broadcast.emit('user-status-changed', {
      userId: socket.userId,
      status: 'online',
    });

    // Log active connections
    console.log(`📊 Active connections: ${userSocketMap.size}`);

    // ========================
    // CALL SIGNALING EVENTS
    // ========================

    // User A initiates a call to User B
    socket.on('make-call', async (data) => {
      const { toUserId } = data;
      console.log(`📞 ${socket.username} calling user ${toUserId}`);

      const targetUser = await User.findById(toUserId);
      if (!targetUser || !targetUser.socketId) {
        socket.emit('call-error', { message: 'User is not available' });
        return;
      }

      if (targetUser.status === 'busy') {
        socket.emit('call-error', { message: 'User is busy on another call' });
        return;
      }

      // Use in-memory map for the actual emit (faster)
      const targetSocketId = userSocketMap.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('incoming-call', {
          fromUserId: socket.userId,
          fromUsername: socket.username,
        });
      } else {
        socket.emit('call-error', { message: 'User is not available' });
      }
    });

    // User B accepts the call
    socket.on('call-accepted', async (data) => {
      const { toUserId } = data;
      console.log(`✅ Call accepted by ${socket.username}`);

      // Use in-memory map for fast relay
      const callerSocketId = userSocketMap.get(toUserId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call-accepted', {
          fromUserId: socket.userId,
          fromUsername: socket.username,
        });
      }

      // Set both users to busy (DB update in background, not blocking signaling)
      User.findByIdAndUpdate(socket.userId, { status: 'busy' }).catch(() => {});
      User.findByIdAndUpdate(toUserId, { status: 'busy' }).catch(() => {});

      // Broadcast busy status
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'busy',
      });
      socket.broadcast.emit('user-status-changed', {
        userId: toUserId,
        status: 'busy',
      });
    });

    // User B declines the call
    socket.on('call-declined', (data) => {
      const { toUserId } = data;
      console.log(`❌ Call declined by ${socket.username}`);

      const callerSocketId = userSocketMap.get(toUserId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call-declined', {
          fromUserId: socket.userId,
          fromUsername: socket.username,
        });
      }
    });

    // ========================
    // WebRTC SIGNALING (HOT PATH — no DB queries!)
    // ========================

    // Forward WebRTC offer (uses in-memory map — instant relay)
    socket.on('offer', (data) => {
      const { toUserId, offer } = data;
      const targetSocketId = userSocketMap.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('offer', {
          fromUserId: socket.userId,
          offer,
        });
        console.log(`📤 Offer relayed: ${socket.username} → ${toUserId}`);
      }
    });

    // Forward WebRTC answer (uses in-memory map — instant relay)
    socket.on('answer', (data) => {
      const { toUserId, answer } = data;
      const targetSocketId = userSocketMap.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('answer', {
          fromUserId: socket.userId,
          answer,
        });
        console.log(`📤 Answer relayed: ${socket.username} → ${toUserId}`);
      }
    });

    // Forward ICE candidates (uses in-memory map — instant relay, NO DB query!)
    socket.on('ice-candidate', (data) => {
      const { toUserId, candidate } = data;
      const targetSocketId = userSocketMap.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('ice-candidate', {
          fromUserId: socket.userId,
          candidate,
        });
        console.log(`🧊 ICE Candidate relayed: ${socket.username} → ${toUserId}`);
      }
    });

    // End call
    socket.on('end-call', async (data) => {
      const { toUserId } = data;
      console.log(`🔴 Call ended by ${socket.username}`);

      const targetSocketId = userSocketMap.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call-ended', {
          fromUserId: socket.userId,
        });
      }

      // Set both users back to online (DB update in background)
      User.findByIdAndUpdate(socket.userId, { status: 'online' }).catch(() => {});
      User.findByIdAndUpdate(toUserId, { status: 'online' }).catch(() => {});

      // Broadcast online status
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'online',
      });
      socket.broadcast.emit('user-status-changed', {
        userId: toUserId,
        status: 'online',
      });
    });

    // ========================
    // DISCONNECT
    // ========================

    socket.on('disconnect', async () => {
      console.log(`🔴 User disconnected: ${socket.username} (${socket.id})`);

      // Remove from in-memory map
      userSocketMap.delete(socket.userId);

      await User.findByIdAndUpdate(socket.userId, {
        status: 'offline',
        socketId: null,
      });

      // Broadcast status change
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'offline',
      });

      console.log(`📊 Active connections: ${userSocketMap.size}`);
    });
  });
};
