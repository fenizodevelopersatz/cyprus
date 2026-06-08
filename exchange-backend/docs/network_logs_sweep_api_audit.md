# Network, Logs, Sweep, And API Call Audit

This document explains the current operating concept and the improvements added for easier network switching, safer sweep execution, better logs, and frontend API call review.

## 1. Network Mode Switching

The backend now supports a simple network mode resolver.

Primary switch:

```env
NETWORK_MODE=devnet
```

Allowed practical values:

```text
devnet
testnet
mainnet
```

Aliases also work:

```text
development -> devnet
staging -> testnet
production -> mainnet
live -> mainnet
```

### RPC Selection Priority

The code keeps existing behavior first, but also supports clean mode-based keys.

For Ethereum:

```env
NETWORK_MODE=mainnet
ETH_RPC_MAINNET=
ETH_RPC_TESTNET=
ETH_SEPOLIA_RPC_URL=
ETH_RPC_URL=
ETH_RPC_HTTP=
```

For BSC:

```env
NETWORK_MODE=mainnet
BSC_RPC_MAINNET=
BSC_RPC_TESTNET=
BSC_RPC_URL=
BSC_RPC_HTTP=
```

For TRON:

```env
NETWORK_MODE=mainnet
TRX_API_MAINNET=
TRX_API_NILE=
TRX_API_URL=
TRON_FULL_HOST=
TRON_API_BASE=
```

For Solana:

```env
NETWORK_MODE=devnet
SOLANA_NETWORK=devnet
SOLANA_DEVNET_RPC=
SOLANA_TESTNET_RPC=
SOLANA_MAINNET_RPC=
SOLANA_DEVNET_USDC_MINT=
SOLANA_TESTNET_USDC_MINT=
SOLANA_MAINNET_USDC_MINT=
```

### Important Rule

Admin `signal_assets` values still have first priority where the service already reads them. That means if the admin asset has an RPC URL, token contract, hot wallet, or private key configured, it can override env values.

Use this order operationally:

1. Set `NETWORK_MODE`.
2. Confirm admin `signal_assets` records match that mode.
3. Confirm token contracts/mints match that mode.
4. Run backend URL status checks.
5. Run a small deposit/sweep test.

## 2. Required Network Details

### Mainnet

Collect:

- Ethereum mainnet RPC URL
- BSC mainnet RPC URL
- TRON mainnet full host and API key
- Solana mainnet RPC URL if Solana is live
- Mainnet token contracts/mints
- Production admin wallet addresses
- Production treasury policy

### Testnet / Devnet

Collect:

- Ethereum Sepolia RPC URL
- BSC testnet RPC URL
- TRON Nile RPC URL and API key
- Solana devnet/testnet RPC URL
- Test token contracts/mints
- Test admin wallets

Do not mix mainnet wallets with testnet RPCs.

## 3. Log System

Current logging stack:

- Pino logger
- Console logging
- File logging
- Log viewer page at `/log-viewer`
- Backend log viewer API at `/api/log-viewer`

Supported env keys:

```env
LOG_CONSOLE=true
LOG_FILE=true
LOG_TO_FILE=true
LOG_FILE_PATH=logs/app.log
LOG_LEVEL=debug
LOG_PRETTY=true
```

Compatibility note:

- `LOG_FILE` and `LOG_TO_FILE` are both supported.
- `LOG_FILE_PATH` is now honored.
- If `LOG_FILE_PATH` is not set, the backend writes to a daily file like `logs/app-YYYY-MM-DD.log`.

Log files visible in `/log-viewer`:

```text
exchange-backend/logs/*.log
exchange-backend/storage/*.json
exchange-backend/storage/*.jsonl
```

Recommended production settings:

```env
LOG_CONSOLE=true
LOG_FILE=true
LOG_LEVEL=info
LOG_PRETTY=false
LOG_FILE_PATH=logs/app.log
```

## 4. Sweep Process

