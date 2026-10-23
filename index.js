#!/usr/bin/env node
// Crypto Market Data MCP server: live crypto market data and Hyperliquid wallet reports as tools for any MCP client
// (Claude, Cursor, Codex, VS Code ...). Each paid tool call pays the API per call in USDC on Base via x402, from the
// wallet in X402_PRIVATE_KEY, within hard spending caps. No account or API key is needed.
//
//   X402_PRIVATE_KEY      0x... key of a wallet holding a little USDC on Base (required for paid tools)
//   X402_MAX_PER_CALL_USD refuse any single payment above this (default 0.01)
//   X402_MAX_TOTAL_USD    stop paying after this much per session (default 1.00)
//   CMD_API_URL           API base (default https://crypto-market-data.zafermemon87.workers.dev)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const API = (process.env.CMD_API_URL || "https://crypto-market-data.zafermemon87.workers.dev").replace(/\/$/, "");
const USDC_UNITS = 1e6;
const FREE = { "/v1/prices": "/free/prices", "/v1/sentiment": "/free/sentiment" }; // free, 15-minute copies
function cap(name, dflt) {
  const v = Number((process.env[name] || "").trim() || dflt);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * USDC_UNITS) : 0; // an unreadable cap pays nothing, never "no limit"
}
const maxPerCall = cap("X402_MAX_PER_CALL_USD", "0.01");
const maxTotal = cap("X402_MAX_TOTAL_USD", "1.00");
let spent = 0;

let payer = null;
function client() {
  if (payer) return payer;
  const key = process.env.X402_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  payer = new x402HTTPClient(registerExactEvmScheme(new x402Client(), { signer: privateKeyToAccount(key) }));
  return payer;
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }] });
const fail = (msg) => ({ ...text(msg), isError: true });

async function call(path, query) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const first = await fetch(url);
  if (first.status !== 402) return first.ok ? text(await first.json()) : fail(`API answered ${first.status}: ${await first.text()}`);
  const pay = client();
  if (!pay && FREE[path]) {
    // no wallet: the free copy of this data, refreshed every 15 minutes
    const free = await fetch(API + FREE[path] + url.search);
    const body = await free.json().catch(() => ({}));
    if (!free.ok) return fail(`Free tier answered ${free.status}: ${body.error || ""}`);
    return text({ ...body, note: "Free data refreshed every 15 minutes. Set X402_PRIVATE_KEY (a wallet with a little USDC on Base) " +
      "for live data every minute." });
  }
  if (!pay) return fail("This tool costs a fraction of a cent per call, paid in USDC on Base. Set X402_PRIVATE_KEY to a wallet " +
    "holding a little USDC on Base (no ETH needed), or use the same data on Apify: https://apify.com/zaffy_93/crypto-market-data");
  const required = pay.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json().catch(() => undefined));
  const amount = Number(required.accepts[0].amount);
  if (!(amount > 0) || amount > maxPerCall) return fail(`Price ${amount / USDC_UNITS} USDC is above X402_MAX_PER_CALL_USD (${maxPerCall / USDC_UNITS}); not paid.`);
  if (spent + amount > maxTotal) return fail(`Session budget X402_MAX_TOTAL_USD (${maxTotal / USDC_UNITS}) reached (${spent / USDC_UNITS} USDC spent); not paid.`);
  const payload = await pay.createPaymentPayload(required);
  const paid = await fetch(url, { headers: pay.encodePaymentSignatureHeader(payload) });
  const body = await paid.json().catch(() => ({}));
  if (paid.status === 200 && paid.headers.get("PAYMENT-RESPONSE")) spent += amount;
  // 400/503 answers are not settled by the API, so they cost nothing
  return paid.ok ? text(body) : fail(`Not answered (${paid.status}), not charged: ${body.error || JSON.stringify(body)}`);
}

const server = new McpServer({ name: "crypto-market-data", version: "0.1.2" });
const tokens = z.string().optional().describe("Comma-separated tickers such as BTC,ETH,SOL (up to 50). Empty means the top 50 coins.");
const token = z.string().optional().describe("One ticker such as BTC");
const limit = z.number().int().min(1).max(200).optional().describe("How many rows");

const tools = [
  ["prices", "/v1/prices", "Live prices with 5m/1h/4h/24h change and 24h volume for the top 50 crypto coins (USD 0.003).", { tokens }],
  ["derivatives", "/v1/derivatives", "Funding rate, futures premium, open interest and long/short ratio per coin (USD 0.003).", { tokens }],
  ["orderbook", "/v1/orderbook", "Bid-ask spread, order-book imbalance and buyer share per coin (USD 0.003).", { tokens }],
  ["liquidations", "/v1/liquidations", "Every Binance futures liquidation of the last hour by coin, plus the biggest (USD 0.003).", { token, limit }],
  ["whale_orders", "/v1/whale-orders", "Biggest market orders of the last hour on Binance and Hyperliquid (USD 0.003).", { token, limit }],
  ["news", "/v1/news", "Top crypto stories now from 31 sources with impact and price reaction (USD 0.003).", { token, limit }],
  ["sentiment", "/v1/sentiment", "Fear and Greed, trending coins, market breadth and mood (USD 0.003).", { limit }],
  ["coin_snapshot", "/v1/coin", "Everything for one coin: price, derivatives, order book, liquidations, whales, news (USD 0.005).",
    { token: z.string().describe("One ticker such as BTC") }],
  ["hyperliquid_wallet", "/v1/wallet", "Enriched Hyperliquid wallet report: positions, liquidation distance, risk, PnL, volume (USD 0.01).",
    { address: z.string().describe("Hyperliquid wallet address, 0x followed by 40 hex characters") }],
];
for (const [name, path, description, shape] of tools) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      return await call(path, args);
    } catch (e) {
      return fail(`Request failed: ${e.message}`);
    }
  });
}
server.registerTool("service_info", { description: "Free: what the service offers, prices, and session spending so far.", inputSchema: {} },
  async () => {
    const info = await (await fetch(API + "/")).json();
    return text({ ...info, session: { spent_usdc: spent / USDC_UNITS, max_per_call_usdc: maxPerCall / USDC_UNITS, max_total_usdc: maxTotal / USDC_UNITS,
      paying_wallet: client() ? privateKeyToAccount(process.env.X402_PRIVATE_KEY).address : null } });
  });

await server.connect(new StdioServerTransport());
