# NovaX Backend

Scaffolded project structure for the NovaX backend service. Replace placeholders as you implement the platform.

## Dashboard & Market Sync

- Run `npm run migrate && npm run seed` to create dashboard tables (`dashboard_promotions`, `dashboard_news`, `dashboard_summary`, `exchange_connections`) with demo data.
- Configure Binance API credentials in `.env` via `BINANCE_KEY` and `BINANCE_SECRET`. These keys are used for market streams and for any system-level account sync.
- To target Binance Spot Testnet, set `SPOT_TESTNET=true` and optionally override `SPOT_BASE_REST`/`SPOT_BASE_WS`. Default values resolve to `https://testnet.binance.vision` and `wss://testnet.binance.vision/ws` when the toggle is enabled.
- Futures testnet settings can be staged with `FUT_TESTNET` and `FUT_BASE_REST`; they are parsed by `cfg.binance` for future integrations.
- Insert user-level API credentials into `exchange_connections` to enable per-user snapshots and user-data WebSocket streaming. Each row should include `user_id`, `api_key`, and `api_secret`.
- The `/api/dashboard` routes are secured with JWT middleware and source data from MySQL tables kept current by the Binance REST + WebSocket sync loop.

## Exchange API & Streaming

- REST endpoints under `/api/exchange` expose market metadata, tickers, order books, trades, wallets, and order lifecycle. See Swagger docs (`/docs`) under the **Exchange** tag.
- Socket.IO namespace `/exchange` delivers real-time updates. Authenticate with the JWT (pass `token` in handshake auth/query) and emit `exchange:subscribe` with `{ symbol }` to receive `exchange:snapshot`, `exchange:ticker`, `exchange:orderbook`, `exchange:trade`, `exchange:wallet`, and `exchange:order` events.
- Binance spot streams backfill in-memory caches; the service retries on transient websocket errors and falls back to REST snapshots when caches are cold.
- Orders are relayed to Binance using the API keys stored in `exchange_connections`; ensure listen keys remain valid by keeping the sync worker running (`npm run dev` starts it via `startBinanceSync`).
