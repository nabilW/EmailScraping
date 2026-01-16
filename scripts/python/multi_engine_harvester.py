#!/usr/bin/env python3
"""
Advanced multi-engine email harvester.

Combines Google, Bing, Yahoo, DuckDuckGo, and Yandex searches per country, then
scrapes the discovered URLs (including obvious contact/about pages) in parallel.
Filters for relevant signals (keywords, trusted local parts, and
regional TLDs) while ignoring social media and marketing platforms.

Designed to scale across countries and regions, or any
custom list supplied over the CLI.
"""

from __future__ import annotations

import argparse
import csv
import random
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable, List, Sequence, Set
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
SUPPORTED_ENGINES = {"google", "bing", "yahoo", "yandex", "duckduckgo"}

CONTACT_KEYWORDS = (
    "contact",
    "kontakt",
    "about",
    "team",
    "company",
    "support",
    "services",
    "locations",
    "branches",
    "offices",
    "directions",
)

SOCIAL_DOMAINS = {
    "facebook.com",
    "m.facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "tiktok.com",
    "wa.me",
    "api.whatsapp.com",
}

GENERIC_PROVIDERS = {
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "mail.ru",
    "yandex.ru",
    "ya.ru",
    "bk.ru",
    "inbox.ru",
}

EXCLUDED_DOMAINS = {
    "wixpress.com",
    "sentry.io",
    "mysite.com",
    "hubspot.com",
    "mailchimp.com",
    "zoho.com",
    "zohomail.com",
    "medium.com",
    "wordpress.com",
    "googleusercontent.com",
    "amazonaws.com",
}

AVIATION_KEYWORDS = {
    "air",
    "avia",
    "airline",
    "airlines",
    "airways",
    "airport",
    "aircraft",
    "jet",
    "jets",
    "charter",
    "charters",
    "flight",
    "flights",
    "aero",
    "ops",
    "heli",
    "helicopter",
    "cargo",
    "fleet",
    "crew",
    "dispatch",
    "ground",
    "hangar",
    "handling",
    "dnata",
    "emirates",
    "etihad",
    "flydubai",
    "jetex",
    "aeroflot",
    "rossiya",
}

TRUSTED_LOCAL_PARTS = {
    "info",
    "sales",
    "ops",
    "charter",
    "booking",
    "reservations",
    "dispatch",
    "support",
    "cargo",
    "handling",
}

REGIONAL_TLDS = {
    "ru",
    "su",
    "ae",
    "qa",
    "sa",
    "bh",
    "kw",
    "om",
    "aero",
    "za",
    "zm",
    "zw",
    "ng",
    "gh",
    "ke",
    "ug",
    "tz",
    "et",
    "er",
    "dj",
    "sd",
    "ss",
    "eg",
    "ly",
    "tn",
    "ma",
    "dz",
    "ao",
    "na",
    "bw",
    "mz",
    "mw",
    "mg",
    "ga",
    "cm",
    "cg",
    "cd",
    "cf",
    "td",
    "ne",
    "ml",
    "bf",
    "ci",
    "gn",
    "gw",
    "gm",
    "sl",
    "lr",
    "bj",
    "tg",
    "sn",
    "mr",
    "st",
    "gq",
    "cv",
    "sc",
    "mu",
    "km",
    "sz",
    "ls",
    "bi",
    "so",
}

COUNTRY_TLD_MAP = {
    "Angola": "ao",
    "Benin": "bj",
    "Botswana": "bw",
    "Burkina Faso": "bf",
    "Burundi": "bi",
    "Cabo Verde": "cv",
    "Cameroon": "cm",
    "Central African Republic": "cf",
    "Chad": "td",
    "Comoros": "km",
    "Côte d'Ivoire": "ci",
    "Democratic Republic of Congo": "cd",
    "Djibouti": "dj",
    "Egypt": "eg",
    "Equatorial Guinea": "gq",
    "Eritrea": "er",
    "Eswatini": "sz",
    "Ethiopia": "et",
    "Gabon": "ga",
    "Gambia": "gm",
    "Ghana": "gh",
    "Guinea": "gn",
    "Guinea-Bissau": "gw",
    "Kenya": "ke",
    "Lesotho": "ls",
    "Liberia": "lr",
    "Libya": "ly",
    "Madagascar": "mg",
    "Malawi": "mw",
    "Mali": "ml",
    "Mauritania": "mr",
    "Mauritius": "mu",
    "Mozambique": "mz",
    "Namibia": "na",
    "Niger": "ne",
    "Nigeria": "ng",
    "Republic of Congo": "cg",
    "Rwanda": "rw",
    "São Tomé and Príncipe": "st",
    "Senegal": "sn",
    "Seychelles": "sc",
    "Sierra Leone": "sl",
    "Somalia": "so",
    "South Africa": "za",
    "South Sudan": "ss",
    "Sudan": "sd",
    "Tanzania": "tz",
    "Togo": "tg",
    "Tunisia": "tn",
    "Uganda": "ug",
    "Zambia": "zm",
    "Zimbabwe": "zw",
    "Russia": "ru",
    "Russian Federation": "ru",
    "United Arab Emirates": "ae",
    "UAE": "ae",
    "Saudi Arabia": "sa",
    "Qatar": "qa",
    "Bahrain": "bh",
    "Oman": "om",
}

