#!/usr/bin/env python3
"""
Deep email harvester that:
1. Uses DuckDuckGo (via duckduckgo-search) to gather SERP URLs for a list of queries.
2. Crawls each result plus obvious contact/about pages on the same host.
3. Extracts aviation-related emails with configurable domain filters.

Outputs a deduped CSV ready for `npm run update:emails`.
"""

from __future__ import annotations

import argparse
import csv
import random
import re
from collections import deque
from pathlib import Path
from typing import Iterable, List, Sequence, Set
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS

WORKDIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUTPUT = WORKDIR / "output" / "extract-emails" / "deep-harvest.csv"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
]

GENERIC_PROVIDERS = {
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "mail.ru",
    "yandex.ru",
    "ya.ru",
    "bk.ru",
    "inbox.ru",
}

DISALLOWED_TLDS = {"png", "gif", "jpg", "jpeg", "svg", "webp"}
CONTACT_KEYWORDS = ("contact", "kontakt", "about", "company", "support", "team", "contacts", "kontakt")


def random_user_agent() -> str:
    return random.choice(USER_AGENTS)


def fetch(session: requests.Session, url: str) -> str:
    try:
        resp = session.get(url, timeout=15)
        if resp.ok:
            return resp.text
    except requests.RequestException:
        return ""
    return ""


def extract_emails(text: str) -> Set[str]:
    if not text:
        return set()
    return {email.strip().lower() for email in EMAIL_RE.findall(text or "")}


def same_host(base: str, candidate: str) -> bool:
    try:
        host = urlparse(base).hostname or ""
        cand = urlparse(candidate).hostname or ""
    except ValueError:
        return False
    return cand.endswith(host.split(":", 1)[0])


def discover_related(base_url: str, html: str, limit: int = 4) -> Set[str]:
    soup = BeautifulSoup(html, "html.parser")
    related: Set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href or href.startswith(("mailto:", "javascript:", "#")):
            continue
        dest = urljoin(base_url, href)
        if not same_host(base_url, dest):
            continue
        if any(keyword in href.lower() for keyword in CONTACT_KEYWORDS):
            related.add(dest)
        if len(related) >= limit:
            break
    return related


def harvest_emails(session: requests.Session, url: str, max_pages: int) -> Set[str]:
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
        if len(visited) == 1:
            queue.extend(link for link in discover_related(current, html) if link not in visited)

    return collected


def filter_email(email: str, required: Sequence[str], exclude: Sequence[str]) -> bool:
    domain = email.split("@", 1)[-1].lower()
    if domain in GENERIC_PROVIDERS:
        return False
    if "." not in domain:
        return False
    tld = domain.rsplit(".", 1)[-1]
    if tld in DISALLOWED_TLDS:
        return False
    if any(substr in email for substr in exclude):
        return False
    if required:
        if not any(token in domain for token in required):
            return False
    return True


def collect_queries(path: Path | None, inline: Sequence[str]) -> List[str]:
    queries: List[str] = list(inline)
    if path and path.exists():
        queries.extend(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        )
    return sorted(set(queries))


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deep email harvester over DuckDuckGo SERPs.")
    parser.add_argument("--queries", nargs="*", default=[], help="Inline queries to run.")
    parser.add_argument("--queries-file", help="Optional text file with one query per line.")
    parser.add_argument("--region", default="wt-wt", help="DuckDuckGo region code (e.g., ru-ru, ae-en).")
    parser.add_argument("--limit", type=int, default=60, help="Max search results per query (default: %(default)s).")
    parser.add_argument("--max-pages", type=int, default=6, help="Max pages per domain to crawl (default: %(default)s).")
    parser.add_argument(
        "--require",
        nargs="*",
        default=[],
        help="Domain substrings that must appear in the email domain (e.g., .ru, aero, avia).",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=["wixpress.com", "sentry.io", "mysite.com", "hubspot.com", "mailchimp.com", "zohomail.com"],
        help="Email/domain substrings to exclude.",
    )
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="CSV output path (default: %(default)s).")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    queries = collect_queries(Path(args.queries_file) if args.queries_file else None, args.queries)
    if not queries:
        print("No queries supplied.")
        return 1

    session = requests.Session()
    session.headers.update({"User-Agent": random_user_agent()})

    seen_urls: Set[str] = set()
    seen_emails: Set[str] = set()
    rows: List[dict] = []

    with DDGS() as ddgs:
        for query in queries:
            results = ddgs.text(query, region=args.region, safesearch="off", max_results=max(args.limit, 1))
            for item in results:
                url = item.get("href") or item.get("url")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                emails = harvest_emails(session, url, max_pages=max(args.max_pages, 1))
                filtered = {
                    email
                    for email in emails
                    if filter_email(email, args.require, args.exclude)
                }
                for email in sorted(filtered):
                    if email in seen_emails:
                        continue
                    rows.append(
                        {
                            "Query": query,
                            "Title": item.get("title") or "",
                            "Email": email,
                            "SourceURL": url,
                        }
                    )
                    seen_emails.add(email)

    if not rows:
        print("No emails discovered.")
        return 0

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Query", "Title", "Email", "SourceURL"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Captured {len(rows)} unique emails from {len(seen_urls)} SERP URLs.")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())


