// Register the trading slash commands with Discord.
//   node scripts/deploy-discord-commands.mjs
//
// Registers to the bot's first guild (instant) for dev testing. Set
// DISCORD_TEST_GUILD_ID to pin a guild, or pass "global" as argv[2] to register
// globally (can take up to 1h to propagate).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_CLIENT_ID;
if (!token || !appId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required in .env.local");
  process.exit(1);
}
const auth = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };

const commands = [
  { name: "markets", description: "List the open markets", type: 1 },
  {
    name: "price",
    description: "Show a market's current price",
    type: 1,
    options: [{ name: "market", description: "Pick a market (type to search by name)", type: 4, required: true, autocomplete: true }],
  },
  { name: "portfolio", description: "Your balance and open positions", type: 1 },
  { name: "cancel", description: "Cancel your resting orders", type: 1 },
  { name: "leaderboard", description: "Top players by balance", type: 1 },
  { name: "help", description: "How to use the trading bot", type: 1 },
  {
    name: "order",
    description: "Place an order (you preview it, then confirm)",
    type: 1,
    options: [
      { name: "market", description: "Pick a market (type to search by name)", type: 4, required: true, autocomplete: true },
      {
        name: "side",
        description: "Bet OVER or UNDER the outcome",
        type: 3,
        required: true,
        choices: [
          { name: "OVER", value: "OVER" },
          { name: "UNDER", value: "UNDER" },
        ],
      },
      { name: "size", description: "How many contracts to trade", type: 4, required: true },
      {
        name: "type",
        description: "MARKET = fill now at best price (default); LIMIT = set your own price",
        type: 3,
        required: false,
        choices: [
          { name: "MARKET", value: "MARKET" },
          { name: "LIMIT", value: "LIMIT" },
        ],
      },
      { name: "price", description: "Your limit price (only for a LIMIT order)", type: 4, required: false },
    ],
  },
];

async function main() {
  const wantGlobal = process.argv[2] === "global";
  let url;
  let scope;
  if (wantGlobal) {
    url = `https://discord.com/api/v10/applications/${appId}/commands`;
    scope = "GLOBAL (up to 1h to appear)";
  } else {
    let guildId = process.env.DISCORD_TEST_GUILD_ID;
    if (!guildId) {
      const g = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: auth });
      const guilds = await g.json();
      if (!guilds.length) {
        console.error("The bot isn't in any server yet — invite it to a server first.");
        process.exit(1);
      }
      guildId = guilds[0].id;
      console.log(`Auto-detected guild: ${guilds[0].name} (${guildId})`);
    }
    url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
    scope = `GUILD ${guildId} (appears instantly)`;
  }

  const res = await fetch(url, { method: "PUT", headers: auth, body: JSON.stringify(commands) });
  if (!res.ok) {
    console.error(`❌ Failed to register commands (HTTP ${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const registered = await res.json();
  console.log(`✅ Registered ${registered.length} commands [${scope}]: ${registered.map((c) => "/" + c.name).join(", ")}`);
}
main().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
