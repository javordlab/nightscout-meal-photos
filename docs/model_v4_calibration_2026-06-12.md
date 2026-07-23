# Model v3 Calibration Analysis & Model v4 Proposal — 2026-06-12

> **SUPERSEDED 2026-07-23 by Model v5** — see `docs/model_v5_calibration_2026-07-23.md`.

> **STATUS: SHIPPED 2026-06-12** (same day, on Javier's go). Model v4 is live in all five
> formula copies: `foodlog-cwd/CLAUDE.md` Step 4, `scripts/calculate_notion_projections.js`,
> `AGENTS.md`, workspace `CLAUDE.md`, `WORKFLOW_AUTO.md` — plus the prompt string in
> `config.foodlog.json` (bridge restarted). Keep all five in parity on any future change.

Full-history comparison of predicted vs actual BG peaks for Maria's meals.
Data: MySQL `health_ssot.health_log_entries` (predictions parsed from SSoT `(Pred: ...)`,
actuals backfilled from Nightscout 3h-window peaks by `backfill_meal_outcomes.js`).
Analysis script: `/tmp/analyze_pred.js` (session 88e40101, reproducible from the TSV dump query inside).

## Dataset

- 715 Food rows (2026-02-22 → 2026-06-12) → grouped into 456 meals (cumulative sub-entries ≤75 min apart merged; last sub-entry's prediction used — it reflects total carbs).
- 244 meals have both a prediction and a measured actual peak.
- **145 "clean" meals** (no other meal starting inside the 3h peak window) — all findings below use this set unless noted. The other 99 (41%!) are stacked-meal windows where the measured "peak" may belong to the next meal.

Error convention: `err = actual peak − predicted midpoint`. Positive = model UNDER-predicted.

## Overall accuracy (Model v3, clean set)

| Metric | Value |
|---|---|
| Mean error | −3.7 mg/dL (slight over-prediction bias) |
| Median error | −6 mg/dL |
| MAE | 20.2 mg/dL |
| MAPE | 12.9% |
| Within ±10 | 29% |
| Within ±20 | 61% |
| Over-predicted by >10 | 44% |
| Under-predicted by >10 | 27% |

The published `±5` output band is far too narrow — real-world spread is ±20 at ~60% confidence.

## Patterns found

1. **The ×1.2 factor for 31–50g carbs is the single biggest systematic error.**
   Implied factor from data: ~0.77–0.9 (n=57). meanErr −10.7, 58% of these meals over-predicted.
   The 51+g ×0.8 is roughly right (implied 0.69); 0–15g ×2.0 is exactly right; 16–30g ×1.3 slightly high (implied 1.14).
   Physiology: factor should decline monotonically with load (2.0 → 1.2 → 0.9 → 0.7), v3 had a bump at 1.2.

2. **Pre-meal BG is carried 1:1 into the prediction but reality damps it ~35%** (regression to the mean / glucose-dependent insulin response).
   - preBG <90 → model under-predicts by +19 on average
   - preBG 130–150 → over-predicts by −15
   - preBG ≥150 → over-predicts by −14 (0% under-predicted!)
   - Linear fit: `err = −0.35 × preBG + 38.6` (r=−0.29, n=145) → damping term `−0.35 × (preBG − 115)`.

3. **Breakfast is over-predicted** (meanErr −12.2, 53% over). The +31 dawn intercept is too aggressive once the carb-factor fix lands (breakfasts cluster in the 31–50g bracket, compounding). First-meal-of-day overall: −7.1.

4. **Mid-afternoon meals (14:00–16:00) are the one UNDER-predicted slot**: meanErr +13.7, 56% under-predicted. Spanish lunch at ~14:30 hits harder than the Lunch −12 intercept suggests (intercept was likely fit partly on earlier-hour US-period lunches).

5. **Late evening (21:00+) is the noisiest slot**: only 16% within ±10, median err −12 (over-predicted). Before-bed snacks/dinners run lower than predicted at median but with fat-heavy outliers running much higher (e.g. cheesecake 2026-06-04: +60 under-prediction with extended peak at +4h — fat delays AND extends beyond the 3h window).

6. **Time-to-peak table is badly miscalibrated** (peaks arrive much earlier than predicted):
   | MealType | v3 model | Actual median | n |
   |---|---|---|---|
   | Breakfast | 87 min | 86 min ✓ | 22 |
   | Lunch | 113 min | **74 min** | 22 |
   | Dinner | 76 min | **55 min** | 31 |
   | Snack | 126 min | **55 min** | 25 |
   | Dessert | 102 min | 95 min ✓ | 7 |

7. **Post-meal walks: average measured effect is only ~2–5 mg/dL vs prediction**, not the 20–40 mg/dL "peak clip" the Coach narrative often cites (walked n=89 meanErr −4.5 vs no-walk n=56 meanErr −2.4). Confounded (walks correlate with meal size/weather), but the burden of proof flipped: don't assume a large walk clip.

8. **No model drift over time** — monthly meanErr stable (−6.4 / −3.6 / −5.1 / +0.5 Mar→Jun). The May-24+ sensor low-bias (~9 mg/dL) affects preBG and peak equally, so rise-based conclusions stand.

9. **Meal stacking is the biggest data-quality hole**: 41% of meals have another meal within 3h. The 1h cumulative rule misses 1–3h re-eats; those predictions can't be evaluated (and arguably can't be right, since the second meal lands on an unresolved curve).

## Proposed Model v4 (validated out-of-sample)

**Formula:** `Pred = preBG + (carbs × factor) + intercept − 0.35 × (preBG − 115)` (cap 300)

| Carbs (g) | v3 factor | **v4 factor** |
|---|---|---|
| 0–15 | ×2.0 | ×2.0 |
| 16–30 | ×1.3 | ×1.2 |
| 31–50 | ×1.2 | ×0.9 |
| 51+ | ×0.8 | ×0.7 |

| MealType | v3 intercept / ttp | **v4 intercept / ttp** |
|---|---|---|
| Breakfast | +31 / 87 min | **+25 / 87 min** |
| Lunch | −12 / 113 min | **−5 / 75 min** |
| Dinner | −2 / 76 min | **0 / 55 min** |
| Snack | +4 / 126 min | **0 / 60 min** |
| Dessert | −14 / 102 min | **−10 / 95 min** |

Output band: widen `Pred ± 5` → `Pred ± 10` (still optimistic vs MAE ~15, but honest-er).

**Validation:**
- Holdout (params from Mar–Apr only, tested on unseen May–Jun, n=89): v3 MAE 21.8 → v4 17.8; the rounded table above scores **16.1**, ±20 band 54% → 63%.
- Full clean set (n=145): MAE 20.6 → **14.9** (−28%), ±20: 57% → 68%, bias −6.4 → +1.8.

## Not yet incorporated (future candidates)

- **Fat-extended peaks**: high-fat desserts/cheese (cheesecake, natillas) peak beyond the 3h measurement window — needs a 4–5h window + "fat flag" to even measure.
- **+10-ish afternoon bump**: a 14:00–16:00 hour adjustment would fix the one under-predicting slot; partially handled by Lunch intercept change.
- **Stacking-aware predictions**: when a meal lands <3h after the prior one, anchor on the prior meal's predicted curve, not live BG.
- Walk effect: data says small on average — leave out of the model; soften Coach claims of 20–40 mg/dL clips.
