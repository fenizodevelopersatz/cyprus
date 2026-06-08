# Client Message - Required Developer Accounts And Links

Hello,

To complete the production setup, please create or provide access to the following service accounts. These are required for blockchain deposits/withdrawals, payment tracking, email delivery, authentication, and production deployment.

Important: Please do not share private keys, seed phrases, passwords, or API secrets in WhatsApp/email/chat. Use a secure password manager or secure handover method.

## 1. Blockchain RPC Provider

The platform needs reliable RPC URLs to monitor deposits, check wallet balances, process sweeps, and track blockchain transactions.

Recommended providers:

- Infura: https://www.infura.io/pricing
- Infura Ethereum RPC: https://www.infura.io/product/ethereum
- Alchemy: https://www.alchemy.com/pricing
- QuickNode: https://www.quicknode.com/pricing

What we need:

- Ethereum RPC URL for ERC20 deposits/withdrawals
- BSC RPC URL for BEP20 deposits/withdrawals
- Solana RPC URL if Solana deposits are enabled
- Separate staging/testnet and production/mainnet URLs if possible

Please choose a paid/reliable plan. Free RPCs can fail during deposit monitoring and may cause missing or delayed transaction updates.

## 2. TRON / TRC20 RPC

For TRC20 USDT deposits and withdrawals, we need TRON API access.

Official TRON provider:

- TronGrid: https://www.trongrid.io/

What we need:

- TRON full host URL
- TRON API key/token
- Confirmation whether TRC20 USDT is enabled for production

## 3. Solana RPC

If Solana USDC/USDT is enabled, we need a Solana RPC provider.

Recommended provider:

- Helius: https://www.helius.dev/pricing

What we need:

- Solana RPC URL
- Mainnet or devnet confirmation
- Token mint address for the supported Solana token

## 4. Stripe Payment Account

Stripe is needed for fiat payments/payment tracking if card or fiat payment processing is enabled.

Official links:

- Stripe API keys guide: https://docs.stripe.com/keys
- Stripe API key help: https://support.stripe.com/questions/what-are-stripe-api-keys-and-how-to-find-them

What we need:

- Publishable key
- Secret key
- Webhook signing secret
- Base currency
- Confirmation of enabled payment methods

Webhook URL to configure:

```text
https://YOUR_API_DOMAIN.com/webhooks/stripe
```

## 5. Binance API

If live market sync or Binance-based price feeds are enabled, we need Binance API credentials.

Official Binance API management:

- Binance API Management: https://www.binance.com/en/my/settings/api-management
- Binance API documentation: https://developers.binance.com/

What we need:

- Binance API key
- Binance API secret
- Enabled spot symbols
- Enabled futures symbols
- Confirmation whether testnet or live mode should be used

## 6. Email / SMTP Provider

Email is required for OTP, password reset, notifications, and platform alerts.

Common providers:

- SendGrid: https://sendgrid.com/
- Mailgun: https://www.mailgun.com/
- Amazon SES: https://aws.amazon.com/ses/

What we need:

- SMTP host
- SMTP port
- SMTP username
- SMTP password/API key
- Sender email
- Sender name
- Encryption type: TLS/SSL

## 7. Google OAuth

Only required if Google login is enabled.

Official Google Cloud Console:

- Google Cloud Console: https://console.cloud.google.com/
- Google OAuth documentation: https://developers.google.com/identity/protocols/oauth2

What we need:

- Google OAuth client ID
- Google OAuth client secret
- Authorized redirect URL

## 8. Domain And DNS

We need production domains before final deployment.

What we need:

- Frontend domain, for example: `https://exchange.yourdomain.com`
- Backend/API domain, for example: `https://api.yourdomain.com`
- DNS access or approval to create DNS records
- SSL certificate preference, if any

## 9. Wallet And Treasury Details

These are sensitive and must be shared only through secure handover.

What we need:

- Admin treasury wallet address
- Hot wallet address
- Confirmation who controls private keys
- Withdrawal approval flow
- Minimum withdrawal amount
- Withdrawal fee rules
- Sweep policy: manual or automatic

Do not send wallet private keys or seed phrases in plain text.

## 10. Final Client Confirmation

Please confirm:

- Which networks should be live: ERC20, BEP20, TRC20, Solana
- Which fiat provider/payment method should be live
- Who will approve withdrawals
- Who will receive payment/deposit failure alerts
- Production frontend domain
- Production backend/API domain
- Admin users to create

