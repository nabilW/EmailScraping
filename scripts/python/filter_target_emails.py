#!/usr/bin/env python3
"""
Filter emails to only include ops@, sales@, info@ and remove duplicates
"""

import re
import os
from typing import Set, List

# Regex to extract email addresses
EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

# Target email prefixes
TARGET_PREFIXES = ['ops@', 'sales@', 'info@']

def extract_emails_from_line(line: str) -> List[str]:
    """Extract all email addresses from a line"""
    emails = EMAIL_RE.findall(line)
    return emails

def is_target_email(email: str) -> bool:
    """Check if email contains any of the target prefixes"""
    email_lower = email.lower()
    return any(email_lower.startswith(prefix) for prefix in TARGET_PREFIXES)

def filter_and_deduplicate_emails(input_file: str, output_file: str):
    """Filter emails to only include ops@, sales@, info@ and remove duplicates"""
    seen_emails: Set[str] = set()
    filtered_emails: List[str] = []
    
    print(f"Reading emails from {input_file}...")
    
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found!")
        return
    
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            # Extract all emails from the line
            emails = extract_emails_from_line(line)
            
            for email in emails:
                email_lower = email.lower()
                
                # Check if it's a target email (ops@, sales@, info@)
                if is_target_email(email_lower):
                    # Add to set for deduplication (using lowercase)
                    if email_lower not in seen_emails:
                        seen_emails.add(email_lower)
                        # Store original case version
                        filtered_emails.append(email)
            
            if line_num % 1000 == 0:
                print(f"Processed {line_num} lines, found {len(filtered_emails)} unique target emails so far...")
    
    print(f"\nTotal unique target emails found: {len(filtered_emails)}")
    
    # Sort emails for better organization
    filtered_emails.sort(key=str.lower)
    
    # Write to output file
    print(f"Writing filtered emails to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for email in filtered_emails:
            f.write(f"{email}\n")
    
    print(f"Done! Wrote {len(filtered_emails)} unique emails to {output_file}")

if __name__ == "__main__":
    input_file = "output/emails.txt"
    output_file = "output/emails.txt"
    
    # Create backup first
    backup_file = f"output/emails_backup_before_filter_{int(__import__('time').time())}.txt"
    if os.path.exists(input_file):
        print(f"Creating backup: {backup_file}")
        with open(input_file, 'r', encoding='utf-8', errors='ignore') as src:
            with open(backup_file, 'w', encoding='utf-8') as dst:
                dst.write(src.read())
        print(f"Backup created successfully")
    
    filter_and_deduplicate_emails(input_file, output_file)

