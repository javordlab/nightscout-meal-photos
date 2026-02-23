# Spain Rental Deal Finder (Phase 3)

Local app to compare rental car offers for:
- **Pickup:** Asturias Airport (OVD), Spain — 2026-04-23 21:00
- **Dropoff:** León Train Station, Spain — 2026-04-30 20:00
- **Vehicle:** Mid-size car or SUV

## Configured profile (Javi)
- Driver age: **25+**
- Transmission: **Manual OK**
- Expected mileage: **500 km**
- Insurance strategy: **No extra insurance needed**
- Budget: **$550 max**
- Deposit tolerance: **No limit**
- Discount programs: **AAA, AmEx Platinum, Hertz Member**

## What Phase 3 adds

- **Auto Hunter (Beta):** runs lightweight scans against indexed provider pages/snippets
- Extracts price hints from snippet text and adds them as candidate quotes
- Supports manual run + optional auto-run interval (minutes)
- Triggers in-app alert when best effective price goes under your budget

## Core capabilities retained

- Discount-aware provider search links (AAA/AmEx/Hertz terms included)
- Quote board with effective-price inputs:
  - base price (€)
  - deposit hold (€)
  - mileage included (km/unlimited)
  - coupon discount (€)
  - membership discount (%)
  - insurance add-on (€)
  - cancellation + fuel policy
- Effective cost in EUR + USD
- Ranking by cost + policy fit + budget fit
- Local persistence + JSON import/export

## Run

```bash
cd rental-deal-finder
python3 server.py
```

Open: <http://localhost:8080>

## Important caveat

Auto Hunter is a **lead generator**, not final pricing truth. Rental pricing is dynamic and often requires checkout-level validation (one-way fees, airport fees, insurance assumptions, and tax handling). Always verify the final booking page before reserving.

## Next possible upgrade (Phase 4)
1. Provider-specific scrapers/API adapters for direct checkout totals
2. Daily scheduled runs with push alerts (Telegram/Signal)
3. Stronger dedupe + confidence scoring based on evidence completeness
