// Discord HTTP Interactions (Phase 4 — slash commands + trade via Discord).
//
// The endpoint (app/api/discord/interactions/route.ts) verifies the Ed25519
// signature on the RAW body, then calls handleInteraction() here. Keeping the
// dispatch + handlers in this lib makes them testable with synthetic payloads.
//
// Trade safety: identity comes from the Discord-authenticated interaction
// (interaction.member.user.id); the platform (placeOrder) re-validates margin /
// contract / idempotency; /order shows an ephemeral Confirm/Cancel preview; and
// the Idempotency-Key is baked into the Confirm button so a double-click can't
// place two orders. The handler resolves discordId → trading user and calls the
// SAME orderService the website uses — no per-user API key is stored anywhere.
//
// Slow path (Confirm → placeOrder, a DB transaction) responds with a DEFERRED
// ack (type 6) within Discord's 3s window, then edits the message via the
// interaction-token webhook follow-up — so a busy match never shows the user a
// spurious "interaction failed".

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { placeOrder } from "@/lib/orderService";
import { calculateAvailableMargin } from "@/lib/margin";
import { recordPricePoint } from "@/lib/price-history";
import { emitQuoteUpdated } from "@/lib/socket-events";
import { randomToken } from "@/lib/discord/oauth";

// ── Ed25519 request verification ────────────────────────────────────────────
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string
): boolean {
  try {
    if (!signature || !timestamp || !publicKeyHex) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ── Interaction / response constants ────────────────────────────────────────
const T_PING = 1;
const T_APPLICATION_COMMAND = 2;
const T_MESSAGE_COMPONENT = 3;
const T_AUTOCOMPLETE = 4;

const R_PONG = 1;
const R_CHANNEL_MESSAGE = 4;
const R_DEFERRED_UPDATE = 6; // ack a component interaction now, edit the message later
const R_UPDATE_MESSAGE = 7;
const R_AUTOCOMPLETE_RESULT = 8;
const FLAG_EPHEMERAL = 64;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function ephemeral(data: Json): Json {
  return { type: R_CHANNEL_MESSAGE, data: { flags: FLAG_EPHEMERAL, ...data } };
}
function updateMessage(data: Json): Json {
  return { type: R_UPDATE_MESSAGE, data: { flags: FLAG_EPHEMERAL, ...data } };
}

function getDiscordUserId(interaction: Json): string | null {
  return interaction?.member?.user?.id ?? interaction?.user?.id ?? null;
}
function getOpt(interaction: Json, name: string): Json {
  const o = (interaction?.data?.options ?? []).find((x: Json) => x.name === name);
  return o?.value;
}

function notLinkedResponse(): Json {
  return ephemeral({
    content:
      "Your Discord account isn't linked yet. Open the **Discord Link** page in Settings on the website to connect it, then try again.",
  });
}

export interface LinkedUser {
  id: number;
  username: string;
  role: string;
  status: string;
  balance: number;
}
export async function resolveUser(discordId: string): Promise<LinkedUser | null> {
  return prisma.user.findUnique({
    where: { discordId },
    select: { id: true, username: true, role: true, status: true, balance: true },
  });
}

async function marketSnapshot(marketId: number) {
  const contract = await prisma.contract.findUnique({
    where: { id: marketId },
    select: { id: true, title: true, status: true, minPrice: true, maxPrice: true },
  });
  if (!contract) return null;
  const quotes = await prisma.quote.findMany({
    where: { contractId: marketId, status: "OPEN" },
    select: { bid: true, ask: true, bidSize: true, askSize: true },
  });
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  for (const q of quotes) {
    if (q.bid != null && (q.bidSize ?? 0) > 0) bestBid = bestBid == null ? q.bid : Math.max(bestBid, q.bid);
    if (q.ask != null && (q.askSize ?? 0) > 0) bestAsk = bestAsk == null ? q.ask : Math.min(bestAsk, q.ask);
  }
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  return { contract, bestBid, bestAsk, mid };
}

// ── Command handlers ────────────────────────────────────────────────────────

async function cmdMarkets(): Promise<Json> {
  const markets = await prisma.contract.findMany({
    where: { status: "OPEN" },
    select: { id: true, title: true, _count: { select: { trades: true } } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  if (!markets.length) return ephemeral({ content: "No open markets right now." });
  const lines = markets.map((c) => `**#${c.id}** ${c.title} · ${c._count.trades} trades`).join("\n");
  return ephemeral({
    embeds: [
      {
        title: "📈 Open markets",
        description: lines.slice(0, 4096),
        color: 0x3b82f6,
        footer: { text: "Use the # number as `market` in /price and /order" },
      },
    ],
  });
}

async function cmdPrice(marketId: number): Promise<Json> {
  if (!Number.isInteger(marketId)) return ephemeral({ content: "`market` must be a market number (see /markets)." });
  const snap = await marketSnapshot(marketId);
  if (!snap) return ephemeral({ content: `No market found with number #${marketId}.` });
  const { contract, bestBid, bestAsk, mid } = snap;
  return ephemeral({
    embeds: [
      {
        title: `💲 ${contract.title}`,
        description:
          `Best bid: **${bestBid ?? "—"}**  ·  Best ask: **${bestAsk ?? "—"}**  ·  Mid: **${mid ?? "—"}**\n` +
          `Price range ${contract.minPrice}–${contract.maxPrice} · ${contract.status}`,
        color: 0x3b82f6,
        footer: { text: `Market #${contract.id} · bid = highest buyer, ask = lowest seller` },
      },
    ],
  });
}

async function cmdPortfolio(user: LinkedUser): Promise<Json> {
  const userId = user.id;
  const [openTrades, availableMargin] = await Promise.all([
    prisma.trade.findMany({
      where: { status: "OPEN", OR: [{ takerId: userId }, { makerId: userId }] },
      include: { contract: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    calculateAvailableMargin(userId),
  ]);
  const positions = openTrades.map((t) => {
    const isTaker = t.takerId === userId;
    const side = isTaker ? t.takerSide : t.takerSide === "OVER" ? "UNDER" : "OVER";
    return { contractId: t.contract.id, contractTitle: t.contract.title, side, strike: t.strike, size: t.size, role: isTaker ? "taker" : "maker" };
  });
  return ephemeral({
    embeds: [
      {
        title: `💼 Portfolio · ${user.username}`,
        description: `Balance: **${user.balance}**  ·  Available margin: **${availableMargin}**  ·  Open positions: ${positions.length}`,
        color: 0x6366f1,
        fields: positions.slice(0, 10).map((p) => ({
          name: `#${p.contractId} ${p.contractTitle}`.slice(0, 256),
          value: `${p.side} ${p.strike} × ${p.size} (${p.role})`,
        })),
      },
    ],
  });
}

async function cmdOrderPreview(user: LinkedUser, opts: Json): Promise<Json> {
  const marketId = Number(opts.market);
  const side = opts.side;
  const size = Number(opts.size);
  const type = opts.type === "LIMIT" ? "LIMIT" : "MARKET";
  const price = opts.price != null ? Number(opts.price) : null;

  if (user.status !== "ACTIVE") return ephemeral({ content: "Your account isn't ACTIVE yet — you can't place orders." });
  if (side !== "OVER" && side !== "UNDER") return ephemeral({ content: "`side` must be OVER or UNDER." });
  if (!Number.isInteger(size) || size < 1) return ephemeral({ content: "`size` must be a whole number ≥ 1." });
  if (type === "LIMIT" && (price == null || !Number.isInteger(price))) {
    return ephemeral({ content: "A LIMIT order needs a whole-number `price`." });
  }

  const snap = await marketSnapshot(marketId);
  if (!snap) return ephemeral({ content: `No market found with number #${marketId}.` });
  if (snap.contract.status !== "OPEN") return ephemeral({ content: "That market is closed." });

  const avail = await calculateAvailableMargin(user.id);
  // Idempotency-Key baked into the Confirm button → a double-click is a no-op.
  const idem = randomToken(8);
  const customId = `confirm-order|${marketId}|${side}|${size}|${type}|${type === "LIMIT" ? price : ""}|${idem}`;

  return ephemeral({
    embeds: [
      {
        title: "🧾 Confirm your order",
        description:
          `**${side} ${size}** on **${snap.contract.title}** (#${marketId})\n` +
          `Order type: **${type}**${type === "LIMIT" ? ` @ ${price}` : " (fills now at best price)"}\n` +
          `Current mid: ${snap.mid ?? "—"}  ·  Your available margin: **${avail}**`,
        color: 0xf59e0b,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "Confirm", custom_id: customId },
          { type: 2, style: 4, label: "Cancel", custom_id: "cancel-order" },
        ],
      },
    ],
  });
}

// Place the order described by a Confirm button's custom_id and return the
// message body (embeds + cleared buttons). Exported so it can be unit/integration
// tested directly; the live path calls it from a deferred follow-up.
export async function buildOrderResult(user: LinkedUser, customId: string): Promise<Json> {
  const parts = customId.split("|"); // confirm-order|market|side|size|type|price|idem
  const marketId = Number(parts[1]);
  const side = parts[2];
  const size = Number(parts[3]);
  const type = parts[4];
  const price = parts[5] === "" ? null : Number(parts[5]);
  const idem = parts[6];

  if (user.status !== "ACTIVE") {
    return { embeds: [{ title: "❌ Order failed", description: "Your account isn't ACTIVE.", color: 0xef4444 }], components: [] };
  }
  const body: Json = { contractId: marketId, side, size, type };
  if (price != null) body.limitPrice = price;

  let data: Json;
  let status: number;
  try {
    const resp = await placeOrder({ actorId: user.id, userRole: user.role, body, idempotencyKey: idem });
    status = resp.status;
    data = await resp.json();
  } catch {
    return { embeds: [{ title: "❌ Order failed", description: "Unexpected error — please try again.", color: 0xef4444 }], components: [] };
  }

  if (status >= 400) {
    return { embeds: [{ title: "❌ Order failed", description: String(data?.error ?? status), color: 0xef4444 }], components: [] };
  }

  const filled = data.totalFilled ?? 0;
  let desc = `**${side} ${size}** on #${marketId}\nFilled: **${filled}**`;
  if (data.resting) desc += `\nResting in the book: ${data.resting.size} @ ${data.resting.price}`;
  if (data.warning) desc += `\n⚠️ ${data.warning}`;
  return { embeds: [{ title: "✅ Order placed", description: desc, color: filled > 0 ? 0x22c55e : 0x6b7280 }], components: [] };
}

// Deferred slow path: place the order, then edit the original (preview) message
// via the interaction-token webhook. Best-effort; errors are swallowed so they
// never surface as an unhandled rejection.
async function runConfirmDeferred(user: LinkedUser, customId: string, applicationId: string, token: string): Promise<void> {
  let body: Json;
  try {
    body = await buildOrderResult(user, customId);
  } catch {
    body = { embeds: [{ title: "❌ Order failed", description: "Unexpected error — please try again.", color: 0xef4444 }], components: [] };
  }
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort follow-up */
  }
}

async function cmdLeaderboard(): Promise<Json> {
  const top = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { username: true, balance: true },
    orderBy: { balance: "desc" },
    take: 10,
  });
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((u, i) => `${medals[i] ?? `**${i + 1}.**`} ${u.username} — **${u.balance}**`);
  return ephemeral({
    embeds: [{ title: "🏆 Leaderboard · top balances", description: lines.join("\n") || "No players yet.", color: 0xf59e0b }],
  });
}

function cmdHelp(): Json {
  return ephemeral({
    embeds: [
      {
        title: "🤖 Trading bot — commands",
        color: 0x6366f1,
        description:
          "**/markets** — list the open markets\n" +
          "**/price** `market` — a market's bid / ask / mid\n" +
          "**/portfolio** — your balance and open positions\n" +
          "**/order** `market` `side` `size` [`type`] [`price`] — place an order (preview → confirm)\n" +
          "**/cancel** — cancel your resting orders\n" +
          "**/leaderboard** — top players by balance\n\n" +
          "Tip: `market` autocompletes by name — just start typing.\n" +
          "Link your account on the website's **Discord Link** page to use /portfolio, /order and /cancel.",
      },
    ],
  });
}

async function cmdCancel(user: LinkedUser): Promise<Json> {
  const quotes = await prisma.quote.findMany({
    where: { makerId: user.id, status: "OPEN" },
    include: { contract: { select: { id: true, title: true } } },
    orderBy: { id: "asc" },
    take: 10,
  });
  if (!quotes.length) return ephemeral({ content: "You have no resting orders to cancel." });

  const lines = quotes.map((q) => {
    const side = q.bid != null ? `bid ${q.bid} × ${q.bidSize}` : `ask ${q.ask} × ${q.askSize}`;
    return `**#${q.id}** ${q.contract.title} — ${side}`;
  });
  const rows: Json[] = [];
  for (let i = 0; i < quotes.length; i += 5) {
    rows.push({
      type: 1,
      components: quotes.slice(i, i + 5).map((q) => ({ type: 2, style: 4, label: `Cancel #${q.id}`, custom_id: `cancel-quote|${q.id}` })),
    });
  }
  return ephemeral({
    embeds: [{ title: "🗑️ Your resting orders", description: lines.join("\n"), color: 0xf59e0b }],
    components: rows,
  });
}

// Cancel one OPEN quote owned by the user. Mirrors DELETE /api/quotes/[id].
// Exported for tests.
export async function cancelUserQuote(userId: number, quoteId: number): Promise<{ ok: boolean; error?: string }> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, makerId: true, status: true, contractId: true },
  });
  if (!quote) return { ok: false, error: "Order not found" };
  if (quote.makerId !== userId) return { ok: false, error: "That isn't your order" };
  if (quote.status !== "OPEN") return { ok: false, error: "Order is no longer open" };

  await prisma.quote.update({ where: { id: quoteId }, data: { status: "CANCELLED" } });
  await recordPricePoint(quote.contractId);
  emitQuoteUpdated({ quoteId, contractId: quote.contractId, bidSize: 0, askSize: 0, status: "CANCELLED" });
  return { ok: true };
}

