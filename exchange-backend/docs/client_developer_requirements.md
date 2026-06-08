# Client Developer Requirements Checklist

Use this document to collect all technical details from the client before production setup. Do not ask the client to send private keys, seed phrases, API secrets, or passwords over chat. Collect secrets through a secure password manager or sealed deployment form.

## 1. Project Basics

| Item | Needed From Client | Notes |
| --- | --- | --- |
| Brand name | Final exchange/site name | Used in admin settings and frontend branding |
| Production frontend URL | Example: `https://example.com` | Maps to `FRONTEND_URL`, `APP_URL`, `APP_BASE_URL` |
| Production backend API URL | Example: `https://api.example.com` | Maps to `API_BASE_URL`, `API_URL` |
| Admin email | Email for operational alerts | Also used for notification settings |
| Support email | Public support contact | Used in content/settings |
| Deployment environment | Production / staging | Maps to `NODE_ENV` |

## 2. Domain, DNS, And SSL

| Item | Needed From Client | Notes |
| --- | --- | --- |
| Frontend domain | Domain/subdomain | Example: `exchange.client.com` |
| Backend API domain | Domain/subdomain | Example: `api.client.com` |
| WebSocket domain | Usually same as API | Required for live dashboard/wallet updates |
| DNS access | Cloudflare/Godaddy/etc. access or records approval | Needed for A/CNAME records |
| SSL preference | Managed SSL or client-provided certificate | Usually managed by hosting/proxy |
| Allowed origins | List of frontend origins | Maps to `CORS_ALLOWLIST` |

## 3. Blockchain RPC Providers

Collect reliable paid RPCs for production. Free RPC URLs often fail under deposit monitoring, treasury balance checks, and sweep operations.

| Network | Provider Examples | Required Value | Env Mapping |
| --- | --- | --- | --- |
| Ethereum / ERC20 | Infura, Alchemy, QuickNode, Chainstack | HTTPS RPC URL | `ETH_RPC_URL`, optional `ETH_RPC_HTTP` |
| BSC / BEP20 | QuickNode, Chainstack, Ankr, GetBlock | HTTPS RPC URL | `BSC_RPC_URL`, optional `BSC_RPC_HTTP` |
| TRON / TRC20 | TronGrid, GetBlock, QuickNode | Full host URL and API key if applicable | `TRX_API_URL`, `TRON_FULL_HOST`, `TRON_API_BASE`, `TRX_API_TOKEN`, `TRON_API_KEY` |
| Solana | Helius, QuickNode, Triton, Alchemy | HTTPS RPC URL | `SOLANA_RPC_URL`, optional `SOLANA_DEVNET_RPC` |

Questions to ask the client:

- Which networks must be enabled: ERC20, BEP20, TRC20, Solana?
- Are we using mainnet or testnet/devnet?
- What is the RPC plan limit: requests per second, monthly quota, archive support?
- Does the provider allow server-side backend usage?
- Does the provider give separate staging and production endpoints?

## 4. Token Contracts And Network Settings

| Item | Needed From Client | Env Mapping |
| --- | --- | --- |
| Ethereum USDT contract | Mainnet/testnet contract address | `USDT_ETH_CONTRACT` |
| BSC USDT contract | Mainnet/testnet contract address | `USDT_BSC_CONTRACT` |
| TRON USDT contract | Mainnet/testnet contract address | `USDT_TRON_CONTRACT` |
| Solana token mint | USDC/USDT mint address | `SOLANA_TOKEN_MINT`, `SOLANA_USDC_MINT`, `SOLANA_TESTNET_USDC_MINT` |
| Confirmation rules | Required confirmations per network | `ETH_CONFIRMATIONS`, `BSC_CONFIRMATIONS`, `TRX_CONFIRMATIONS`, `SOLANA_CONFIRMATIONS` |
| Deposit monitor status | Enabled or disabled | `DEPOSIT_MONITOR_ENABLED=true` |

## 5. Wallet, Treasury, And Sweep Setup

These values are sensitive. Handle only through secure secret storage.

| Item | Needed From Client | Env Mapping / Admin Mapping |
| --- | --- | --- |
| Master wallet xprv | Custodial wallet derivation root | `MASTER_XPRV` |
| Derivation base path | Usually default unless client has a wallet policy | `MASTER_BASE_PATH`, `CUSTODIAL_BASE_PATH` |
| Wallet encryption secret | Strong random secret | `WALLET_ENCRYPTION_SECRET` |
| Wallet transport private key | Private key generated for encrypted admin wallet operations | `WALLET_TRANSPORT_PRIVATE_KEY` |
| Admin hot wallet address | Address for receiving sweeps | `ADMIN_WALLET_ADDRESS` or admin asset settings |
| Admin private key | Only if sweeps/payouts are automated | `ADMIN_PRIVATE_KEY` or encrypted admin asset settings |
| Sweep thresholds | Minimum amount before sweeping | Network-specific sweep settings |
| Gas top-up policy | Amount and minimum gas balance | Gas funding settings |

Client decisions:

- Manual withdrawals or automated withdrawals?
- Manual sweep or automatic sweep?
- Who controls treasury private keys?
- Who approves withdrawals?
- What is the minimum withdrawal amount?
- What admin fee should apply to withdrawals?

## 6. Payment Providers

### Stripe