DEFAULT_AFRICAN_COUNTRIES = [
    "Angola",
    "Benin",
    "Botswana",
    "Burkina Faso",
    "Burundi",
    "Cabo Verde",
    "Cameroon",
    "Central African Republic",
    "Chad",
    "Comoros",
    "Côte d'Ivoire",
    "Democratic Republic of Congo",
    "Djibouti",
    "Egypt",
    "Equatorial Guinea",
    "Eritrea",
    "Eswatini",
    "Ethiopia",
    "Gabon",
    "Gambia",
    "Ghana",
    "Guinea",
    "Guinea-Bissau",
    "Kenya",
    "Lesotho",
    "Liberia",
    "Libya",
    "Madagascar",
    "Malawi",
    "Mali",
    "Mauritania",
    "Mauritius",
    "Mozambique",
    "Namibia",
    "Niger",
    "Nigeria",
    "Republic of Congo",
    "Rwanda",
    "São Tomé and Príncipe",
    "Senegal",
    "Seychelles",
    "Sierra Leone",
    "Somalia",
    "South Africa",
    "South Sudan",
    "Sudan",
    "Tanzania",
    "Togo",
    "Tunisia",
    "Uganda",
    "Zambia",
    "Zimbabwe",
]


def hostname_for(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host.lower()


class MultiEngineHarvester:
    def __init__(self, engines: Sequence[str], url_limit: int):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        retry = Retry(
            total=3,
            backoff_factor=0.6,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        self.engines = [engine for engine in engines if engine in SUPPORTED_ENGINES]
        if not self.engines:
            self.engines = ["google", "bing", "yahoo", "yandex"]
        self.url_limit = url_limit
        self.visited_urls: Set[str] = set()

    # ------------------------- Search Engine Helpers ------------------------- #
    def search_google(self, query: str) -> List[str]:
        results: List[str] = []
        try:
            url = f"https://www.google.com/search?q={quote_plus(query)}&num={self.url_limit}"
            resp = self.session.get(url, timeout=15)
            if resp.ok:
                soup = BeautifulSoup(resp.text, "html.parser")
                for link in soup.select("a[href]"):
                    href = link.get("href", "")
                    if href.startswith("/url?q="):
                        actual = href.split("/url?q=")[1].split("&")[0]
                        if actual.startswith("http"):
                            results.append(actual)
            time.sleep(random.uniform(1.5, 3.5))
        except Exception as exc:  # pylint: disable=broad-except
            print(f"  ! Google search failed: {exc}")
        return results[: self.url_limit]

    def search_bing(self, query: str) -> List[str]:
        results: List[str] = []
        try:
            url = f"https://www.bing.com/search?q={quote_plus(query)}&count={self.url_limit}"
            resp = self.session.get(url, timeout=15)
            if resp.ok:
                soup = BeautifulSoup(resp.text, "html.parser")
                for link in soup.select("a[href]"):
                    href = link.get("href", "")
                    if href.startswith("http") and "bing.com" not in href:
                        results.append(href)
            time.sleep(random.uniform(1.0, 2.0))
        except Exception as exc:
            print(f"  ! Bing search failed: {exc}")
        return results[: self.url_limit]

    def search_yahoo(self, query: str) -> List[str]:
        results: List[str] = []
        try:
            url = f"https://search.yahoo.com/search?p={quote_plus(query)}&n={self.url_limit}"
            resp = self.session.get(url, timeout=15)
            if resp.ok:
                soup = BeautifulSoup(resp.text, "html.parser")
                for link in soup.select("a[href]"):
                    href = link.get("href", "")
                    if href.startswith("http") and "yahoo.com" not in href:
                        results.append(href)
            time.sleep(random.uniform(1.0, 2.0))
        except Exception as exc:
            print(f"  ! Yahoo search failed: {exc}")
        return results[: self.url_limit]

    def search_yandex(self, query: str) -> List[str]:
        results: List[str] = []
        try:
            url = f"https://yandex.com/search/?text={quote_plus(query)}&numdoc={self.url_limit}"
            resp = self.session.get(url, timeout=15)
            if resp.ok:
                soup = BeautifulSoup(resp.text, "html.parser")
                for link in soup.select("a[href]"):
                    href = link.get("href", "")
                    if href.startswith("http") and "yandex" not in href:
                        results.append(href)
            time.sleep(random.uniform(1.0, 2.0))
        except Exception as exc:
            print(f"  ! Yandex search failed: {exc}")
        return results[: self.url_limit]

    def search_duckduckgo(self, query: str) -> List[str]:
        results: List[str] = []
        try:
            url = f"https://duckduckgo.com/html/?q={quote_plus(query)}&num={self.url_limit}"
            resp = self.session.get(url, timeout=15)
            if resp.ok:
                soup = BeautifulSoup(resp.text, "html.parser")
                for link in soup.select("a.result__a"):
                    href = link.get("href", "")
                    if href.startswith("http"):
                        results.append(href)
            time.sleep(random.uniform(1.0, 2.0))
        except Exception as exc:
            print(f"  ! DuckDuckGo search failed: {exc}")
        return results[: self.url_limit]

    def multi_engine_search(self, query: str) -> List[str]:
        urls: Set[str] = set()
        for engine in self.engines:
            if engine == "google":
                urls.update(self.search_google(query))
            elif engine == "bing":
                urls.update(self.search_bing(query))
            elif engine == "yahoo":
                urls.update(self.search_yahoo(query))
            elif engine == "yandex":
                urls.update(self.search_yandex(query))
            elif engine == "duckduckgo":
                urls.update(self.search_duckduckgo(query))
        cleaned = [url for url in urls if url.startswith("http") and not self.should_skip_url(url)]
        random.shuffle(cleaned)
        return cleaned[: self.url_limit]

    # --------------------------- Email Extraction --------------------------- #
    def is_aviation_email(self, email: str) -> bool:
        email_lower = email.lower()
        if "@" not in email_lower:
            return False
        local_part, domain = email_lower.split("@", 1)
        if domain in GENERIC_PROVIDERS:
            return False
        if domain.endswith((".gov", ".edu")):
            return False
        if any(domain.endswith(exclusion) for exclusion in EXCLUDED_DOMAINS):
            return False

        keyword_hit = any(token in email_lower for token in AVIATION_KEYWORDS)
        trusted_local = any(local_part.startswith(prefix) for prefix in TRUSTED_LOCAL_PARTS)
        tld = domain.rsplit(".", 1)[-1]
        regional_tld = tld in REGIONAL_TLDS or domain.endswith(".aero")

        if domain.endswith(".com") and not (keyword_hit or trusted_local or regional_tld):
            return False

        return keyword_hit or trusted_local or regional_tld

    def should_skip_url(self, url: str) -> bool:
        host = hostname_for(url)
        if not host:
            return True
        if any(host.endswith(domain) for domain in SOCIAL_DOMAINS):
            return True
        if any(host.endswith(domain) for domain in EXCLUDED_DOMAINS):
            return True
        return False

    def fetch_html(self, url: str) -> str:
        if url in self.visited_urls or self.should_skip_url(url):
            return ""
        try:
            resp = self.session.get(url, timeout=15)
        except requests.RequestException:
            return ""
        if not resp.ok:
            return ""
        content_type = resp.headers.get("Content-Type", "")
        if "text/html" not in content_type:
            return ""
        self.visited_urls.add(url)
        return resp.text

    def discover_related(self, base_url: str, html: str, limit: int = 4) -> List[str]:
        soup = BeautifulSoup(html, "html.parser")
        related: List[str] = []
        base_host = hostname_for(base_url)
        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "").strip()
            if not href or href.startswith(("mailto:", "javascript:", "#")):
                continue
            dest = urljoin(base_url, href)
            dest_host = hostname_for(dest)
            if not dest_host or dest_host != base_host:
                continue
            if self.should_skip_url(dest):
                continue
            if any(keyword in href.lower() for keyword in CONTACT_KEYWORDS):
                related.append(dest)
            if len(related) >= limit:
                break
        return related

    def extract_emails_from_html(self, html: str) -> Set[str]:
        matches: Set[str] = set()
        for email in EMAIL_RE.findall(html):
            email_lower = email.lower()
            if self.is_aviation_email(email_lower):
                matches.add(email_lower)
        return matches

    def extract_emails_from_url(self, url: str) -> Set[str]:
        emails: Set[str] = set()
        queue = [url]
        seen: Set[str] = set()
        while queue and len(seen) < 6:
            current = queue.pop(0)
            if current in seen or self.should_skip_url(current):
                continue
            seen.add(current)
            html = self.fetch_html(current)
            if not html:
                continue
            emails.update(self.extract_emails_from_html(html))
            if current == url:
                queue.extend(link for link in self.discover_related(current, html) if link not in seen)
            time.sleep(random.uniform(0.3, 0.6))
        return emails

    # ------------------------- Query Generation ---------------------------- #
    @staticmethod
    def build_queries(country: str) -> List[str]:
        tld = COUNTRY_TLD_MAP.get(country, "com")
        base = [
            "air charter",
            "private jet",
            "aviation",
            "charter flights",
            "business aviation",
            "helicopter charter",
            "aircraft operator",
            "flight services",
            "aviation broker",
            "air taxi",
        ]
        queries: List[str] = []
        for keyword in base:
            queries.append(f'"{keyword}" "{country}" "contact" email')
            queries.append(f'"{keyword}" "{country}" "email address" contact')
            queries.append(f'"{keyword}" "{country}" "contact us" email')
            queries.append(f'site:.{tld} "{keyword}" "{country}" email')
            queries.append(f'"{keyword}" "{country}" "ops@"')
        return queries

    def harvest_country(self, country: str, max_queries: int) -> Set[str]:
        print(f"\n=== HARVESTING {country.upper()} ===")
        queries = self.build_queries(country)
        random.shuffle(queries)
        queries = queries[:max_queries]

        country_emails: Set[str] = set()
        self.visited_urls.clear()
        for idx, query in enumerate(queries, 1):
            print(f"Query {idx}/{len(queries)}: {query}")
            urls = self.multi_engine_search(query)
            print(f"  Found {len(urls)} URLs")

            if not urls:
                continue

            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_url = {
                    executor.submit(self.extract_emails_from_url, candidate): candidate for candidate in urls
                }
                for future in as_completed(future_to_url):
                    try:
                        emails = future.result()
                    except Exception:  # pylint: disable=broad-except
                        continue
                    if emails:
                        country_emails.update(emails)
            time.sleep(random.uniform(2.0, 4.0))

        print(f"Total emails for {country}: {len(country_emails)}")
        return country_emails


def load_countries(path: Path | None, inline: Sequence[str]) -> List[str]:
    countries: List[str] = []
    if inline:
        countries.extend(inline)
    if path and path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                countries.append(line)
    if not countries:
        countries = DEFAULT_AFRICAN_COUNTRIES
    return countries


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Multi-engine aviation email harvester")
    parser.add_argument("--countries", nargs="*", help="Countries to harvest (defaults to Africa list)")
    parser.add_argument("--countries-file", help="Optional file containing country names")
    parser.add_argument("--max-queries", type=int, default=8, help="Queries per country (default: 8)")
    parser.add_argument(
        "--engines",
        nargs="+",
        default=["google", "bing", "yahoo", "yandex"],
        help="Search engines to use (default: google bing yahoo yandex)",
    )
    parser.add_argument("--url-limit", type=int, default=20, help="Max URLs per query per engine (default: 20)")
    parser.add_argument("--output", default="output/extract-emails/multi-engine-harvest.csv", help="Combined output CSV")
    parser.add_argument("--per-country", action="store_true", help="Also write per-country CSV files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    countries = load_countries(Path(args.countries_file) if args.countries_file else None, args.countries or [])

    harvester = MultiEngineHarvester(args.engines, args.url_limit)

    all_emails: Set[str] = set()
    per_country_results: dict[str, Set[str]] = defaultdict(set)

    for country in countries:
        try:
            emails = harvester.harvest_country(country, max_queries=args.max_queries)
        except KeyboardInterrupt:
            raise
        except Exception as exc:  # pylint: disable=broad-except
            print(f"  ! Error harvesting {country}: {exc}")
            continue
        if emails:
            per_country_results[country] = emails
            all_emails.update(emails)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Query", "Title", "Email", "SourceURL"])
        writer.writeheader()
        for email in sorted(all_emails):
            writer.writerow(
                {
                    "Query": "multi_engine",
                    "Title": "Multi-engine harvest",
                    "Email": email,
                    "SourceURL": "multi_engine_search",
                }
            )

    if args.per_country:
        for country, emails in per_country_results.items():
            safe_name = country.lower().replace(" ", "-")
            country_path = output_path.parent / f"multi-engine-{safe_name}.csv"
            with country_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["Query", "Title", "Email", "SourceURL"])
                writer.writeheader()
                for email in sorted(emails):
                    writer.writerow(
                        {
                            "Query": f"multi_engine_{country}",
                            "Title": f"{country} Aviation",
                            "Email": email,
                            "SourceURL": "multi_engine_search",
                        }
                    )

    print(f"\nFinal harvest: {len(all_emails)} unique emails")
    print(f"Saved combined output to {output_path}")


if __name__ == "__main__":
    main()