// Autocomplete the `market` option: suggest open markets by name or number.
async function autocompleteMarket(partial: string): Promise<Json> {
  const q = String(partial ?? "").toLowerCase();
  const markets = await prisma.contract.findMany({
    where: { status: "OPEN" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const choices = markets
    .filter((m) => !q || m.title.toLowerCase().includes(q) || String(m.id).includes(q))
    .slice(0, 25)
    .map((m) => ({ name: `${m.title} (#${m.id})`.slice(0, 100), value: m.id }));
  return { type: R_AUTOCOMPLETE_RESULT, data: { choices } };
}

// ── Top-level dispatch ──────────────────────────────────────────────────────

export async function handleInteraction(interaction: Json): Promise<Json> {
  const type = interaction?.type;

  if (type === T_PING) return { type: R_PONG };

  if (type === T_AUTOCOMPLETE) {
    const focused = (interaction.data?.options ?? []).find((o: Json) => o.focused);
    if (focused?.name === "market") return autocompleteMarket(focused.value);
    return { type: R_AUTOCOMPLETE_RESULT, data: { choices: [] } };
  }

  if (type === T_APPLICATION_COMMAND) {
    const name = interaction.data?.name;
    if (name === "markets") return cmdMarkets();
    if (name === "price") return cmdPrice(Number(getOpt(interaction, "market")));
    if (name === "leaderboard") return cmdLeaderboard();
    if (name === "help") return cmdHelp();

    const discordId = getDiscordUserId(interaction);
    const user = discordId ? await resolveUser(discordId) : null;
    if (name === "portfolio") return user ? cmdPortfolio(user) : notLinkedResponse();
    if (name === "cancel") return user ? cmdCancel(user) : notLinkedResponse();
    if (name === "order") {
      if (!user) return notLinkedResponse();
      return cmdOrderPreview(user, {
        market: getOpt(interaction, "market"),
        side: getOpt(interaction, "side"),
        size: getOpt(interaction, "size"),
        type: getOpt(interaction, "type"),
        price: getOpt(interaction, "price"),
      });
    }
    return ephemeral({ content: `Unsupported command: ${name}` });
  }

  if (type === T_MESSAGE_COMPONENT) {
    const customId: string = interaction.data?.custom_id ?? "";
    if (customId === "cancel-order") {
      return updateMessage({ content: "Order cancelled.", embeds: [], components: [] });
    }
    if (customId.startsWith("cancel-quote|")) {
      const discordId = getDiscordUserId(interaction);
      const user = discordId ? await resolveUser(discordId) : null;
      if (!user) return updateMessage({ content: "Your Discord account isn't linked.", embeds: [], components: [] });
      const quoteId = Number(customId.split("|")[1]);
      const r = await cancelUserQuote(user.id, quoteId);
      if (!r.ok) return updateMessage({ embeds: [{ title: "❌ Couldn't cancel", description: r.error ?? "error", color: 0xef4444 }], components: [] });
      return updateMessage({ embeds: [{ title: "✅ Order cancelled", description: `Resting order #${quoteId} cancelled.`, color: 0x22c55e }], components: [] });
    }
    if (customId.startsWith("confirm-order|")) {
      const discordId = getDiscordUserId(interaction);
      const user = discordId ? await resolveUser(discordId) : null;
      if (!user) return updateMessage({ content: "Your Discord account isn't linked.", embeds: [], components: [] });
      // Ack within 3s, then place the order + edit the message via follow-up.
      void runConfirmDeferred(user, customId, interaction.application_id, interaction.token);
      return { type: R_DEFERRED_UPDATE };
    }
    return updateMessage({ content: "Unsupported interaction.", embeds: [], components: [] });
  }

  return ephemeral({ content: "Unsupported interaction type." });
}
