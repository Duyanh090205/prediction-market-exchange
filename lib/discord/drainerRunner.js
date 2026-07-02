// Discord outbound — DRAIN side (plain CommonJS so server.js can require it).
//
// Claims PENDING rows from DiscordOutbox with `FOR UPDATE SKIP LOCKED` (so several
// pods can drain the same table without double-sending), POSTs a Discord embed to
// the channel webhook, and marks SENT / retries with exponential backoff / DEAD.
//
// Routes each row by `channel`: "feed" → channel webhook; "dm" → bot DM to
// `targetDiscordId`. No-ops entirely when neither DISCORD_FEED_WEBHOOK_URL nor
// DISCORD_BOT_TOKEN is set, so it's safe to wire in before either is configured.

const BATCH = 10;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60 * 1000; // a claimed row is hidden for 2 min; reclaimable after if the drainer crashed

// Embed colors (match lib/theme.ts: OVER = red, UNDER = green).
const COLOR_OVER = 0xef4444;
const COLOR_UNDER = 0x22c55e;
const COLOR_NEW = 0x3b82f6; // blue — new market
const COLOR_SETTLE = 0x22c55e; // green — settled
const COLOR_HINT = 0xf59e0b; // amber — hint
const COLOR_DM = 0x5865f2; // blurple — personal DM
const COLOR_PUSH = 0x6b7280; // gray — break-even / neutral

