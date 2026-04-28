// Custom Node.js Server — Next.js + Socket.IO
//
// This server wraps the Next.js HTTP handler and attaches Socket.IO
// on the same port for real-time WebSocket communication.
//
// Skills applied:
//   - websocket-engineer: heartbeat/ping-pong, auth middleware,
//     rooms for per-user targeting, connection logging, cleanup
//   - nextjs-expert: custom server wrapping Next.js request handler
//
// Deploy: DigitalOcean App Platform runs `node server.js` (see package.json)

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { decode } = require("next-auth/jwt");

// Redis adapter is loaded lazily — see lib/socket-redis.ts for production scaling.
async function maybeAttachRedis(io) {
  if (!process.env.REDIS_URL) return false;
  try {
    const Redis = require("ioredis");
    const { createAdapter } = require("@socket.io/redis-adapter");
    const pub = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", event: "ws:redis_adapter_attached" }));
    return true;
  } catch (err) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "ERROR", event: "ws:redis_adapter_failed", error: err.message }));
    return false;
  }
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// NextAuth cookie name differs between dev and prod
const SESSION_COOKIE_NAME = dev
  ? "authjs.session-token"
  : "__Secure-authjs.session-token";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // ── Socket.IO Setup ──────────────────────────────────────────────────────
  // websocket-engineer: configure ping interval for keepalive,
  // maxHttpBufferSize for DDoS protection, CORS for same-origin
  const io = new Server(httpServer, {
    // 8-minute ping interval to prevent DigitalOcean's 10-min idle timeout
    pingInterval: 8 * 60 * 1000, // 480,000 ms
    pingTimeout: 30000, // 30s to respond before disconnect
    maxHttpBufferSize: 1e6, // 1MB max message size (DDoS protection)
    cors: {
      origin: process.env.NEXTAUTH_URL || `http://localhost:${port}`,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // ── Connection Metrics ───────────────────────────────────────────────────
  // websocket-engineer: log connection metrics (count, latency, errors)
  let connectionCount = 0;

  // ── Authentication Middleware (D2 fix) ────────────────────────────────────
  // websocket-engineer: authenticate connections using NextAuth JWT.
  // Parses the session cookie from the WebSocket handshake headers,
  // decodes and verifies it using the NEXTAUTH_SECRET, and extracts
  // the real userId. No spoofing possible.
  io.use(async (socket, next) => {
    try {
      // Extract cookies from the handshake headers
      const cookieHeader = socket.handshake.headers?.cookie || "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const [key, ...rest] = c.trim().split("=");
          return [key, rest.join("=")];
        })
      );

      const sessionToken = cookies[SESSION_COOKIE_NAME];
      if (!sessionToken) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "WARN",
            event: "ws:auth_failed",
            reason: "no_session_cookie",
            socketId: socket.id,
          })
        );
        return next(new Error("Authentication error: no session cookie"));
      }

      // Decode and verify the JWT using the same secret NextAuth uses
      const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
      if (!secret) {
        return next(new Error("Server misconfiguration: no auth secret"));
      }

      const token = await decode({
        token: sessionToken,
        secret,
        salt: SESSION_COOKIE_NAME,
      });

      if (!token || !token.id) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "WARN",
            event: "ws:auth_failed",
            reason: "invalid_jwt",
            socketId: socket.id,
          })
        );
        return next(new Error("Authentication error: invalid session"));
      }

      // Attach the verified userId to the socket
      socket.userId = Number(token.id);
      socket.userRole = token.role || "USER";
      next();
    } catch (err) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "ERROR",
          event: "ws:auth_error",
          error: err.message,
          socketId: socket.id,
        })
      );
      return next(new Error("Authentication error"));
    }
  });

  // ── Connection Handler ───────────────────────────────────────────────────
  io.on("connection", (socket) => {
    connectionCount++;
    const userId = socket.userId;

    // websocket-engineer: use rooms for per-user message targeting
    // Join a personal room so we can emit events to specific users
    socket.join(`user:${userId}`);

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "ws:connected",
        userId,
        socketId: socket.id,
        totalConnections: connectionCount,
      })
    );

    // ── Room Management ──────────────────────────────────────────────────
    // Join a contract-specific room to receive order book updates
    socket.on("join:contract", (contractId) => {
      if (typeof contractId !== "number") return;
      socket.join(`contract:${contractId}`);
    });

    socket.on("leave:contract", (contractId) => {
      if (typeof contractId !== "number") return;
      socket.leave(`contract:${contractId}`);
    });

    // ── Disconnect Handler ───────────────────────────────────────────────
    // websocket-engineer: handle connection cleanup
    socket.on("disconnect", (reason) => {
      connectionCount--;
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          event: "ws:disconnected",
          userId,
          socketId: socket.id,
          reason,
          totalConnections: connectionCount,
        })
      );
    });
  });

  // ── Expose io instance globally for Route Handlers to emit events ─────
  // This allows `app/api/orders/route.ts` to push real-time updates.
  global.__io = io;

  // ── Attach redis adapter for multi-pod scale ─────────────────────────────
  await maybeAttachRedis(io);

  // ── Start Server ─────────────────────────────────────────────────────────
  httpServer.listen(port, hostname, () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "server:started",
        url: `http://${hostname}:${port}`,
        websockets: true,
        authMethod: "nextauth-jwt",
        pingIntervalMs: 8 * 60 * 1000,
      })
    );
  });
});
