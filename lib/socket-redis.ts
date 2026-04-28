// Socket.IO Redis adapter — enables horizontal scaling of the WebSocket layer.
//
// When `REDIS_URL` is configured, every node attaches the redis adapter so
// `io.to(...).emit(...)` reaches sockets connected to any pod. Without it,
// emit only reaches sockets on the local node — fine for dev, broken for prod.
//
// Lazy-imported to keep `ioredis` and `@socket.io/redis-adapter` optional in
// development. Add both packages in production deployments.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function attachRedisAdapter(io: any): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;

  try {
    const [redisMod, adapterMod] = await Promise.all([
      import(/* webpackIgnore: true */ "ioredis" as string),
      import(/* webpackIgnore: true */ "@socket.io/redis-adapter" as string),
    ]);

    const Redis = redisMod.default ?? redisMod;
    const { createAdapter } = adapterMod;

    const pubClient = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    const subClient = pubClient.duplicate();

    io.adapter(createAdapter(pubClient, subClient));

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "ws:redis_adapter_attached",
      })
    );
    return true;
  } catch (err: any) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "ws:redis_adapter_failed",
        error: err.message,
      })
    );
    return false;
  }
}
