# Siri Shortcut: Auto Sleep Report (Simple 2-Step Version)

## What This Does
Reads last night's sleep data from Apple Watch and sends it to the Telegram "Food log" group. Javordclaws handles all the parsing and pushes it to Nightscout.

---

## Before You Start (One-Time Setup)

1. **On Maria's iPhone**, open **Settings** → **Health** → **Data Access & Devices** → **Shortcuts** → Enable **Sleep**
2. Verify sleep data exists: Open **Health** app → **Browse** tab → **Sleep** → confirm there's recent data

---

## Building the Shortcut

### Open Shortcuts App
1. Open the **Shortcuts** app on Maria's iPhone
2. Tap the **+** button (top right) to create a new Shortcut
3. Tap the name at the top and rename it to **"Sleep Report"**

---

### Action 1: Find Health Samples

1. Tap **"Add Action"**
2. In the search bar, type **"Find Health Samples"**
3. Tap **"Find Health Samples"** to add it
4. Configure it:
   - Tap **"Type"** → scroll down or search → select **"Sleep Analysis"**
   - Tap **"Add Filter"** → choose **"Start Date"**
   - Set the filter to **"is in the last"** → **"1"** → **"days"**
   - Tap **"Sort by"** → select **"Start Date"**
   - Set order to **"Oldest First"**
   - Tap **"Limit"** → toggle it ON → set to **"20"**

You should now see something like:
> Find Health Samples where **Type** is **Sleep Analysis** and **Start Date** is in the last **1 day**, sorted by **Start Date Oldest First**, Limit **20**

---

### Action 2: Get Contents of URL

1. Tap the **+** below Action 1 to add another action
2. Search for **"Get Contents of URL"**
3. Tap it to add it
4. Configure it:

   **URL field:**
   - Paste this exact URL:
   ```
   https://api.telegram.org/bot8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0/sendMessage
   ```

   **Method:**
   - Tap **"Method"** → select **"POST"**

   **Request Body:**
   - Tap **"Request Body"** → select **"JSON"**
   - Tap **"Add new field"** → choose **"Text"**
     - Key: **chat_id**
     - Value: **-5262020908**
   - Tap **"Add new field"** → choose **"Text"**
     - Key: **text**
     - Value: Tap the value field, then:
       1. Type: **Sleep report from Apple Watch:\n**
       2. Tap the **"Health Samples"** variable that appears above the keyboard (it's a magic variable from Action 1)
       3. This inserts the sleep data automatically

The action should look like:
> Get contents of URL `https://api.telegram.org/bot.../sendMessage`
> Method: **POST**
> Request Body: **JSON**
> - chat_id: -5262020908
> - text: Sleep report from Apple Watch: [Health Samples]

---

### That's It! Save and Test

1. Tap **"Done"** (top right) to save
2. Tap the **▶ Play** button to test it
3. Check the Telegram "Food log" group — you should see a message from @Javordclaws_bot with the sleep data
4. If prompted for Health permissions, tap **"Allow"**

---

## Set Up Automation (Hands-Free)

So it runs automatically every morning:

1. Open **Shortcuts** app → tap **"Automation"** tab (bottom)
2. Tap **"+"** (top right)
3. Choose one of these triggers:

   **Option A — Time-based (most reliable):**
   - Tap **"Time of Day"**
   - Set to **9:00 AM** (or whenever Maria usually wakes up)
   - Set to **Daily**
   - Tap **"Next"**

   **Option B — Alarm-based:**
   - Tap **"Alarm"**
   - Select **"Is Stopped"**
   - Choose the specific alarm or **"Any Alarm"**
   - Tap **"Next"**

4. Select the **"Sleep Report"** shortcut
5. **IMPORTANT:** Toggle OFF **"Ask Before Running"** so it runs without confirmation
6. Tap **"Done"**

---

## Verify It Works

After the first automated run (or manual test):
1. Check the **Telegram group** — the sleep data message should appear
2. Check the **Nightscout chart** — a sleep note icon should appear
3. If either is missing, tell Javi and we'll debug

---

## Sample Output

What the message will look like in Telegram:
```
Sleep report from Apple Watch:
Core Sleep 11:42 PM – 1:15 AM (1 hr 33 min)
Deep Sleep 1:15 AM – 2:00 AM (45 min)
REM Sleep 2:00 AM – 2:45 AM (45 min)
Core Sleep 2:45 AM – 5:30 AM (2 hr 45 min)
Awake 5:30 AM – 5:35 AM (5 min)
Deep Sleep 5:35 AM – 6:20 AM (45 min)
REM Sleep 6:20 AM – 7:00 AM (40 min)
```

Javordclaws will automatically:
- Calculate total sleep time, deep/REM/core breakdown
- Push summary to Nightscout
- Factor sleep quality into the daily health brief