| Item | Needed From Client | Env / Admin Mapping |
| --- | --- | --- |
| Stripe publishable key | Public frontend key | Admin settings / `STRIPE_PUBLIC_KEY` |
| Stripe secret key | Backend secret key | Admin settings / `STRIPE_SECRET_KEY`, `STRIPE_SECRET` |
| Stripe webhook secret | Webhook signing secret | `STRIPE_WEBHOOK_SECRET` |
| Base currency | Example: USD | Admin settings |
| Enabled payment methods | Card, bank, etc. | Stripe dashboard setting |

Webhook URL to configure:

```text
https://api-domain.com/webhooks/stripe
```

### Fiat / On-Ramp Provider

If GateFi/Unlimit or another on-ramp is used, collect:

| Item | Needed From Client |
| --- | --- |
| Merchant ID / account ID |
| API key / secret |
| Webhook secret |
| Allowed domains |
| Supported countries |
| Supported fiat currencies |
| KYC responsibility: platform or provider |
| Production and sandbox endpoints |

## 7. Exchange / Market Data

| Item | Needed From Client | Env Mapping |
| --- | --- | --- |
| Binance API key | Needed if live Binance sync is enabled | `BINANCE_KEY` |
| Binance API secret | Secret value | `BINANCE_SECRET` |
| Enable Binance sync | Yes/no | `ENABLE_BINANCE`, `BINANCE_ENABLED` |
| Spot symbols | Comma-separated symbols | `BINANCE_SPOT_SYMBOLS` |
| Futures symbols | Comma-separated symbols | `BINANCE_FUT_SYMBOLS` |
| Testnet mode | Yes/no | `SPOT_TESTNET`, `FUT_TESTNET` |
| Minimum notional | Minimum trade amount | `EXCHANGE_MIN_NOTIONAL_USDT` |

## 8. Email / SMTP

| Item | Needed From Client | Admin / Env Mapping |
| --- | --- | --- |
| Mail provider | SMTP, SendGrid, Mailgun, etc. | Admin settings |
| SMTP host | Example: `smtp.mailgun.org` | Admin settings |
| SMTP port | Usually `587`, `465`, or `2525` | Admin settings |
| SMTP username | Provider username | Admin settings |
| SMTP password | Provider password/API key | Admin settings |
| Encryption | TLS/SSL/none | Admin settings |
| Sender name | Brand name | Admin settings |
| Sender email | Verified sender email | Admin settings |

## 9. Authentication And OAuth

| Item | Needed From Client | Env Mapping |
| --- | --- | --- |
| JWT secret | Strong random secret | `JWT_SECRET` |
| JWT expiry | Example: `15m` | `JWT_EXPIRES` |
| Refresh expiry | Example: `30d` | `REFRESH_EXPIRES` |
| Password encryption key | Strong random secret | `pwdSECRET_KEY` |
| Google OAuth client ID | If Google login is enabled | `GOOGLE_CLIENT_ID` |
| Google OAuth secret | If Google login is enabled | `GOOGLE_CLIENT_SECRET` |
| Google redirect URL | Backend/frontend redirect URL | `GOOGLE_REDIRECT_URI` |

## 10. Admin And Operations

| Item | Needed From Client | Notes |
| --- | --- | --- |
| Initial admin users | Name, email, role | Create before launch |
| Admin roles | Super admin, finance, support, compliance | Define permissions |
| KYC review process | Who approves KYC? | Compliance workflow |
| Withdrawal approval process | Single or multi-step | Finance workflow |
| Log viewer credentials | Production username/password | `LOG_VIEWER_USER`, `LOG_VIEWER_PASSWORD` |
| Audit retention | How long to keep logs | Server/log policy |
| Backup policy | Frequency and storage location | Database + uploaded files |

## 11. Frontend Build Values

| Item | Needed From Client | Env Mapping |
| --- | --- | --- |
| API URL | Backend URL used by frontend | `VITE_API_URL` |
| WebSocket URL | Usually same as API | `VITE_WS_URL` |
| Mock mode | Should be off in production | `VITE_MOCK_MODE=0` |

## 12. Production Secrets Checklist

Generate or collect these before deployment:

```text
NODE_ENV=production
PORT=
APP_URL=
FRONTEND_URL=
API_BASE_URL=
CORS_ALLOWLIST=

JWT_SECRET=
pwdSECRET_KEY=

ETH_RPC_URL=
BSC_RPC_URL=
TRX_API_URL=
TRX_API_TOKEN=
SOLANA_RPC_URL=

USDT_ETH_CONTRACT=
USDT_BSC_CONTRACT=
USDT_TRON_CONTRACT=
SOLANA_TOKEN_MINT=

MASTER_XPRV=
WALLET_ENCRYPTION_SECRET=
WALLET_TRANSPORT_PRIVATE_KEY=
ADMIN_WALLET_ADDRESS=
ADMIN_PRIVATE_KEY=

BINANCE_KEY=
BINANCE_SECRET=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

LOG_VIEWER_USER=
LOG_VIEWER_PASSWORD=
```

## 13. Client Sign-Off Questions

Ask the client to confirm:

- Which blockchain networks are live on day one?
- Which deposits are supported: USDT ERC20, USDT BEP20, USDT TRC20, Solana USDC/USDT?
- Who owns treasury wallets and private keys?
- Are withdrawals manual, semi-automatic, or fully automatic?
- What is the daily withdrawal limit?
- What payment providers are active: Stripe, on-ramp, bank/manual?
- Who receives payment/deposit failure alerts?
- What countries/currencies should fiat payments support?
- What is the launch domain and API domain?
- What admin users should be created?

