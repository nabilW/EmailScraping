#!/usr/bin/env python3
"""
Process `output/google-search-results.json` and extract emails from each result.

For every SERP entry we fetch the main URL, look for obvious contact/about links on
the same domain, crawl those pages (bounded), and extract email addresses. Results
are written to `output/extract-emails/google-search-sweep.csv` by default.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
from collections import deque
from pathlib import Path
from typing import Iterable, Set
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

WORKDIR = Path(__file__).resolve().parent.parent.parent
RESULTS_JSON = WORKDIR / "output" / "google-search-results.json"
DEFAULT_OUTPUT = WORKDIR / "output" / "extract-emails" / "google-search-sweep.csv"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
DISALLOWED_TLDS = {"png", "gif", "jpg", "jpeg", "svg", "webp"}
GENERIC_PROVIDERS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "mail.ru", "sportmail.ru"}
REQUIRED_KEYWORDS = (
    "air",
    "avia",
    "aero",
    "jet",
    "flight",
    "charter",
    "utg",
    "bizav",
)
SAME_SITE_PATTERNS = ("contact", "about", "team", "company", "support")
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
]


def random_user_agent() -> str:
    return random.choice(USER_AGENTS)


def normalise_email(email: str) -> str:
    return email.strip().lower()


def extract_emails(text: str) -> Set[str]:
    if not text:
        return set()
    candidates = {normalise_email(email) for email in EMAIL_RE.findall(text)}
    filtered: Set[str] = set()
    for email in candidates:
        if email.startswith(("flags@", "fancybox_", "sprite@", "loading@")):
            continue
        domain = email.split("@", 1)[-1]
        if "example.com" in domain:
            continue
        if domain in GENERIC_PROVIDERS:
            continue
        if "." not in domain:
            continue
        tld = domain.rsplit(".", 1)[-1].lower()
        if tld in DISALLOWED_TLDS:
            continue
        lowered_domain = domain.lower()
        if not any(keyword in lowered_domain for keyword in REQUIRED_KEYWORDS):
            continue
        filtered.add(email)
    return filtered


def same_host(url: str, candidate: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
        cand = urlparse(candidate).hostname or ""
    except ValueError:
        return False
    return cand.endswith(host.split(":", 1)[0])


def discover_related_urls(base_url: str, html: str, limit: int = 3) -> Set[str]:
    soup = BeautifulSoup(html, "html.parser")
    related: Set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href or href.startswith(("mailto:", "javascript:", "#")):
            continue
        resolved = urljoin(base_url, href)
        if not same_host(base_url, resolved):
            continue
        lower_href = href.lower()
        if any(pattern in lower_href for pattern in SAME_SITE_PATTERNS):
            related.add(resolved)
        if len(related) >= limit:
            break
    return related


def fetch(session: requests.Session, url: str) -> str:
    try:
        response = session.get(url, timeout=15)
        if response.ok:
            return response.text
    except requests.RequestException:
        return ""
    return ""


def process_entry(session: requests.Session, url: str, max_pages: int = 4) -> Set[str]:
    visited: Set[str] = set()
    queue: deque[str] = deque([url])
    collected: Set[str] = set()

    while queue and len(visited) < max_pages:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)

        html = fetch(session, current)
        if not html:
            continue
        collected.update(extract_emails(html))

        if len(visited) == 1:  # first page: discover contact-like subpages
            queue.extend([link for link in discover_related_urls(current, html) if link not in visited])

    return collected


def write_csv(output_path: Path, rows: Iterable[dict]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Query", "Title", "Email", "SourceURL"])
        writer.writeheader()
        writer.writerows(rows)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process SERP results and extract emails.")
    parser.add_argument("--results", default=RESULTS_JSON, help="Path to google-search-results.json (default: %(default)s)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="CSV output path (default: %(default)s)")
    parser.add_argument("--max-pages", type=int, default=4, help="Maximum pages to fetch per domain (default: %(default)s)")
    parser.add_argument("--exclude", nargs="*", default=["wixpress.com", "sentry.io", "mysite.com"], help="Domain substrings to exclude")
    parser.add_argument(
        "--require",
        nargs="*",
        default=[],
        help="Only keep emails whose domain contains at least one of these substrings",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    results_path = Path(args.results)
    if not results_path.exists():
        print(f"Results file not found: {results_path}", file=sys.stderr)
        return 1

    items = json.loads(results_path.read_text(encoding="utf-8"))
    session = requests.Session()
    session.headers.update({"User-Agent": random_user_agent()})

    seen_emails: Set[str] = set()
    rows: list[dict] = []

    for item in items:
        url = item.get("url")
        if not url or not url.startswith("http"):
            continue
        emails = process_entry(session, url, max_pages=max(args.max_pages, 1))
        filtered = set()
        for email in emails:
            if any(substr in email for substr in args.exclude):
                continue
            domain = email.split("@", 1)[-1]
            if args.require:
                lowered = domain.lower()
                if not any(token in lowered for token in args.require):
                    continue
            filtered.add(email)
        for email in sorted(filtered):
            if email in seen_emails:
                continue
            rows.append(
                {
                    "Query": item.get("query", ""),
                    "Title": item.get("title", ""),
                    "Email": email,
                    "SourceURL": url,
                }
            )
            seen_emails.add(email)

    if not rows:
        print("No emails discovered from search results.")
        return 0

    write_csv(Path(args.output), rows)
    print(f"Captured {len(rows)} unique emails from SERP URLs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())


