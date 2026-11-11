// Capture the WebSocket fixtures in fixtures/.
// Usage: node scripts/capture-ws-fixtures.mjs [extra addresses...]
// It saves one allMids message (10 perp coins plus one spot and one builder
// key), one userFills snapshot and one live userFills message, and the
// subscriptionResponse and pong control messages. Node 22 has a global WebSocket.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../fixtures/", import.meta.url);
const lb = JSON.parse(readFileSync(new URL("leaderboard.json", root), "utf8"));
const users = [
  "0xf5d81a135f756ca16544e53c20fc20643ec3ad53",
  ...lb.leaderboardRows.map((r) => r.ethAddress),
  ...process.argv.slice(2),
];
const keep = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "AVAX", "LINK", "SUI", "NEAR"];

const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
const control = [];
const snapshots = new Map();
let mids = null;
let live = null;

const save = (name, value) =>
  writeFileSync(new URL(name, root), JSON.stringify(value, null, 2) + "\n");

function finishIfReady() {
  if (!mids || !live || control.length < 2) return;
  save("ws-allMids.json", mids);
  save("ws-userFills.json", [snapshots.get(live.data.user), live]);
  save("ws-control.json", control);
  console.log("Saved the fixtures. Live fills came from", live.data.user);
  ws.close();
  process.exit(0);
}

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } }));
  for (const user of users) {
    ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "userFills", user } }));
  }
  ws.send(JSON.stringify({ method: "ping" }));
  setInterval(() => ws.send(JSON.stringify({ method: "ping" })), 50_000);
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.channel === "subscriptionResponse") {
    if (msg.data.subscription.type === "allMids" && control.length === 0) control.push(msg);
  } else if (msg.channel === "pong") {
    if (control.length === 1) control.push(msg);
  } else if (msg.channel === "allMids" && !mids) {
    const all = msg.data.mids;
    const trimmed = {};
    for (const coin of keep) if (coin in all) trimmed[coin] = all[coin];
    // Keep one spot key and one builder key, so tests prove that we ignore them.
    const spot = Object.keys(all).find((k) => k.startsWith("@"));
    const builder = Object.keys(all).find((k) => k.startsWith("#"));
    if (spot) trimmed[spot] = all[spot];
    if (builder) trimmed[builder] = all[builder];
    mids = { channel: "allMids", data: { mids: trimmed } };
  } else if (msg.channel === "userFills") {
    const data = { ...msg.data, fills: msg.data.fills.slice(0, 5) };
    if (msg.data.isSnapshot) snapshots.set(msg.data.user, { channel: "userFills", data });
    else if (!live) live = { channel: "userFills", data };
  }
  finishIfReady();
});

setTimeout(() => {
  console.error("Timeout: no live fill in 4 minutes. Try again or pass more addresses.");
  process.exit(1);
}, 240_000);
