#!/usr/bin/env python3
"""
Verify emails.txt file integrity and count
"""

import re
from pathlib import Path

WORKDIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_FILE = WORKDIR / "output" / "emails.txt"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

def verify():
    """Verify emails.txt file"""
    print("=" * 60)
    print("VERIFYING emails.txt FILE")
    print("=" * 60)
    
    if not OUTPUT_FILE.exists():
        print(f"❌ File {OUTPUT_FILE} does not exist!")
        return
    
    # Count lines
    line_count = 0
    with OUTPUT_FILE.open("r", encoding="utf-8") as f:
        for _ in f:
            line_count += 1
    
    # Count valid emails
    valid_emails = set()
    invalid_lines = []
    
    with OUTPUT_FILE.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            email_match = EMAIL_RE.search(line)
            if email_match:
                email = email_match.group(0).lower().strip()
                if "@" in email:
                    parts = email.split("@")
                    if len(parts) == 2 and "." in parts[1]:
                        valid_emails.add(email)
                    else:
                        invalid_lines.append((line_num, line))
            else:
                invalid_lines.append((line_num, line))
    
    print(f"\nFile: {OUTPUT_FILE}")
    print(f"Total lines: {line_count}")
    print(f"Valid unique emails: {len(valid_emails)}")
    print(f"Invalid/malformed lines: {len(invalid_lines)}")
    
    if invalid_lines:
        print(f"\n⚠️  Found {len(invalid_lines)} invalid lines (showing first 10):")
        for line_num, line in invalid_lines[:10]:
            print(f"  Line {line_num}: {line[:80]}")
    
    print(f"\n✓ File verification complete!")
    print(f"  Unique emails: {len(valid_emails)}")

if __name__ == "__main__":
    verify()

