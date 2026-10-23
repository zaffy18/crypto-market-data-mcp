# crypto-market-data-mcp

Live crypto market data and Hyperliquid wallet reports as MCP tools for Claude, Cursor, Codex, VS Code and any MCP
client. Your agent pays per call, in USDC on Base, from its own wallet (x402). There is no account, no API key and no
subscription, and a call that fails is never charged.

| Tool | Returns | Price |
|---|---|---|
| `prices` | Price and 5m/1h/4h/24h change, 24h volume, top 50 coins | $0.003 |
| `derivatives` | Funding rate, futures premium, open interest, long/short ratio | $0.003 |
| `orderbook` | Spread, order-book imbalance, buyer share | $0.003 |
| `liquidations` | Every Binance futures liquidation of the last hour, by coin | $0.003 |
| `whale_orders` | Biggest market orders of the last hour, Binance and Hyperliquid | $0.003 |
| `news` | Top crypto stories now from 31 sources, with price reaction | $0.003 |
| `sentiment` | Fear and Greed, trending coins, breadth, mood | $0.003 |
| `coin_snapshot` | All of the above for one coin | $0.005 |
| `hyperliquid_wallet` | Positions, liquidation distance, risk label, PnL, volume for any address | $0.01 |
| `service_info` | What is offered and what this session has spent | free |

Data refreshes every minute from 24/7 monitoring of Binance spot and futures, Hyperliquid and 31 news sources.

## Install

Claude Desktop, one click: download
[crypto-market-data.mcpb](https://github.com/zaffy18/crypto-market-data-mcp/releases/latest/download/crypto-market-data.mcpb)
and open it. The wallet key is optional and is stored in your system keychain.

Claude Code:

```
claude mcp add crypto-market-data -e X402_PRIVATE_KEY=0x... -- npx -y crypto-market-data-mcp
```

Claude Desktop, Cursor or any MCP client (`mcpServers` config):

```json
{
  "mcpServers": {
    "crypto-market-data": {
      "command": "npx",
      "args": ["-y", "crypto-market-data-mcp"],
      "env": { "X402_PRIVATE_KEY": "0x...", "X402_MAX_TOTAL_USD": "1.00" }
    }
  }
}
```

`X402_PRIVATE_KEY` is the key of a wallet that holds a little USDC on Base. No ETH is needed, because payments are
gasless. Use a dedicated wallet with a small balance.

## Spending limits

- `X402_MAX_PER_CALL_USD` (default `0.01`): no single payment above this.
- `X402_MAX_TOTAL_USD` (default `1.00`): no more payments after this much in a session.

Without a key, `prices` and `sentiment` work free, with data refreshed every 15 minutes. `service_info` works too,
and the other tools explain how to pay.

## Other ways to use the same data

- HTTP API with x402: https://crypto-market-data.zafermemon87.workers.dev (OpenAPI at `/openapi.json`)
- Apify Store, paid by Apify account or agentic payments: https://apify.com/zaffy_93/crypto-market-data
- Verdicts instead of raw data (is a move, whale trade or headline real?): https://apify.com/zaffy_93/crypto-reality-check

Public market data. Not financial advice.
