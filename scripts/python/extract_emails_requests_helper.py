from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import httpx
from selectolax.parser import HTMLParser

@dataclass
class ExtractedEmail:
    email: str
    page_url: str
    website: str


EMAIL_SELECTOR = "a[href^='mailto:']"


def fetch_html(url: str, *, timeout: float = 20.0) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.text


def extract_emails_from_html(html: str, page_url: str) -> list[str]:
    tree = HTMLParser(html)
    emails: list[str] = []
    seen = set()
    for node in tree.css(EMAIL_SELECTOR):
        href = node.attributes.get("href", "")
        if href.lower().startswith("mailto:"):
            email = href[len("mailto:"):].strip()
            if email and email not in seen:
                emails.append(email)
                seen.add(email)
    return emails


def extract_emails(url: str) -> list[ExtractedEmail]:
    html = fetch_html(url)
    emails = extract_emails_from_html(html, url)
    if not emails:
        return []
    website = url.split("/", 3)[2]
    return [ExtractedEmail(email=email, page_url=url, website=website) for email in emails]


def save_as_csv(records: Iterable[ExtractedEmail], output_path: str) -> None:
    import csv
    with open(output_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["website", "page", "email"])
        writer.writeheader()
        for record in records:
            writer.writerow({
                "website": record.website,
                "page": record.page_url,
                "email": record.email,
            })


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Simple requests-based email extractor")
    parser.add_argument("--url", required=True, help="Target URL")
    parser.add_argument("--output", required=True, help="CSV output file")
    args = parser.parse_args()

    records = extract_emails(args.url)
    if not records:
        print("No emails found.")
        return

    output = args.output
    import os
    os.makedirs(os.path.dirname(output), exist_ok=True)
    save_as_csv(records, output)
    print(f"Extracted {len(records)} email(s) -> {output}")


if __name__ == "__main__":
    main()
