# Live RPC Provider Recommendation

This project uses RPC for live blockchain operations and explorer/history APIs for reconciliation and transaction history.

## Short Answer

Do not depend on free public RPC for production.

Recommended launch setup:

| Network | Recommended Provider | Plan |
| --- | --- | --- |
| ETH / ERC20 mainnet | Infura, Alchemy, or QuickNode | Paid starter/developer plan |
| BSC / BEP20 mainnet | Infura, Alchemy, or QuickNode | Paid starter/developer plan |
| TRON / TRC20 mainnet | TronGrid | Paid plan or enough quota for production |
| Solana mainnet | Helius, QuickNode, or Alchemy | Paid developer/starter plan |

## Is Infura Only For Ethereum?

No. Infura is not only Ethereum. Infura advertises access to many supported networks and has BNB Smart Chain support. However, for this project, do not assume Infura is the best single provider for every chain.

Practical recommendation:

- Use Infura/Alchemy/QuickNode for Ethereum.
- Use Infura/Alchemy/QuickNode for BSC.
- Use TronGrid for TRON.
- Use Helius/QuickNode/Alchemy for Solana.

## Free Or Paid For Our Project?

This project monitors deposits, checks balances, funds gas, sweeps tokens, confirms transactions, and may call APIs repeatedly from admin tools. For live use, paid RPC is strongly recommended.

### ETH Mainnet

Free can work for testing, but production should use paid RPC.

Why:

- Deposit monitor uses `eth_getLogs`.
- Balance checks call token contracts.
- Sweep sends transactions.
- Free limits can delay deposits or break scans during traffic.

Recommendation:

```text
Start with Infura Developer plan or equivalent.
Upgrade if logs show rate limits.
```

### BEP20 / BSC Mainnet

Free public BSC RPC is not recommended for production.

Why:

- Public RPC can throttle or fail.
- Deposit monitor needs stable block/log scanning.
- Sweeps need reliable transaction broadcast.

Recommendation:

```text
Use paid Infura, Alchemy, QuickNode, or Chainstack BSC RPC.
```

### TRC20 / TRON Mainnet

Use TronGrid with API key and enough quota. Free/test access is okay only for development.

Why:

- TRON event queries are needed for deposits.
- TRC20 transfers need stable full host access.
- TRON limits can break history lookup and deposit detection.

Recommendation:

```text
Use TronGrid paid production plan if TRC20 is a main deposit network.
```

### Solana Mainnet

Free public Solana RPC is not recommended for production.

Why:

- Public Solana RPC can rate-limit heavily.
- Token account lookups and transaction confirmation need reliability.
- Sweeps/transfers need stable transaction send/confirmation.

Recommendation:

```text
Use Helius Developer/Business, QuickNode, or Alchemy Solana RPC.
```

## Which Plan Should We Choose?

Start with paid starter/developer plans, then upgrade based on log evidence.

Recommended first month:

| Provider | Suggested Starting Plan |
| --- | --- |
| Infura | Developer plan |
| Helius | Developer plan for low/moderate Solana traffic; Business if Solana is important |
| TronGrid | Paid plan suitable for expected TRC20 volume |
| QuickNode / Alchemy | Starter/developer paid tier |

For this project, if deposits are expected to be moderate:

```text
ETH + BSC: Infura Developer or Alchemy Pay-as-you-go
TRON: TronGrid paid
Solana: Helius Developer
```

If TRC20 is the main user deposit network, prioritize TronGrid quota first.

If Solana is not active at launch, keep Solana on a low paid/free tier until enabled.

## RPC vs History APIs

The project uses both.

### RPC Used For

- Checking token balances
- Checking native gas balances
- Reading token contract logs
- Sending sweep transactions
- Confirming chain state
- Admin treasury balance checks

Examples in code:

```text
src/services/depositMonitorService.js
src/services/sweepNetwork.service.js
src/services/sweep.service.js
src/services/adminTreasuryService.js
src/utils/solana.js
```

### Explorer / History APIs Used For

- Transaction history lookup
- Reconciliation when sweep status is uncertain
- Explorer-style deposit lookup
- Fallback confirmation/history checks

Examples in code:

```text
src/services/depositExplorerService.js
src/services/sweep.service.js
src/services/backendUrlManager.service.js
```

Required history/API keys:

```env
ETH_API_TOKEN=
BSC_API_TOKEN=
TRX_API_TOKEN=
```

For Solana, history is generally fetched through Solana RPC methods such as signature lookup.

## Production Decision

Use paid RPC for every live network.

Minimum safe launch:

```text
ETH mainnet: paid RPC
BSC mainnet: paid RPC
TRON mainnet: paid TronGrid
Solana mainnet: paid RPC only if Solana deposits are live
Explorer APIs: keep Etherscan/BscScan/TronGrid keys configured
```

## Official Links

- Infura pricing: https://www.infura.io/pricing
- Infura BSC: https://www.infura.io/networks/bsc
- Alchemy pricing: https://www.alchemy.com/pricing
- QuickNode pricing: https://www.quicknode.com/pricing
- TronGrid: https://www.trongrid.io/
- TronGrid pricing: https://www.trongrid.io/price
- Helius pricing: https://www.helius.dev/pricing
- Etherscan API: https://etherscan.io/apis

