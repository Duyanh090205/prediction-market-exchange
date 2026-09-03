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
const { startDiscordDrainer } = require("./lib/discord/drainerRunner");

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
const basePath = process.env.TRADING_BASE_PATH || "";
const socketPath = `${basePath}/socket.io`;
const corsOrigin = (() => {
  try {
    const nextAuthUrl = process.env.NEXTAUTH_URL || `http://localhost:${port}`;
    return new URL(nextAuthUrl).origin;
  } catch {
    return `http://localhost:${port}`;
  }
})();

// NextAuth cookie name differs between dev and prod
const SESSION_COOKIE_NAME = dev
  ? "authjs.session-token"
  : "__Secure-authjs.session-token";

/** @param {string} [cookieHeader] */
function parseCookieHeader(cookieHeader) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    let val = part.slice(idx + 1).trim();
    try {
      val = decodeURIComponent(val);
    } catch {
      // keep raw
    }
    if (key) out[key] = val;
  }
  return out;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  /**
   * Match `lib/labAuth.ts`: resolve the NextAuth session cookie to a user id
   * and role for Socket.IO.
   * @param {Record<string, string>} cookies
   */
  async function resolveUserFromSocketCookies(cookies) {
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      return null;
    }

    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("Server misconfiguration: no auth secret");
    }

    const token = await decode({
      token: sessionToken,
      secret,
      salt: SESSION_COOKIE_NAME,
    });

    if (!token || !token.id) {
      return null;
    }

    return { userId: Number(token.id), role: token.role || "USER" };
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // ── Socket.IO Setup ──────────────────────────────────────────────────────
  // websocket-engineer: configure ping interval for keepalive,
  // maxHttpBufferSize for DDoS protection, CORS for same-origin
  const io = new Server(httpServer, {
    path: socketPath,
    // 8-minute ping interval to prevent DigitalOcean's 10-min idle timeout
    pingInterval: 8 * 60 * 1000, // 480,000 ms
    pingTimeout: 30000, // 30s to respond before disconnect
    maxHttpBufferSize: 1e6, // 1MB max message size (DDoS protection)
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // ── Connection Metrics ───────────────────────────────────────────────────
  // websocket-engineer: log connection metrics (count, latency, errors)
  let connectionCount = 0;
  let publicConnectionCount = 0;

  // ── Authentication Middleware ─────────────────────────────────────────────
  // The NextAuth JWT cookie, same as the HTTP middleware.
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers?.cookie || "";
      const cookies = parseCookieHeader(cookieHeader);

      const resolved = await resolveUserFromSocketCookies(cookies);
      if (!resolved) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "WARN",
            event: "ws:auth_failed",
            reason: "no_valid_session",
            socketId: socket.id,
          })
        );
        return next(new Error("Authentication error: no session cookie"));
      }

      socket.userId = resolved.userId;
      socket.userRole = resolved.role;
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

  // ── Public market-data namespace ─────────────────────────────────────────
  //
  // A real exchange separates its public market-data feed from its
  // authenticated order gateway, and so does this server. `/market-data`
  // carries the order book, the last traded price and confirmed trades to
  // anyone, with no session — that is what a visitor sees before signing in.
  // The default namespace `/` keeps the auth middleware above and stays the
  // only route for order entry, positions, balances, chat and hints.
  //
  // The split is structural, not a set of per-event checks: a socket here is
  // never given a userId and therefore can never be placed in a `user:<id>`
  // room, so private events have no path to reach it even if an emitter is
  // later written carelessly.
  const marketData = io.of("/market-data");

  // One anonymous socket cannot subscribe to unbounded rooms. socket.rooms
  // always contains the socket's own id, so the cap is contracts + 1.
  const PUBLIC_ROOM_CAP = 26;

  marketData.on("connection", (socket) => {
    publicConnectionCount++;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "ws:public_connected",
        socketId: socket.id,
        totalPublicConnections: publicConnectionCount,
      })
    );

    // The only two messages this namespace accepts. Anything else is ignored:
    // there is no handler, so it cannot reach application code.
    socket.on("join:contract", (contractId) => {
      if (!Number.isInteger(contractId) || contractId <= 0) return;
      if (socket.rooms.size >= PUBLIC_ROOM_CAP) return;
      socket.join(`contract:${contractId}`);
    });

    socket.on("leave:contract", (contractId) => {
      if (!Number.isInteger(contractId) || contractId <= 0) return;
      socket.leave(`contract:${contractId}`);
    });

    socket.on("disconnect", (reason) => {
      publicConnectionCount--;
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          event: "ws:public_disconnected",
          socketId: socket.id,
          reason,
          totalPublicConnections: publicConnectionCount,
        })
      );
    });
  });

  // ── Expose io instances globally for Route Handlers to emit events ────
  // This allows `app/api/orders/route.ts` to push real-time updates.
  // lib/socket-events.ts reads both: private events go to `__io` only, market
  // data fans out to `__io` and `__ioPublic`.
  global.__io = io;
  global.__ioPublic = marketData;

  // ── Attach redis adapter for multi-pod scale ─────────────────────────────
  await maybeAttachRedis(io);

  // ── Discord outbox drainer ───────────────────────────────────────────────
  // Drains DiscordOutbox → channel webhook. No-ops without DISCORD_FEED_WEBHOOK_URL.
  startDiscordDrainer(prisma);

  // ── Start Server ─────────────────────────────────────────────────────────
  httpServer.listen(port, hostname, () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "server:started",
        url: `http://${hostname}:${port}`,
        websockets: true,
        namespaces: { "/": "authenticated", "/market-data": "public" },
        authMethod: "nextauth-jwt",
        pingIntervalMs: 8 * 60 * 1000,
      })
    );
  });
});
