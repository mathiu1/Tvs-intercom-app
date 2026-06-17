const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/users - Get all users except the requesting user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } })
      .select('username email status')
      .sort({ status: 1, username: 1 }); // Online users first

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users.' });
  }
});

// GET /api/users/ice-servers - Get WebRTC ICE servers (dynamic from Metered.ca if API Key is configured)
router.get('/ice-servers', authMiddleware, async (req, res) => {
  const fallbackIceServers = [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["stun:stun.services.mozilla.com"] },
    { urls: ["stun:stun.relay.metered.ca:80"] },
    {
      urls: ["turn:openrelay.metered.ca:80"],
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: ["turn:openrelay.metered.ca:443"],
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: ["turn:openrelay.metered.ca:443?transport=tcp"],
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ];

  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) {
    // Fallback to static servers if API Key is not configured
    return res.json({ iceServers: fallbackIceServers });
  }

  // Fetch dynamic credentials from Metered.ca using Node's standard https module
  const https = require('https');
  https.get(`https://metered.ca/api/v1/turn/credentials?apiKey=${apiKey}`, (response) => {
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        
        // If the API key is incorrect or expired, Metered.ca returns an error object, not an array.
        if (!Array.isArray(parsed)) {
          console.warn('⚠️ Metered.ca API did not return an array. Falling back to static servers. Response:', parsed);
          return res.json({ iceServers: fallbackIceServers });
        }

        // Ensure urls is normalized to list of strings
        const iceServers = parsed.map(server => {
          return {
            urls: typeof server.urls === 'string' ? [server.urls] : server.urls,
            username: server.username || null,
            credential: server.credential || null
          };
        });
        res.json({ iceServers });
      } catch (e) {
        console.error('Error parsing Metered.ca response:', e);
        res.json({ iceServers: fallbackIceServers });
      }
    });
  }).on('error', (err) => {
    console.error('Metered.ca API request failed, falling back:', err);
    res.json({ iceServers: fallbackIceServers });
  });
});

module.exports = router;
