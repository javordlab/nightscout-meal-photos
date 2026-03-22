import os
from agentmail import AgentMail

api_key = "am_us_d4d50ffa237b2be53527e7640001125ca646925c21a1054647b5eeddb04a475e"
client = AgentMail(api_key=api_key)

inboxes = client.inboxes.list()
for inbox in inboxes.inboxes:
    print(f"Inbox: {inbox.inbox_id} ({inbox.display_name})")
