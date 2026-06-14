const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = (io) => {
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

    // Update user status to online and store socket ID
    await User.findByIdAndUpdate(socket.userId, {
      status: 'online',
      socketId: socket.id,
    });

    // Broadcast status change to all connected clients
    socket.broadcast.emit('user-status-changed', {
      userId: socket.userId,
      status: 'online',
    });

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

      // Send incoming call to the target user
      io.to(targetUser.socketId).emit('incoming-call', {
        fromUserId: socket.userId,
        fromUsername: socket.username,
      });
    });

    // User B accepts the call
    socket.on('call-accepted', async (data) => {
      const { toUserId } = data;
      console.log(`✅ Call accepted by ${socket.username}`);

      const callerUser = await User.findById(toUserId);
      if (callerUser && callerUser.socketId) {
        io.to(callerUser.socketId).emit('call-accepted', {
          fromUserId: socket.userId,
          fromUsername: socket.username,
        });
      }

      // Set both users to busy
      await User.findByIdAndUpdate(socket.userId, { status: 'busy' });
      await User.findByIdAndUpdate(toUserId, { status: 'busy' });

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
    socket.on('call-declined', async (data) => {
      const { toUserId } = data;
      console.log(`❌ Call declined by ${socket.username}`);

      const callerUser = await User.findById(toUserId);
      if (callerUser && callerUser.socketId) {
        io.to(callerUser.socketId).emit('call-declined', {
          fromUserId: socket.userId,
          fromUsername: socket.username,
        });
      }
    });

    // ========================
    // WebRTC SIGNALING
    // ========================

    // Forward WebRTC offer
    socket.on('offer', async (data) => {
      const { toUserId, offer } = data;
      const targetUser = await User.findById(toUserId);
      if (targetUser && targetUser.socketId) {
        io.to(targetUser.socketId).emit('offer', {
          fromUserId: socket.userId,
          offer,
        });
      }
    });

    // Forward WebRTC answer
    socket.on('answer', async (data) => {
      const { toUserId, answer } = data;
      const targetUser = await User.findById(toUserId);
      if (targetUser && targetUser.socketId) {
        io.to(targetUser.socketId).emit('answer', {
          fromUserId: socket.userId,
          answer,
        });
      }
    });

    // Forward ICE candidates
    socket.on('ice-candidate', async (data) => {
      const { toUserId, candidate } = data;
      const targetUser = await User.findById(toUserId);
      if (targetUser && targetUser.socketId) {
        io.to(targetUser.socketId).emit('ice-candidate', {
          fromUserId: socket.userId,
          candidate,
        });
      }
    });

    // End call
    socket.on('end-call', async (data) => {
      const { toUserId } = data;
      console.log(`🔴 Call ended by ${socket.username}`);

      const targetUser = await User.findById(toUserId);
      if (targetUser && targetUser.socketId) {
        io.to(targetUser.socketId).emit('call-ended', {
          fromUserId: socket.userId,
        });
      }

      // Set both users back to online
      await User.findByIdAndUpdate(socket.userId, { status: 'online' });
      await User.findByIdAndUpdate(toUserId, { status: 'online' });

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

      await User.findByIdAndUpdate(socket.userId, {
        status: 'offline',
        socketId: null,
      });

      // Broadcast status change
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'offline',
      });
    });
  });
};
