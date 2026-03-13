# Glucose Prediction Calibration Log

## Patterns Identified (Audit Mar 6-12)

1. **Morning Glycemic Sensitivity:**
   - Observations: Consistently under-predicting Breakfast spikes (Var: +32 to +64 mg/dL).
   - Calibration: Increase the "predicted rise" multiplier for meals before 11:00 AM by 25%.

2. **High-Carb "Ceiling" Effect:**
   - Observations: Over-predicting absolute peaks for meals >60g carbs (Var: -26 to -32 mg/dL).
   - Calibration: Apply a saturation curve for high loads. Maria's body (likely aided by activity) caps the rise more effectively than a linear model predicts.

3. **Protein/Fat Accuracy:**
   - Observations: Extremely accurate on slow-release meals like Lentil Stew (Var: +1 mg/dL).
   - Calibration: Maintain current logic for high-fiber/high-protein/fat combinations.

4. **Concentrated Sugar Impact:**
   - Observations: Massive under-prediction for small "concentrated" carb items like goji berries (Var: +81 mg/dL).
   - Calibration: Flag "dried fruit" and "sweets" for an aggressive +40% rise multiplier compared to complex carbs.

## Prediction Accuracy Goals (30-Day Target)
- **Value Variance (BG Delta):** Average < 15 mg/dL
- **Timing Variance (Time Delta):** Average < 15 minutes

## Timing Patterns Identified
1. **Lunch Lag:** Lunch peaks are currently happening ~30-40 minutes *later* than predicted (e.g., today's lunch peak was +39 min late). This is likely due to the "gardening lag"—activity before the meal is extending the digestion time.
2. **Breakfast Speed:** Morning spikes are hitting almost exactly when predicted (-2 min to -6 min). 
3. **Snack Quickness:** High-sugar snacks (Goji berries) peak faster than complex meals.

## Activity Modifiers (The "Delta Reducers")
1. **Pre-Meal Activity (Gardening/Walk):** 
   - Effect: Lowers the absolute peak by ~15% and delays the peak time by 20-30 minutes.
   - Action: If Maria has gardened for >45m before a meal, damp the "predicted rise" and push the "predicted time" out.
2. **Post-Meal Activity (Walking):**
   - Effect: Acts as an immediate dampener on the "Rise Velocity."
   - Action: If a walk is logged within 30m of a meal, adjust the projected peak downwards by 20 mg/dL compared to a sedentary window.
3. **Activity Pairings:** Look for patterns like "Gardening + Scallion Pancake" to build specific "defense profiles" for her most common high-carb items.
