#!/usr/bin/env python3
"""
Remove duplicates from emails.txt file
"""

import re
from pathlib import Path

WORKDIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_FILE = WORKDIR / "output" / "emails.txt"
BACKUP_FILE = WORKDIR / "output" / f"emails_backup_before_dedup_{int(__import__('time').time())}.txt"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

def clean_and_deduplicate():
    """Remove duplicates and clean emails"""
    if not OUTPUT_FILE.exists():
        print(f"File {OUTPUT_FILE} does not exist!")
        return
    
    # Read all emails
    emails = set()
    lines_read = 0
    
    print(f"Reading {OUTPUT_FILE}...")
    with OUTPUT_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            lines_read += 1
            line = line.strip()
            if not line:
                continue
            
            # Extract email using regex
            email_match = EMAIL_RE.search(line)
            if email_match:
                email = email_match.group(0).lower().strip()
                # Validate email format
                if "@" in email:
                    parts = email.split("@")
                    if len(parts) == 2 and "." in parts[1]:
                        emails.add(email)
    
    print(f"Read {lines_read} lines")
    print(f"Found {len(emails)} unique emails")
    
    # Create backup
    print(f"Creating backup: {BACKUP_FILE}")
    OUTPUT_FILE.rename(BACKUP_FILE)
    
    # Write deduplicated emails
    print(f"Writing {len(emails)} unique emails to {OUTPUT_FILE}...")
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        for email in sorted(emails):
            f.write(f"{email}\n")
    
    print(f"✓ Deduplication complete!")
    print(f"  Original: {lines_read} lines")
    print(f"  Unique: {len(emails)} emails")
    print(f"  Removed: {lines_read - len(emails)} duplicates")
    print(f"  Backup saved: {BACKUP_FILE}")

if __name__ == "__main__":
    clean_and_deduplicate()

