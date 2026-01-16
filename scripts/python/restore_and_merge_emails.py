#!/usr/bin/env python3
"""
Restore and merge emails from backup files
"""

import re
from pathlib import Path

WORKDIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_FILE = WORKDIR / "output" / "emails.txt"
BACKUP_FILE = WORKDIR / "output" / "emails_backup_before_dedup_1763107304.txt"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

def extract_emails_from_file(file_path: Path) -> set:
    """Extract all valid emails from a file"""
    emails = set()
    if not file_path.exists():
        return emails
    
    print(f"Reading {file_path}...")
    with file_path.open("r", encoding="utf-8") as f:
        for line in f:
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
    
    return emails

def restore_and_merge():
    """Restore emails from backup and merge with current file"""
    print("=" * 60)
    print("RESTORING AND MERGING EMAILS")
    print("=" * 60)
    
    # Read current emails.txt
    current_emails = extract_emails_from_file(OUTPUT_FILE)
    print(f"Current emails.txt: {len(current_emails)} emails")
    
    # Read backup file
    backup_emails = extract_emails_from_file(BACKUP_FILE)
    print(f"Backup file: {len(backup_emails)} emails")
    
    # Merge all emails
    all_emails = current_emails | backup_emails
    print(f"\nMerged total: {len(all_emails)} unique emails")
    print(f"  Current: {len(current_emails)}")
    print(f"  Backup: {len(backup_emails)}")
    print(f"  New from backup: {len(backup_emails - current_emails)}")
    
    # Create a new backup before writing
    import time
    new_backup = OUTPUT_FILE.parent / f"emails_backup_before_restore_{int(time.time())}.txt"
    if OUTPUT_FILE.exists():
        print(f"\nCreating backup of current file: {new_backup}")
        OUTPUT_FILE.rename(new_backup)
    
    # Write merged emails
    print(f"\nWriting {len(all_emails)} unique emails to {OUTPUT_FILE}...")
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        for email in sorted(all_emails):
            f.write(f"{email}\n")
    
    print(f"\n✓ Restore complete!")
    print(f"  Total unique emails: {len(all_emails)}")
    print(f"  Restored {len(backup_emails - current_emails)} missing emails")

if __name__ == "__main__":
    restore_and_merge()

