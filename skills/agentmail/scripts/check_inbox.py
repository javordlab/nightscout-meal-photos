#!/usr/bin/env python3
"""
Check AgentMail inbox for messages

Usage:
    # List recent messages
    python check_inbox.py --inbox "myagent@agentmail.to"
    
    # Get specific message
    python check_inbox.py --inbox "myagent@agentmail.to" --message "msg_123abc"
    
    # List threads
    python check_inbox.py --inbox "myagent@agentmail.to" --threads
    
    # Monitor for new messages (poll every N seconds)
    python check_inbox.py --inbox "myagent@agentmail.to" --monitor 30

Environment:
    AGENTMAIL_API_KEY: Your AgentMail API key
"""

import argparse
import os
import sys
import time
from datetime import datetime
import re

try:
    from agentmail import AgentMail
except ImportError:
    print("Error: agentmail package not found. Install with: pip install agentmail")
    sys.exit(1)

def to_dict(obj):
    if hasattr(obj, 'dict'):
        return obj.dict()
    if hasattr(obj, 'model_dump'):
        return obj.model_dump()
    return obj

def format_timestamp(ts):
    """Format timestamp for display"""
    if not ts:
        return 'Unknown'
    if isinstance(ts, datetime):
        return ts.strftime('%Y-%m-%d %H:%M:%S')
    try:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        return str(ts)

def parse_address(addr_str):
    """Parse address string like 'Name <email@domain.com>' or 'email@domain.com'"""
    if not isinstance(addr_str, str):
        return addr_str
    
    match = re.match(r'^(.*?) <(.*?)>$', addr_str)
    if match:
        return {'name': match.group(1).strip(), 'email': match.group(2).strip()}
    return {'name': '', 'email': addr_str.strip()}

def get_addr_display(addr_data):
    """Get display string for an address"""
    if isinstance(addr_data, str):
        return addr_data
    
    name = addr_data.get('name', '')
    email = addr_data.get('email', 'Unknown')
    return f"{name} <{email}>" if name else email

def print_message_summary(message_obj):
    """Print a summary of a message"""
    message = to_dict(message_obj)
    
    from_data = message.get('from')
    if isinstance(from_data, list) and from_data:
        from_display = get_addr_display(from_data[0])
    elif isinstance(from_data, str):
        from_display = from_data
    else:
        from_display = 'Unknown'
    
    subject = message.get('subject', '(no subject)')
    timestamp = format_timestamp(message.get('timestamp', ''))
    preview = message.get('preview', message.get('text', '')) or ''
    preview = preview[:100].replace('\n', ' ')
    
    print(f"📧 {message.get('message_id', 'N/A')}")
    print(f"   From: {from_display}")
    print(f"   Subject: {subject}")
    print(f"   Time: {timestamp}")
    if preview:
        print(f"   Preview: {preview}{'...' if len(preview) == 100 else ''}")
    print()

def print_thread_summary(thread_obj):
    """Print a summary of a thread"""
    thread = to_dict(thread_obj)
    
    subject = thread.get('subject', '(no subject)')
    participants = ', '.join(thread.get('participants', []))
    count = thread.get('message_count', 0)
    timestamp = format_timestamp(thread.get('last_message_at', ''))
    
    print(f"🧵 {thread.get('thread_id', 'N/A')}")
    print(f"   Subject: {subject}")
    print(f"   Participants: {participants}")
    print(f"   Messages: {count}")
    print(f"   Last: {timestamp}")
    print()

