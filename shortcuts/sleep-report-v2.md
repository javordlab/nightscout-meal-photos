# Siri Shortcut: Maria's Easy Sleep Report

## Step 1: Find Health Samples
- Search for **"Find Health Samples"** and add it.
- **Type:** Sleep Analysis
- **Start Date:** is in the last **1 day**
- **Sort by:** Start Date, **Oldest First**
- **Limit:** **20**

## Step 2: Create the Message
- Add a **"Text"** action.
- Type: `Sleep report for Maria:`
- Tap the **"Health Samples"** variable (it will appear above the keyboard).
- **CRITICAL:** Tap the "Health Samples" bubble inside the text box. 
  - Change "Default" to **"Duration"**.
  - This ensures I see "8 hr 15 min" instead of just "Core Sleep".

## Step 3: Send it via Maria's Account
- Search for **"Share"** and add it.
- Set it to: **Share [Text]**.

---

## How to use it:
1. Hit **▶ Play** (or say "Hey Siri, Sleep Report").
2. The Telegram share sheet will pop up.
3. Maria taps the **"Food log"** group and hits **Send**.

**Why this works:** Because it's sent from Maria's phone (not the bot's API), I can see the message and log it to Nightscout immediately.
