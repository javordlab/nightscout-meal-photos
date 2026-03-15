# 2026-03-14: Logging Protocol Expansion

- **Policy Update:** Per user instruction, the protocol for fetching and reporting current glucose levels has been expanded.
- **Requirement:** I must now fetch and include the latest Nightscout glucose value for **all** manual entries from Maria, specifically including **Medication** and **Activity/Exercise** logs, in addition to the existing Food/Snack requirement.
- **Implementation:** Updated `TOOLS.md` and `MEMORY.md` to reflect this universal requirement for all manual health log categories.
- **Reasoning:** To provide immediate context on how medications and activity correlate with glucose levels at the time of the event.
