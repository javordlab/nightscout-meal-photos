# Model v4 Prospective Evaluation & Model v5 — 2026-07-23

> **STATUS: SHIPPED 2026-07-23.** Model v5 is live in all parity copies:
> `foodlog-cwd/CLAUDE.md` Step 4, `scripts/calculate_notion_projections.js`, `AGENTS.md`,
> workspace `CLAUDE.md`, `WORKFLOW_AUTO.md` — plus the `defaultPhotoPrompt` string in
> `config.foodlog.json` (bridge restarted). Keep ALL copies in parity on any future change.

First fully **prospective** evaluation: every prediction in this dataset was made in real
time by Model v4 (shipped 2026-06-12 19:45) before the outcome existed — no hindsight fit.
Data: MySQL `health_ssot.health_log_entries`, meals 2026-06-13 → 2026-07-23.
Analysis scripts: session scratchpad `analyze_v4.js`, `refit_v5.js`, `candidates_v5.js`
(session d0587f36; reproducible from the TSV dump query inside).

## Dataset

- 266 Food rows → 184 meals (cumulative sub-entries ≤75 min apart merged; last sub-entry's
  prediction used). 170 evaluable (prediction + measured actual + preBG).
- **104 "clean" meals** (v4 definition: no other meal starting inside the 3h peak window;
  plus new exclusion of "approx. time" travel-day entries). Primary evaluation set.
- **79 "strict-clean"** (additionally: no meal ending <2h before the start — those ride the
  prior meal's curve; v4's definition only looked forward). Used as a cross-check.
- Error convention: `err = actual peak − predicted midpoint`. Positive = UNDER-predicted.

## How v4 held up prospectively (clean set, n=104)

| Metric | v4 at calibration (2026-06-12) | v4 prospective |
|---|---|---|
| MAE | 14.9 | 16.6 |
| Within ±20 | 68% | 70% |
| Within ±30 | ~90% | 87% |
| Bias | +1.8 | **+5.2 (under-predicting)** |

Held up well — normal shrinkage, no drift blowup. But three systematic residuals emerged.

## Patterns found

1. **Protein-heavy meals are the biggest systematic error.** Meals with 20g+ protein:
   meanErr **+14.7, n=46, 52% under-predicted by >10** (steak +64, squid+potatoes +60,
   charcuterie +48, tuna collar +32). 10–19g protein: −5.6 (fine). 0–9g: +2.8 (fine).
   Gluconeogenesis from large protein loads — a real physiological signal v4 ignores.
2. **51+g carbs under-predicted**: meanErr +13.7 (n=27), implied factor 0.88 vs v4's 0.7.
3. **Lunch under-predicted** (+14.3, n=26) / 14:00–16:00 slot (+12.1) — but this is largely
   the SAME meals as (1): big protein-heavy Spanish lunches. The protein term absorbs it,
   which generalizes better than an hour/slot fix now that Maria is back in CA.
4. **Breakfast still over-predicted** (−6.4, n=24; worst over-predictions are all 10-11h
   yogurt/toast breakfasts). +25 dawn intercept still too hot → +20.
5. **16–30g and 31–50g brackets are spot-on** (bias +1.4 / +1.3) — do not touch.
6. **preBG damping holds** (bands within ±10 residual; 90–109 shows +10.2 but that's the
   protein-lunch cohort again). Slope stays 0.35.
7. **Time-to-peak: the stored `time_to_peak_min` column was corrupted by a TZ parsing bug**
   (backfill parsed UTC "peak_time" as host-local; fixed 2026-07-23 in
   `backfill_meal_outcomes.js` — all values stored before that date are skewed by the host
   UTC offset). Recomputed from raw UTC `peak_time`: Breakfast median 66 (n=19),
   Lunch 61 (n=9), Dinner 80 (n=21), Snack 49 (n=8), Dessert 123 (n=4).
   Dinner peaks LATER than v4's 55 (Spain-period late dinners).

## What did NOT work: full refit

A 10-parameter coordinate-descent refit on the training half beat v4 in-sample
(MAE 14.7) but **lost on the July holdout** (±20: 53% vs v4's 73%) — classic overfit at
n≈50 train. v5 is therefore a minimal targeted update, not a refit: candidates of 1–3
fixed tweaks were scored (no fitting) on both clean and strict sets, split June/July.

## Model v5 (shipped)

**Formula:** `Pred = preBG + (carbs × factor) + intercept + 0.3 × max(0, protein_g − 20)
− 0.35 × (preBG − 115)` (cap 300)

| Parameter | v4 | **v5** | Why |
|---|---|---|---|
| Carb 0–15g | ×2.0 | ×2.0 | unchanged (n=9 too small to move) |
| Carb 16–30g | ×1.2 | ×1.2 | spot-on |
| Carb 31–50g | ×0.9 | ×0.9 | spot-on |
| Carb 51+g | ×0.7 | **×0.8** | implied 0.88, +14 bias |
| Breakfast intercept | +25 | **+20** | −6 residual persists |
| Lunch intercept | −5 | **0** | protein term carries the lift |
| Dinner / Snack | 0 / 0 | 0 / 0 | unchanged |
| Dessert | −10 | −10 | unchanged (n=4) |
| Protein term | — | **+0.3 × (protein−20)⁺** | +15 bias on 20g+ meals, n=46 |
| preBG damping | 0.35 | 0.35 | unchanged |

Time-to-peak (n-weighted blend of v4-era and prospective medians):
Breakfast 87→**75** | Lunch 75→**70** | Dinner 55→**65** | Snack 60→**55** | Dessert 95→**105**.
Output band stays Pred ± 10.

**Validation (fixed params, no fitting — scored on data v5 never saw during selection is
impossible here; guarded instead by June/July split stability + strict-set cross-check):**

| Set | v4 | v5 |
|---|---|---|
| Clean n=104 | MAE 16.6, bias +5.2, ±20 70% | **MAE 15.8, bias +1.9, ±20 70%** |
| Strict n=79 | MAE 16.9, bias +4.4, ±20 70% | **MAE 16.0, bias +1.5, ±20 70%** |
| July-only (clean) | MAE 15.8, bias +7.4 | **MAE 14.3, bias +4.3** |
| Residual by type | B −5.8 / L +12.6 / D +6.4 / S +5.0 | **B −1.7 / L −0.5 / D +3.9 / S +4.0** |

The headline gain is **bias elimination and flat per-type residuals**, not raw MAE — v5
mostly stops the systematic under-prediction of big protein meals.

## Caveats / future candidates

- **Regime caveat:** most of the evaluation window is Maria's Spain stay (through Jul 21).
  The protein term was chosen over a Lunch-intercept bump precisely because it follows the
  food, not the schedule — re-evaluate ~6 weeks after CA return (mid-September 2026).
- **Dessert +13.6 residual (n=4)** — too small to act on; watch.
- Fat-extended peaks (>3h window), stacking-aware predictions: still open from v4's list.
- The next calibration gets clean `time_to_peak_min` data (TZ bug fixed 2026-07-23).
