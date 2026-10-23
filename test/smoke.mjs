// End-to-end test of the MCP server as a real MCP client would use it (spawned over stdio).
//   node test/smoke.mjs            free checks only (no wallet)
//   node test/smoke.mjs --paid     also one paid call ($0.003) with the buyer wallet in ../../buyer_wallet.json
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  [" + detail + "]" : ""}`); };
async function session(env) {
  const c = new Client({ name: "smoke", version: "1.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../index.js", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")],
    env: { ...process.env, ...env } }));
  return c;
}
const textOf = (r) => r.content?.[0]?.text ?? "";

const c = await session({ X402_PRIVATE_KEY: "" });
const names = (await c.listTools()).tools.map((t) => t.name).sort();
check("10 tools listed", names.length === 10, names.join(","));
const wallet = (await c.listTools()).tools.find((t) => t.name === "hyperliquid_wallet");
check("wallet tool requires an address", wallet?.inputSchema?.required?.includes("address"), JSON.stringify(wallet?.inputSchema));
const info = await c.callTool({ name: "service_info", arguments: {} });
check("service_info is free and lists 9 paid endpoints", JSON.parse(textOf(info)).endpoints.length === 9);
const freeAns = await c.callTool({ name: "prices", arguments: { tokens: "BTC" } });
const freeBody = freeAns.isError ? {} : JSON.parse(textOf(freeAns));
check("without a wallet, prices come free (15-minute copy)", freeBody.free === true && freeBody.rows?.length === 1, textOf(freeAns).slice(0, 200));
const nowallet = await c.callTool({ name: "liquidations", arguments: {} });
check("premium tool without a wallet explains how to pay", nowallet.isError && textOf(nowallet).includes("X402_PRIVATE_KEY"), textOf(nowallet));
await c.close();

const capped = await session({ X402_PRIVATE_KEY: "0x" + "1".repeat(64), X402_MAX_PER_CALL_USD: "0.001" });
const r = await capped.callTool({ name: "prices", arguments: { tokens: "BTC" } });
check("price above the per-call cap is refused, not paid", r.isError && textOf(r).includes("above X402_MAX_PER_CALL_USD"), textOf(r));
await capped.close();

if (process.argv.includes("--paid")) {
  const key = JSON.parse(readFileSync(new URL("../../buyer_wallet.json", import.meta.url), "utf8")).privateKey;
  const p = await session({ X402_PRIVATE_KEY: key, X402_MAX_TOTAL_USD: "0.01" });
  const ok = await p.callTool({ name: "prices", arguments: { tokens: "BTC,ETH" } });
  const body = ok.isError ? {} : JSON.parse(textOf(ok));
  check("paid call returns live data", !ok.isError && body.rows?.length === 2 && body.charged === true, textOf(ok).slice(0, 200));
  const bad = await p.callTool({ name: "coin_snapshot", arguments: { token: "NOPE" } });
  check("bad input is answered with an error and not charged", bad.isError && textOf(bad).includes("not charged"), textOf(bad).slice(0, 200));
  const s = JSON.parse(textOf(await p.callTool({ name: "service_info", arguments: {} }))).session;
  check("session spend counts only the successful call", s.spent_usdc === 0.003, JSON.stringify(s));
  await p.close();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
