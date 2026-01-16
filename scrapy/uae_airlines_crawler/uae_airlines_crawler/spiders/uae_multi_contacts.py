import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, Union
from urllib.parse import urljoin, urlparse

import scrapy

EMAIL_REGEX = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
DEFAULT_MAX_DEPTH = 2
DEFAULT_MAX_PAGES = 120


class MultiContactsSpider(scrapy.Spider):
    name = "multi_contacts"

    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "DOWNLOAD_DELAY": 0.4,
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_START_DELAY": 0.25,
        "AUTOTHROTTLE_MAX_DELAY": 3.0,
        "AUTOTHROTTLE_TARGET_CONCURRENCY": 4.0,
        "CONCURRENT_REQUESTS": 32,
        "LOG_LEVEL": "INFO",
    }

    ignored_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".svg",
        ".webp",
        ".pdf",
        ".zip",
        ".mp4",
        ".mp3",
        ".avi",
        ".mov",
        ".css",
        ".js",
        ".ico",
    }

    def __init__(self, seeds_path: str = None, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        default_root = Path(__file__).resolve().parents[4]
        default_path = default_root / "config" / "seeds" / "example.json"
        self.seeds_path = seeds_path or default_path
        self.seeds = self._load_seeds(self.seeds_path)
        self.visited: set[str] = set()
        self.page_counters: Dict[str, Dict[str, int]] = defaultdict(lambda: {"pages": 0})

    def _load_seeds(self, path: Union[str, Path]) -> list[dict[str, Any]]:
        resolved = Path(path)
        if not resolved.is_absolute():
            resolved = Path(__file__).resolve().parents[2] / resolved
        with resolved.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        seeds: list[dict[str, Any]] = []
        for seed in data:
            website = seed.get("website")
            if not website:
                continue
            parsed = urlparse(website)
            if not parsed.scheme:
                website = f"https://{website}"
            seed_copy = dict(seed)
            seed_copy["website"] = website
            allowed = seed_copy.get("allowedDomains")
            if not allowed:
                hostname = urlparse(website).hostname
                allowed = [hostname] if hostname else []
            seed_copy["allowedDomains"] = [domain.replace("www.", "").lower() for domain in allowed]
            seed_copy["extraUrls"] = list(self._expand_extra_urls(seed_copy))
            seeds.append(seed_copy)
        return seeds

    def _expand_extra_urls(self, seed: dict[str, Any]) -> Iterable[str]:
        website = seed.get("website")
        extra_urls = seed.get("extraUrls", [])
        extra_paths = seed.get("extraPaths", [])
        for url in extra_urls:
            yield url
        for path in extra_paths:
            if not website:
                continue
            yield urljoin(website, path)

    def start_requests(self) -> Iterable[scrapy.Request]:
        for seed in self.seeds:
            company = seed.get("name") or seed.get("website")
            config = {
                "company": company,
                "allowed_domains": seed.get("allowedDomains", []),
                "max_depth": seed.get("crawlMaxDepth", DEFAULT_MAX_DEPTH),
                "max_pages": seed.get("crawlMaxPages", DEFAULT_MAX_PAGES),
                "follow_external": seed.get("followExternal", False),
            }
            urls = {seed["website"], *seed.get("extraUrls", [])}
            for url in urls:
                yield scrapy.Request(
                    url=url,
                    callback=self.parse,
                    meta={
                        "company": company,
                        "config": config,
                        "depth": 0,
                    },
                )

    def parse(self, response: scrapy.http.Response):
        meta = response.meta
        company = meta["company"]
        config = meta["config"]
        depth = meta.get("depth", 0)

        if not self._register_page(response.url, company, config):
            return

        page_title = response.xpath("string(//title)").get()
        emails = self._extract_emails(response)
        for email in emails:
            yield {
                "company": company,
                "email": email,
                "source_url": response.url,
                "page_title": page_title,
            }

        next_depth = depth + 1
        if next_depth > config.get("max_depth", DEFAULT_MAX_DEPTH):
            return

        for href in response.css("a::attr(href)").getall():
            next_url = response.urljoin(href)
            if not self._should_follow(next_url, config):
                continue
            if next_url in self.visited:
                continue
            yield scrapy.Request(
                url=next_url,
                callback=self.parse,
                meta={
                    "company": company,
                    "config": config,
                    "depth": next_depth,
                },
            )

    def _register_page(self, url: str, airline: str, config: dict[str, Any]) -> bool:
        if url in self.visited:
            return False
        self.visited.add(url)
        counter = self.page_counters[company]
        counter["pages"] += 1
        if counter["pages"] > config.get("max_pages", DEFAULT_MAX_PAGES):
            return False
        return True

    def _extract_emails(self, response: scrapy.http.Response) -> set[str]:
        found: set[str] = set()
        for mailto in response.css('a[href^="mailto:"]::attr(href)').getall():
            email = mailto.split(":", 1)[-1]
            match = EMAIL_REGEX.search(email)
            if match:
                cleaned = match.group(0).lower()
                if not self._looks_like_placeholder(cleaned):
                    found.add(cleaned)
        for match in EMAIL_REGEX.findall(response.text):
            email = match.lower()
            if not self._looks_like_placeholder(email):
                found.add(email)
        return found

    def _looks_like_placeholder(self, email: str) -> bool:
        placeholders = {
            "example.com",
            "test.com",
            "domain.com",
            "example@",
            "johnsmith",
            "providername.com",
        }
        return any(placeholder in email for placeholder in placeholders)

    def _should_follow(self, url: str, config: dict[str, Any]) -> bool:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.path:
            lower_path = parsed.path.lower()
            if any(lower_path.endswith(ext) for ext in self.ignored_extensions):
                return False
        hostname = parsed.hostname or ""
        bare_host = hostname.replace("www.", "").lower()
        if bare_host in config.get("allowed_domains", []):
            return True
        if config.get("follow_external"):
            return True
        return False
