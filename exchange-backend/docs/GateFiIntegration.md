## GateFi (Unlimit) Overview

GateFi, rebranded from Unlimit, is a regulated fiat on/off ramp platform. It exposes REST APIs and hosted checkout widgets that let our users purchase crypto with cards/Apple Pay and settle the purchased asset directly into our exchange wallets. Within Primerica that asset immediately appears in the user's spot wallet and can be swept into the futures margin account (internally we already journal funds between `spot` and `futures:*` namespaces).

Typical reasons to integrate:

1. Offer compliant card/fiat deposits without building payment rails in‑house.
2. Leverage their AML/KYC and fraud tooling for on-ramp transactions.
3. Provide seamless funding for perpetual futures positions: once the fiat order settles we credit USDT to the user and allow transfers into the futures available balance.

## Configuration in Primerica Admin

1. Navigate to **Settings → Unlimit** in the admin panel (screenshot in issue).  
2. Fill the fields that map to GateFi credentials:
   - **Base URL** – sandbox: `https://api-sandbox.gatefi.com`, production varies per account.
   - **Access Key / Secret Key** – issued by GateFi; used to sign requests.
   - **Partner Account ID** – identifies our merchant account; must match the key pair.
3. Click **Update Unlimit Settings**. The backend stores these keys in `storage/admin-settings.json` via `updateSettings` (no restart required).

> Note: even though `DEFAULT_SETTINGS` in `src/services/settingsService.js` does not list GateFi fields, the service persists any provided keys as part of the JSON blob, so they remain available to the API layer.

## Backend Usage Pattern

1. **Create On-Ramp Order**  
   - Endpoint: POST `https://{baseUrl}/api/v2/orders`.  
   - Signed with HMAC (key/secret). Include `partnerAccountId`, `amount`, `fiatCurrency`, `cryptoCurrency` (use `USDT` to fund futures), and the Primerica `userId` / `walletAddress` in metadata.
   - Response returns a `checkoutUrl` for the frontend to redirect or embed.

2. **Handle Webhooks**  
   - Configure GateFi webhook to point at `/webhooks/gatefi`.  
   - Verify HMAC signature using the secret. Persist payload in a new table (e.g., `fiat_onramp_orders`) and mark the status `CREATED`, `PENDING`, `COMPLETED`, `FAILED`.

3. **Credit User Funds**  
   - When webhook status becomes `COMPLETED`, call our existing ledger service to move funds:  
     ```js
     await journal(trx, [
       { account: spotAvailable(userId, 'USDT'), amount: +value },
       { account: houseAccount('fiat'), amount: -value }
     ]);
     ```  
   - Optionally trigger an automatic transfer from `spot` to `futures:available` if the user initiated the order from the futures funding screen.

4. **Expose Status to Frontend**  
   - Add `/wallet/fiat/onramps` endpoint that pulls from `fiat_onramp_orders` so users see GateFi order statuses.  
   - Admin dashboard can reuse the same data for reconciliation.

## Sample Request / Response

**Create order (server → GateFi)**
```http
POST /api/v2/orders HTTP/1.1
Host: api-sandbox.gatefi.com
Access-Key: <ACCESS_KEY>
Signature: <HMAC_SHA256>
Content-Type: application/json

{
  "partnerAccountId": "123456",
  "purchaseAmount": "100",
  "purchaseCurrency": "USD",
  "receiveCurrency": "USDT",
  "destinationAddress": "Primerica:user:42",
  "returnUrl": "https://app.Primerica.com/wallet/onramp/success",
  "failUrl": "https://app.Primerica.com/wallet/onramp/fail",
  "metadata": { "userId": 42, "fundFor": "futures" }
}
```

**Webhook payload (GateFi → Primerica)**
```json
{
  "orderId": "gf_fiat_001",
  "status": "COMPLETED",
  "purchaseAmount": "100",
  "receiveAmount": "99.5",
  "receiveCurrency": "USDT",
  "metadata": { "userId": 42, "fundFor": "futures" }
}
```

Primerica response: `200 OK`.

## Using GateFi Funds for Futures

1. After crediting the user's spot wallet with the `receiveAmount`, call the existing `/wallet/transfer` (or equivalent internal helper) with `from=spot`, `to=futures`, `asset=USDT`, `amount=receiveAmount`.
2. The futures UI can poll `/futures/account` to confirm `availableMargin` reflects the new deposit.
3. Optionally log an activity entry (`kyc_activity` style) to show “GateFi deposit completed” for auditing.

## TODO / Next Steps

- [ ] Implement `/webhooks/gatefi` endpoint in `src/routes/webhooks.js` (new file) using the configuration above.
- [ ] Create `fiat_onramp_orders` migration + service for persistence.
- [ ] Add admin reporting + user history endpoints.
- [ ] Coordinate with GateFi for production keys and compliance paperwork.

Once those steps are complete, Primerica futures users can on-ramp via GateFi/Unlimit and immediately fund their margin accounts.