def main():
    parser = argparse.ArgumentParser(description='Check AgentMail inbox')
    parser.add_argument('--inbox', required=True, help='Inbox email address')
    parser.add_argument('--message', help='Get specific message by ID')
    parser.add_argument('--threads', action='store_true', help='List threads instead of messages')
    parser.add_argument('--monitor', type=int, metavar='SECONDS', help='Monitor for new messages (poll interval)')
    parser.add_argument('--limit', type=int, default=10, help='Number of items to fetch (default: 10)')
    
    args = parser.parse_args()
    
    # Get API key
    api_key = os.getenv('AGENTMAIL_API_KEY')
    if not api_key:
        print("Error: AGENTMAIL_API_KEY environment variable not set")
        sys.exit(1)
    
    # Initialize client
    client = AgentMail(api_key=api_key)
    
    if args.monitor:
        print(f"🔍 Monitoring {args.inbox} (checking every {args.monitor} seconds)")
        print("Press Ctrl+C to stop\n")
        
        last_message_ids = set()
        
        try:
            while True:
                try:
                    messages = client.inboxes.messages.list(
                        inbox_id=args.inbox,
                        limit=args.limit
                    )
                    
                    new_messages = []
                    current_message_ids = set()
                    
                    for message_obj in messages.messages:
                        message = to_dict(message_obj)
                        msg_id = message.get('message_id')
                        current_message_ids.add(msg_id)
                        
                        if msg_id not in last_message_ids:
                            new_messages.append(message_obj)
                    
                    if new_messages:
                        print(f"🆕 Found {len(new_messages)} new message(s):")
                        for message_obj in new_messages:
                            print_message_summary(message_obj)
                    
                    last_message_ids = current_message_ids
                    
                except Exception as e:
                    print(f"❌ Error checking inbox: {e}")
                
                time.sleep(args.monitor)
                
        except KeyboardInterrupt:
            print("\n👋 Monitoring stopped")
            return
    
    elif args.message:
        # Get specific message
        try:
            message_obj = client.inboxes.messages.get(
                inbox_id=args.inbox,
                message_id=args.message
            )
            message = to_dict(message_obj)
            
            print(f"📧 Message Details:")
            print(f"   ID: {message.get('message_id')}")
            print(f"   Thread: {message.get('thread_id')}")
            
            from_data = message.get('from')
            if isinstance(from_data, list) and from_data:
                from_display = get_addr_display(from_data[0])
            elif isinstance(from_data, str):
                from_display = from_data
            else:
                from_display = 'Unknown'
            print(f"   From: {from_display}")
            
            to_list = message.get('to', [])
            to_displays = [get_addr_display(addr) for addr in to_list]
            print(f"   To: {', '.join(to_displays)}")
            
            print(f"   Subject: {message.get('subject', '(no subject)')}")
            print(f"   Time: {format_timestamp(message.get('timestamp', ''))}")
            
            if message.get('labels'):
                print(f"   Labels: {', '.join(message.get('labels'))}")
            
            print("\n📝 Content:")
            if message.get('text'):
                print(message['text'])
            elif message.get('html'):
                print("(HTML content - use API to get full HTML)")
            else:
                print("(No text content)")
            
            if message.get('attachments'):
                print(f"\n📎 Attachments ({len(message['attachments'])}):")
                for att_obj in message['attachments']:
                    att = to_dict(att_obj)
                    print(f"   • {att.get('filename', 'unnamed')} ({att.get('content_type', 'unknown type')})")
            
        except Exception as e:
            print(f"❌ Error getting message: {e}")
            sys.exit(1)
    
    elif args.threads:
        # List threads
        try:
            threads = client.inboxes.threads.list(
                inbox_id=args.inbox,
                limit=args.limit
            )
            
            if not threads.threads:
                print(f"📭 No threads found in {args.inbox}")
                return
            
            print(f"🧵 Threads in {args.inbox} (showing {len(threads.threads)}):\n")
            for thread_obj in threads.threads:
                print_thread_summary(thread_obj)
                
        except Exception as e:
            print(f"❌ Error listing threads: {e}")
            sys.exit(1)
    
    else:
        # List recent messages
        try:
            messages = client.inboxes.messages.list(
                inbox_id=args.inbox,
                limit=args.limit
            )
            
            if not messages.messages:
                print(f"📭 No messages found in {args.inbox}")
                return
            
            print(f"📧 Messages in {args.inbox} (showing {len(messages.messages)}):\n")
            for message_obj in messages.messages:
                print_message_summary(message_obj)
                
        except Exception as e:
            print(f"❌ Error listing messages: {e}")
            sys.exit(1)

if __name__ == '__main__':
    main()