function truncate(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Turn a (eventType, payload) into a Discord webhook body { embeds: [...] }.
// Returns null for an event we deliberately don't post (drainer marks it SENT).
// Throws for an unknown eventType (drainer marks it DEAD — a coding error, not transient).
// Exported for unit tests.
function formatEmbed(eventType, payload) {
  const p = payload || {};
  switch (eventType) {
    case "TRADE_EXECUTED": {
      const side = p.side === "OVER" ? "OVER" : "UNDER";
      const fills = Array.isArray(p.fills)
        ? p.fills.map((f) => `${f.size}@${f.strike}`).join(", ")
        : "";
      return {
        embeds: [
          {
            title: truncate(`💱 Trade · ${p.contractTitle ?? `Market #${p.contractId}`}`, 256),
            description: truncate(`**${side}** — ${p.totalFilled} filled (${fills})`, 4096),
            color: side === "OVER" ? COLOR_OVER : COLOR_UNDER,
            footer: { text: `Market #${p.contractId}` },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    case "CONTRACT_CREATED": {
      return {
        embeds: [
          {
            title: truncate(`📈 New market #${p.contractId} · ${p.title ?? ""}`, 256),
            description: truncate(p.description ?? "", 4096),
            color: COLOR_NEW,
            fields: [
              { name: "Price band", value: `${p.minPrice ?? 0}–${p.maxPrice ?? 100}`, inline: true },
              ...(p.creatorName ? [{ name: "Created by", value: truncate(p.creatorName, 256), inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    case "CONTRACT_SETTLED": {
      return {
        embeds: [
          {
            title: truncate(`✅ Settled · ${p.contractTitle ?? `Market #${p.contractId}`}`, 256),
            description: `Result: **${p.settlementValue}** · ${p.tradesSettled ?? 0} trade(s) settled`,
            color: COLOR_SETTLE,
            footer: { text: `Market #${p.contractId}` },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    case "HINT_CREATED": {
      const fields = [];
      if (p.authorName) fields.push({ name: "By", value: truncate(p.authorName, 256), inline: true });
      if (p.linkUrl) fields.push({ name: "Link", value: truncate(`[${p.linkLabel || "open"}](${p.linkUrl})`, 1024), inline: true });
      return {
        embeds: [
          {
            title: truncate(`💡 Hint · ${p.contractTitle ?? `Market #${p.contractId}`}`, 256),
            description: truncate(p.content ?? "", 4096),
            color: COLOR_HINT,
            fields,
            footer: { text: `Market #${p.contractId}` },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    // ── Personal DM events (channel = "dm") ──────────────────────────────────
    case "ORDER_FILLED": {
      const side = p.side === "OVER" ? "OVER" : "UNDER";
      const fills = Array.isArray(p.fills) ? p.fills.map((f) => `${f.size}@${f.strike}`).join(", ") : "";
      return {
        embeds: [
          {
            title: truncate(`🟢 Your order filled · ${p.contractTitle ?? `Market #${p.contractId}`}`, 256),
            description: truncate(`**${side}** — ${p.totalFilled} filled (${fills})`, 4096),
            color: side === "OVER" ? COLOR_OVER : COLOR_UNDER,
            footer: { text: `Market #${p.contractId}` },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    case "SETTLEMENT_RESULT": {
      const pnl = Number(p.pnl) || 0;
      const icon = pnl > 0 ? "🎉" : pnl < 0 ? "📉" : "➖";
      return {
        embeds: [
          {
            title: truncate(`${icon} Settled · ${p.contractTitle ?? `Market #${p.contractId}`}`, 256),
            description: `Settled at **${p.settlementValue}**. Your P&L: **${pnl > 0 ? "+" : ""}${pnl}**`,
            color: pnl > 0 ? COLOR_SETTLE : pnl < 0 ? COLOR_OVER : COLOR_PUSH,
            footer: { text: `Market #${p.contractId}` },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    case "NEW_DM_MESSAGE": {
      return {
        embeds: [
          {
            title: truncate(`💬 New message from ${p.fromUsername ?? "someone"}`, 256),
            description: truncate(p.preview ?? "", 4096),
            color: COLOR_DM,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    default:
      throw new Error(`unknown eventType: ${eventType}`);
  }
}

function backoffMs(attempts) {
  // 5s, 10s, 20s, 40s ... capped at 5 min
  return Math.min(5000 * Math.pow(2, attempts - 1), 5 * 60 * 1000);
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parse429(res) {
  let retryMs = 1000;
  try {
    const j = await res.json();
    if (j && typeof j.retry_after === "number") retryMs = Math.ceil(j.retry_after * 1000);
  } catch {}
  const ra = res.headers.get("retry-after");
  if (ra) retryMs = Math.max(retryMs, Math.ceil(parseFloat(ra) * 1000));
  return { ok: false, transient: true, retryMs, error: "429 rate limited" };
}

// Send a personal DM via the bot token: open (or fetch) the DM channel, then post.
// 50007 / 50278 (no mutual guild / DMs disabled) and other 4xx are PERMANENT — the
// in-app Notification already covers the user, so we don't retry a closed DM forever.
async function sendDirectMessage(botToken, targetDiscordId, body) {
  const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };

  let chRes;
  try {
    chRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient_id: targetDiscordId }),
    });
  } catch (e) {
    return { ok: false, transient: true, error: e && e.message ? e.message : "network error" };
  }
  if (chRes.status === 429) return parse429(chRes);
  if (!chRes.ok) {
    const t = await safeText(chRes);
    const transient = chRes.status >= 500;
    return { ok: false, transient, error: `open-dm HTTP ${chRes.status} ${t.slice(0, 200)}` };
  }
  let channel;
  try {
    channel = await chRes.json();
  } catch {
    return { ok: false, transient: true, error: "bad dm-channel json" };
  }

  let msgRes;
  try {
    msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, transient: true, error: e && e.message ? e.message : "network error" };
  }
  if (msgRes.status === 429) return parse429(msgRes);
  if (msgRes.ok) {
    let id = null;
    try {
      const j = await msgRes.json();
      if (j && j.id) id = String(j.id);
    } catch {}
    return { ok: true, messageId: id };
  }
  if (msgRes.status >= 500) return { ok: false, transient: true, error: `send HTTP ${msgRes.status}` };
  const t = await safeText(msgRes);
  return { ok: false, transient: false, error: `send HTTP ${msgRes.status} ${t.slice(0, 200)}` };
}

async function sendToWebhook(webhookUrl, body) {
  const url = webhookUrl + (webhookUrl.indexOf("?") === -1 ? "?" : "&") + "wait=true";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    let retryMs = 1000;
    try {
      const j = await res.json();
      if (j && typeof j.retry_after === "number") retryMs = Math.ceil(j.retry_after * 1000);
    } catch {}
    const ra = res.headers.get("retry-after");
    if (ra) retryMs = Math.max(retryMs, Math.ceil(parseFloat(ra) * 1000));
    return { ok: false, transient: true, retryMs, error: "429 rate limited" };
  }
  if (res.ok) {
    let id = null;
    try {
      const j = await res.json();
      if (j && j.id) id = String(j.id);
    } catch {}
    return { ok: true, messageId: id };
  }
  if (res.status >= 500) return { ok: false, transient: true, error: `HTTP ${res.status}` };
  // Other 4xx (400 malformed embed, 401/403 bad token, 404 webhook deleted) — retrying won't help.
  let text = "";
  try {
    text = await res.text();
  } catch {}
  return { ok: false, transient: false, error: `HTTP ${res.status} ${String(text).slice(0, 200)}` };
}

async function drainOnce(prisma) {
  const webhookUrl = process.env.DISCORD_FEED_WEBHOOK_URL;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!webhookUrl && !botToken) return { sent: 0, retried: 0, dead: 0 };

  // Bind the "now" threshold and the lease from JS rather than using SQL now():
  // Prisma maps DateTime to Postgres `timestamp` WITHOUT time zone, so comparing
  // it to `now()` (timestamptz) would depend on the session TimeZone and be wrong
  // on a non-UTC DB session. A bound JS Date is serialized the same way the column
  // is stored, so the comparison is tz-independent.
  const nowTs = new Date();
  const leaseUntil = new Date(nowTs.getTime() + LEASE_MS);
  // Atomic claim: pick PENDING (or expired-lease PROCESSING) rows, flip to PROCESSING,
  // and push nextAttemptAt forward as a lease. SKIP LOCKED keeps concurrent drainers disjoint.
  const claimed = await prisma.$queryRaw`
    WITH claimed AS (
      SELECT id FROM "DiscordOutbox"
      WHERE status IN ('PENDING', 'PROCESSING') AND "nextAttemptAt" <= ${nowTs}
      ORDER BY id
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "DiscordOutbox" o
    SET status = 'PROCESSING', "nextAttemptAt" = ${leaseUntil}
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING o.id, o."eventType" AS "eventType", o.channel AS "channel", o."targetDiscordId" AS "targetDiscordId", o.payload, o.attempts;
  `;

  let sent = 0;
  let retried = 0;
  let dead = 0;

  for (const row of claimed) {
    const id = Number(row.id);
    let body;
    try {
      body = formatEmbed(row.eventType, row.payload);
    } catch (e) {
      await prisma.discordOutbox.update({
        where: { id },
        data: { status: "DEAD", lastError: `format: ${e.message}` },
      });
      dead++;
      continue;
    }
    if (!body) {
      await prisma.discordOutbox.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
      continue;
    }

    let result;
    try {
      if (row.channel === "dm") {
        if (!botToken) {
          result = { ok: false, transient: true, error: "no DISCORD_BOT_TOKEN" };
        } else if (!row.targetDiscordId) {
          result = { ok: false, transient: false, error: "dm row missing targetDiscordId" };
        } else {
          result = await sendDirectMessage(botToken, row.targetDiscordId, body);
        }
      } else {
        if (!webhookUrl) {
          result = { ok: false, transient: true, error: "no DISCORD_FEED_WEBHOOK_URL" };
        } else {
          result = await sendToWebhook(webhookUrl, body);
        }
      }
    } catch (e) {
      result = { ok: false, transient: true, error: e && e.message ? e.message : "network error" };
    }

    if (result.ok) {
      await prisma.discordOutbox.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date(), discordMessageId: result.messageId || null, lastError: null },
      });
      sent++;
    } else {
      const attempts = Number(row.attempts) + 1;
      if (!result.transient || attempts >= MAX_ATTEMPTS) {
        await prisma.discordOutbox.update({
          where: { id },
          data: { status: "DEAD", attempts, lastError: result.error || "failed" },
        });
        dead++;
      } else {
        const delay = result.retryMs != null ? result.retryMs : backoffMs(attempts);
        await prisma.discordOutbox.update({
          where: { id },
          data: {
            status: "PENDING",
            attempts,
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: result.error || `retry ${attempts}`,
          },
        });
        retried++;
      }
    }
  }

  return { sent, retried, dead };
}

// Start the periodic drainer. Safe to call always — it self-disables without a webhook URL.
function startDiscordDrainer(prisma) {
  if (!process.env.DISCORD_FEED_WEBHOOK_URL && !process.env.DISCORD_BOT_TOKEN) {
    console.log(
      JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", event: "discord:drainer_disabled", reason: "no DISCORD_FEED_WEBHOOK_URL or DISCORD_BOT_TOKEN" })
    );
    return;
  }
  const interval = parseInt(process.env.DISCORD_DRAIN_INTERVAL_MS || "3000", 10);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const r = await drainOnce(prisma);
      if (r.sent || r.retried || r.dead) {
        console.log(
          JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", event: "discord:drained", ...r })
        );
      }
    } catch (e) {
      console.error(
        JSON.stringify({ timestamp: new Date().toISOString(), level: "ERROR", event: "discord:drain_error", error: e && e.message ? e.message : String(e) })
      );
    } finally {
      running = false;
    }
  }, interval);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", event: "discord:drainer_started", intervalMs: interval })
  );
}

module.exports = { startDiscordDrainer, drainOnce, formatEmbed };
