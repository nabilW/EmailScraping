#!/usr/bin/env python3
"""Clean and consolidate emails from all sources"""

import re
from pathlib import Path

# Email regex - matches complete valid emails
EMAIL_RE = re.compile(r'\b([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,})\b')

def extract_clean_email(text):
    """Extract only the email part, stopping at first non-email character"""
    # Find all email matches with word boundaries
    matches = EMAIL_RE.findall(text)
    for email in matches:
        email = email.lower().strip()
        if '@' in email:
            local, domain = email.split('@', 1)
            # Clean local part - remove leading/trailing invalid chars
            local = local.strip('._-+')
            # Clean domain - take only valid domain part (stop at first non-email char)
            # Split domain and take only valid parts
            domain_parts = []
            for part in domain.split('.'):
                # Stop at first invalid character in domain part
                clean_part = re.sub(r'[^a-zA-Z0-9-]', '', part)
                if clean_part:
                    domain_parts.append(clean_part)
                else:
                    break
                # Stop after TLD (usually 2-3 parts max)
                if len(domain_parts) >= 3:
                    break
            
            if len(domain_parts) >= 2:
                clean_domain = '.'.join(domain_parts)
                # Final validation - must have valid TLD
                if len(clean_domain) >= 4 and len(domain_parts[-1]) >= 2:
                    clean_email = f"{local}@{clean_domain}"
                    # Validate structure
                    if len(local) >= 1 and '@' in clean_email:
                        # Check if email ends properly (no trailing invalid chars)
                        if re.match(r'^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$', clean_email):
                            return clean_email
    return None

# Collect all valid emails
all_emails = set()

# Read all files
files = [
    'output/emails.txt',
    'output/emails_backup_before_dedup_1763107304.txt',
    'output/emails_backup_before_restore_1763110449.txt',
    'output/emails_backup_before_restore_1763110248.txt',
    'output/emails_backup.txt'
]

print("Reading emails from all sources...")
for filepath in files:
    try:
        path = Path(filepath)
        if path.exists():
            with path.open('r', encoding='utf-8', errors='ignore') as f:
                count = 0
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    email = extract_clean_email(line)
                    if email:
                        all_emails.add(email)
                        count += 1
                print(f"  {filepath}: {count} emails extracted")
    except Exception as e:
        print(f"Error reading {filepath}: {e}")

# Filter out generic providers
GENERIC_PROVIDERS = {
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'mail.ru', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru'
}

valid_emails = set()
for email in all_emails:
    if '@' in email:
        local, domain = email.split('@', 1)
        domain_lower = domain.lower()
        # Skip generic providers
        if domain_lower not in GENERIC_PROVIDERS:
            # Must have valid structure
            if len(local) >= 1 and len(domain) >= 4:
                domain_parts = domain.split('.')
                if len(domain_parts) >= 2 and len(domain_parts[-1]) >= 2:
                    # Skip if email looks invalid
                    if not local.startswith(('.', '-')) and not local.endswith(('.', '-')):
                        valid_emails.add(email)

# Save cleaned emails
output_file = Path('output/emails.txt')
with output_file.open('w', encoding='utf-8') as f:
    for email in sorted(valid_emails):
        f.write(f"{email}\n")

print(f"\n✓ Cleaned and saved {len(valid_emails)} valid emails to output/emails.txt")
print(f"\nSample clean emails:")
for email in sorted(valid_emails)[:20]:
    print(f"  {email}")

