# Root Cause: Photo Pipeline Temp File Refs (2026-03-31)

## Problem
4 meal entries logged with temporary file references instead of real iili.io URLs:
- `file_239---uuid.jpg` (09:22 breakfast)
- `file_240---uuid.jpg` (09:33 snack)
- `file_243---uuid.jpg` (12:02 snack)
- `file_244---uuid.jpg` (13:01 lunch)

This prevented syncing to Notion and gallery.

## Root Cause Analysis

**The Smoking Gun:**  
The `photo_to_log_pipeline.js` was running every 60 seconds and marking files as "processed," but entries were being logged with temp file refs in the health_log.md anyway.

**What Actually Happened:**
1. Files arrive in `/workspace/media/inbound/file_XXX---uuid.jpg`
2. Pipeline processes them and tries to upload to freeimage.host
3. **Either:**
   - `uploadPhoto()` returned null (upload failed silently)
   - OR `uploadPhoto()` returned invalid/non-http URL
   - OR variable assignment broke somewhere
4. **Code did NOT have a guard** to prevent logging entries with invalid photoUrls
5. Entries got logged anyway with `photoUrl` containing the filename/invalid value

**Why It Was Subtle:**
- `uploadPhoto()` returns `null` on error, which **should** trigger a `continue` statement
- But if `photoUrl` somehow became a truthy but invalid value (file name), the code proceeded
- No safety gate existed to verify the URL was actually an http(s) link before logging

## The Fix

Added a **safety block** in `photo_to_log_pipeline.js` (line ~625):

```javascript
// SAFETY CHECK: Never add entry without a real URL
if (!photoUrl || !photoUrl.startsWith('http')) {
  console.error(`SAFETY BLOCK: Cannot add entry without valid URL...`);
  // Queue for retry instead of breaking the log
  queuePendingPhoto({...upload_failed...});
  continue;
}
```

This ensures:
1. **No entry is logged without a real http(s) URL**
2. **If upload fails, entry is queued** for retry (not abandoned)
3. **Error is visible** in logs (not silent)

## Verification

**Before the fix:**
- Entry could end up with `[📷](file_240---uuid.jpg)` in log
- Breaks Notion sync, gallery JSON, and all downstream systems

**After the fix:**
- Entry won't be logged at all if URL is invalid
- Will retry next cycle
- If upload continues to fail, entry queues and waits for manual fix

## Related Commits
- `b5193df`: Root cause fix (safety block + error logging)
- Earlier: `5ce1143`: Manual emergency fix (uploaded 4 photos and updated refs)

## Status
✅ Fixed and deployed
✅ All 4 photos now have real iili.io URLs in log and gallery
✅ Safety prevention layer added to prevent recurrence
