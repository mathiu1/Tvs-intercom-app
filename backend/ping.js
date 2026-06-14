const URL = "https://tvs-intercom-app.onrender.com";

console.log(`Keep-alive ping configured for: ${URL}`);

// Using native Node.js fetch (Node 18+)
setInterval(
  async () => {
    try {
      const res = await fetch(URL);
      // console.log("Ping success:", res.status);
    } catch (err) {
      console.error("Ping failed:", err.message);
    }
  },
  5 * 60 * 1000,
);
