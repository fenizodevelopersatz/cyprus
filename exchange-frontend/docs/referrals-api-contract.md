# Referrals API Contract

Frontend screens expect the following authenticated endpoints. All requests include the bearer token that is already injected by the Axios instance (`Authorization: Bearer <token>`).

## `GET /api/referrals/dashboard`

Returns the complete payload needed by the referrals hub.

```jsonc
{
  "stats": {
    "totalInvites": { "value": 148, "delta": 12, "deltaLabel": "+12 this week" },
    "verifiedTraders": { "value": 86, "delta": 7, "deltaLabel": "+7 this week" },
    "rewardsEarned": { "value": 2430.0, "delta": 180, "deltaLabel": "+$180" },
    "pendingPayout": { "value": 320.0, "deltaLabel": "Scheduled Friday" }
  },
  "primary": {
    "code": "CryptoSignal-WELCOME-92FH",
    "message": "Join CryptoSignal via my invite…",
    "url": "https://cryptosignal.exchange/invite/CryptoSignal-WELCOME-92FH",
    "promoActive": true,
    "updatedAt": "2025-10-05T14:27:00Z"
  },
  "tiers": [
    { "tier": "Silver", "requirementLabel": "$5k volume", "rewardLabel": "5% lifetime rebate" },
    { "tier": "Gold", "requirementLabel": "$50k volume", "rewardLabel": "10% rebate + $100 bonus" },
    { "tier": "Platinum", "requirementLabel": "$250k volume", "rewardLabel": "15% rebate + $600 bonus" }
  ],
  "referrals": [
    {
      "id": "r1",
      "email": "alexa.trade@clients.io",
      "status": "rewarded",
      "joinedAt": "2025-10-04T13:42:00Z",
      "volume": 128400.0
    }
  ]
}
```

Only the listed fields are required; unknown fields are ignored. The frontend formats numbers and currency.

## `POST /api/referrals/promo`

Toggle the promotion campaign state.

**Body**

```json
{ "active": true }
```

**Response**

```json
{ "promoActive": true }
```

## `GET /api/referrals/export`

Streams a CSV export (`text/csv`) of referral records. The frontend saves the blob to `referrals-YYYY-MM-DD.csv`.

---

The endpoints should return `401` for unauthenticated requests and `429` if rate limits are exceeded. All other errors should include `{ "message": "human readable text" }` so the UI can surface them to the user.