The intended sweep order is:

1. Queue eligible credited deposits.
2. Load user wallet private key securely.
3. Check on-chain token balance.
4. If token balance is below threshold or zero, mark failed.
5. Estimate gas.
6. Check native gas balance.
7. If gas is insufficient, create/send gas funding.
8. After gas is confirmed, continue sweep.
9. Sweep full available token balance to admin wallet.
10. Mark sweep and deposit as confirmed.

Current optimized behavior:

- Batch sweep no longer keeps reprocessing already failed sweep rows.
- Failed rows should be retried through explicit retry action.
- `processSweep` already performs token balance check before gas funding and transfer.
- Gas funding flow is preserved for networks that need native gas.

Recommended admin flow:

1. Open Admin Wallet Deposits / Sweep Queue.
2. Click run eligible sweeps.
3. Review rows marked insufficient gas.
4. Run pending gas funding.
5. Retry only the rows that are ready or manually confirmed.

## 5. Balance Check Before Sweep

The important balance check is here:

```text
exchange-backend/src/services/sweep.service.js
processSweep()
```

It calls:

```text
getTokenBalanceRaw(userWallet.address, row.network, userWallet.decryptedPrivateKey)
```

Then:

- If balance is zero, sweep fails as insufficient token balance.
- If balance is below `*_MIN_SWEEP_USDT`, sweep fails as below threshold.
- If balance exists, it sweeps the on-chain balance, not just the original deposit row value.

This is useful when multiple deposits arrive in one user wallet before sweep runs.

## 6. Frontend To Backend Multiple API Calls

The frontend does make multiple backend calls, especially in admin dashboards. This is normal but should be controlled.

Main high-call areas:

| Frontend Area | Calls |
| --- | --- |
| `AdminShell.tsx` | Admin session, KYC sidebar summary, admin settings, WebSocket connection |
| `AdminDashboardPage.tsx` | Dashboard container, audit logs, WebSocket updates |
| `AdminUsersPage.tsx` | User list, selected user overview, balances, deposits, withdrawals, income ledger |
| `AdminTreasuryPage.tsx` | Treasury overview, sweep action, gas/sweep actions |
| `AdminWalletDepositsPage.tsx` | Sweep queue list and refetch after actions |
| `FundingPage` / wallet APIs | Balances, deposit addresses, history, refresh deposits |
| `Dashboard` | Summary, positions, orders, tickers, movers, market pulse, promos, news |

### Optimization Recommendation

Use combined/container endpoints where possible.

Already good:

```text
GET /admin/dashboard/container
```

This reduces multiple dashboard calls by returning overview, activity, treasury, services, websocket status, and sidebar data in one payload.

Potential future improvements:

- Add an admin user detail container endpoint.
- Add a wallet overview container endpoint for balances + deposits + withdrawals.
- Avoid refetching KYC/settings/sidebar on every admin route change.
- Use WebSocket updates for frequently changing counters.
- Keep polling intervals long for heavy pages.

## 7. Files Changed For This Audit

```text
exchange-backend/src/utils/networkMode.js
exchange-backend/src/utils/solana.js
exchange-backend/src/services/sweepNetwork.service.js
exchange-backend/src/services/depositMonitorService.js
exchange-backend/src/services/backendUrlManager.service.js
exchange-backend/src/services/sweep.service.js
exchange-backend/src/logging/logger.js
exchange-backend/.env
```

## 8. Final Production Checklist

Before going live:

- Set `NETWORK_MODE=mainnet`.
- Replace all dev/test RPC URLs with production RPCs.
- Verify `signal_assets` are production values.
- Verify token contracts/mints are mainnet.
- Rotate all exposed or development secrets.
- Confirm deposit monitor is enabled only after test deposits pass.
- Confirm sweep threshold and gas top-up values.
- Confirm log viewer credentials are changed.
- Confirm admin treasury balances.
- Test one small deposit per live network.
- Test one sweep per live network.

