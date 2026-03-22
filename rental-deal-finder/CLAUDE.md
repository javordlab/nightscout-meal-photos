# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A local, zero-dependency web app for comparing rental car quotes for a specific trip in Spain.

- **Pickup:** Asturias Airport (OVD) — 2026-04-23 21:00
- **Dropoff:** León Train Station — 2026-04-30 20:00
- **Budget:** $550 USD max, manual OK, 500 km expected

## How to Run

```bash
cd rental-deal-finder
python3 server.py
# open http://localhost:8080
```

No installs. Pure Python stdlib + vanilla JS.

## Architecture

| File | Role |
|------|------|
| `server.py` | Python HTTP server (port 8080); one endpoint: `POST /api/hunt` — Bing search + page scraping |
| `app.js` | All frontend logic: quote CRUD, ranking, auto-hunter, localStorage persistence |
| `index.html` | UI: trip setup, driver profile, auto-hunter controls, quote table |
| `styles.css` | Dark theme styling |

**Data flow:** Frontend-driven. `app.js` calls `/api/hunt`, receives raw price candidates, creates Quote objects, saves to `localStorage`, re-renders ranked table. No server-side state.

## Key Concepts

**Auto-Hunter** (Phase 3 core feature): hits Bing RSS for 8 providers (`hertz.com`, `rentalcars.com`, `discovercars.com`, `autoeurope.com`, `kayak.com`, `skyscanner.com`, `expedia.com`, `booking.com`), extracts prices via regex from snippets + full pages + optional `r.jina.ai` mirror. Prices are candidates only — always verify at checkout.

**Ranking score:** `max(0, 130 - effectiveEur/2.7 + policyBonus - budgetPenalty)`. Policy bonuses for free cancellation (+10), full-to-full fuel (+8), mileage coverage (+10). Budget penalty scales with overage.

**Effective price:** `basePrice × (1 - memberPct/100) - coupon + insuranceAddOn`, then converted to USD at configured FX rate.

**Persistence keys** (localStorage):
- `rentalDealFinderQuotesV3` — quote array
- `rentalDealFinderProfileV3` — driver profile
- `rentalDealFinderAutoV3` — auto-hunter interval config

## Constraints

- Single-user, local only — no auth, no sync
- Auto-hunt runtime ~15–20s (network-bound on Bing + provider sites)
- Price extraction regex range: €/$/EUR 80–2000 only
