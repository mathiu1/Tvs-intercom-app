require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const setupSignaling = require("./socket/signalingHandler");

require("./ping.js");

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS — optimized for 50+ concurrent calls
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB — handles bursts of ICE candidates
  transports: ["websocket", "polling"], // Prefer WebSocket for lower latency
  allowUpgrades: true,
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "running",
    service: "VoIP Intercom Server",
    timestamp: new Date().toISOString(),
  });
});

// Setup Socket.io signaling
setupSignaling(io);

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    server.listen(PORT, () => {
      console.log("");
      console.log("╔══════════════════════════════════════════╗");
      console.log("║   🎙️  VoIP Intercom Server Running       ║");
      console.log(`║   📡 Port: ${PORT}                          ║`);
      console.log("║   🔌 Socket.io: Ready                    ║");
      console.log("║   📦 MongoDB: Connected                  ║");
      console.log("╚══════════════════════════════════════════╝");
      console.log("");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
