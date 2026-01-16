#!/usr/bin/env python3
"""
Advanced Search-Based Aviation Email Extractor

Searches Google, aviation-specific sites, directories, and associations to collect
aviation-related email addresses. Results are saved to `output/search-emails/`.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

WORKDIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = WORKDIR / "output" / "search-emails"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def default_user_agent() -> str:
  pool = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  ]
  return random.choice(pool)


EMAIL_PATTERNS = [
  re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
  re.compile(r"[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\s*\.\s*[A-Za-z]{2,}"),
  re.compile(r'"[^"]*"\s*[<:]\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'),
  re.compile(r"MAILTO:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})", re.IGNORECASE),
  re.compile(r"href=.*?mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})", re.IGNORECASE),
]

FALSE_POSITIVE_TOKENS = [
  "example@",
  "test@",
  "privacy@",
  "support@example",
  "info@example",
  "no-reply@",
  "noreply@",
]

EXCLUDED_DOMAINS = [
  "facebook.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "pinterest.com",
]


def is_valid_email(email: str) -> bool:
  if not email or len(email) > 100:
    return False
  email = email.strip().lower()
  if not re.match(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$", email):
    return False
  if any(token in email for token in FALSE_POSITIVE_TOKENS):
    return False
  domain = email.split("@", 1)[1]
  if "." not in domain or domain.endswith("."):
    return False
  return True


def is_allowed_url(url: str) -> bool:
  if not url or not url.startswith("http"):
    return False
  return not any(domain in url for domain in EXCLUDED_DOMAINS)


def extract_emails_from_text(content: str) -> Set[str]:
  emails: Set[str] = set()
  if not content:
    return emails
  working = content
  for pattern in EMAIL_PATTERNS:
    try:
      matches = pattern.findall(working)
    except re.error:
      continue
    for match in matches:
      if isinstance(match, tuple):
        match = next((m for m in match if m), "")
      email = str(match).strip().lower()
      email = email.replace(" ", "")
      if is_valid_email(email):
        emails.add(email)
  return emails


def fetch_page(url: str, session: requests.Session, timeout: int = 12) -> str:
  try:
    response = session.get(
      url,
      timeout=timeout,
      headers={"User-Agent": default_user_agent(), "Accept": "text/html,application/xhtml+xml"},
    )
    if response.ok:
      return response.text
  except requests.RequestException as exc:
    logger.debug("Failed to fetch %s (%s)", url, exc)
  return ""


class SearchBasedEmailExtractor:
  def __init__(self, driver_path: Optional[str] = None) -> None:
    self.driver: Optional[webdriver.Chrome] = None
    self.session = requests.Session()
    self.session.headers.update(
      {
        "User-Agent": default_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
    )
    self.driver_path = driver_path

    self.regions = ["UAE", "Qatar", "Saudi Arabia", "Kuwait", "Oman", "Bahrain", "Jordan", "Egypt"]
    self.sites = [
      "https://www.aviationcharter.com",
      "https://www.executiveflyaviation.com",
      "https://www.aviator.ch",
      "https://www.jetexec.com",
      "https://www.charterindex.com",
      "https://www.privatejetbrokers.com",
      "https://www.execaircraft.com",
      "https://www.aircharteronline.com",
      "https://www.businessaircharter.com",
      "https://www.gulfstream.com",
      "https://www.cessna.com",
      "https://www.bombardier.com",
    ]
    self.directories = [
      "https://www.yellowpages.com/aviation",
      "https://www.whitepages.com/airlines",
      "https://www.thomasnet.com/manufacturers/aircraft",
      "https://www.worldairlines.org",
      "https://aviationweek.com",
      "https://www.ainonline.com",
      "https://www.flightglobal.com",
    ]
    self.associations = [
      "https://www.nbaa.org",
      "https://www.ibac.org",
      "https://www.businessaircraft.org",
      "https://www.ops-group.com",
    ]

  # -------------------------------------------------------------------------
  # Selenium setup and helpers
  # -------------------------------------------------------------------------
  def setup_driver(self) -> bool:
    logger.info("Initialising Chrome driver for Google searches…")
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(f"--user-agent={default_user_agent()}")

    try:
      if self.driver_path:
        service = Service(self.driver_path)
      else:
        service = Service(ChromeDriverManager().install())
      driver = webdriver.Chrome(service=service, options=options)
      driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
      driver.set_page_load_timeout(30)
      self.driver = driver
      return True
    except Exception as exc:
      logger.error("Failed to initialise Chrome driver: %s", exc)
      return False

  def ensure_driver(self) -> webdriver.Chrome:
    if not self.driver and not self.setup_driver():
      raise RuntimeError("Unable to initialise webdriver")
    assert self.driver is not None
    return self.driver

  def google_search(self, query: str, limit: int = 10) -> List[str]:
    driver = self.ensure_driver()
    search_url = f"https://www.google.com/search?q={query}&num={limit}"
    logger.info("Google search: %s", search_url)
    try:
      driver.get(search_url)
      WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.CSS_SELECTOR, "a")))
      anchors = driver.find_elements(By.CSS_SELECTOR, "div.yuRUbf > a, a")
      links: List[str] = []
      for anchor in anchors:
        url = anchor.get_attribute("href")
        if url and is_allowed_url(url):
          links.append(url)
        if len(links) >= limit:
          break
      return links
    except TimeoutException:
      logger.warning("Google search timed out for %s", query)
    except WebDriverException as exc:
      logger.warning("Google search error for %s: %s", query, exc)
    return []

  # -------------------------------------------------------------------------
  # Extraction tasks
  # -------------------------------------------------------------------------
  def extract_from_url(self, url: str) -> Set[str]:
    if not is_allowed_url(url):
      return set()
    content = fetch_page(url, self.session)
    if not content:
      return set()
    emails = extract_emails_from_text(content)
    if not emails:
      soup = BeautifulSoup(content, "html.parser")
      for link in soup.find_all("a", href=True):
        href = link.get("href", "")
        if href.lower().startswith("mailto:"):
          email = href.split("mailto:", 1)[1].split("?", 1)[0]
          if is_valid_email(email):
            emails.add(email.lower())
    return emails

  def crawl_collection(self, name: str, urls: Iterable[str], pause_range: tuple[float, float] = (2.0, 4.0)) -> Set[str]:
    logger.info("Collecting emails from %s…", name)
    collected: Set[str] = set()
    for url in urls:
      logger.debug("Fetching %s", url)
      emails = self.extract_from_url(url)
      collected.update(emails)
      time.sleep(random.uniform(*pause_range))
    logger.info("Collected %d emails from %s", len(collected), name)
    return collected

  def run(self) -> Set[str]:
    logger.info("Starting comprehensive search-based extraction…")
    all_emails: Set[str] = set()

    try:
      for region in self.regions:
        region_query = f"airline charter contact email {region}"
        region_links = self.google_search(region_query, limit=12)
        region_emails = self.crawl_collection(f"Google results for {region}", region_links, (1.0, 2.5))
        all_emails.update(region_emails)
        time.sleep(random.uniform(3.0, 6.0))

      all_emails.update(self.crawl_collection("Aviation sites", self.sites, (3.0, 5.0)))
      all_emails.update(self.crawl_collection("Directories", self.directories, (4.0, 6.0)))
      all_emails.update(self.crawl_collection("Associations", self.associations, (3.0, 5.0)))
    finally:
      if self.driver:
        self.driver.quit()

    cleaned = {email for email in all_emails if is_valid_email(email)}
    logger.info("Comprehensive extraction finished. %d unique emails found.", len(cleaned))
    return cleaned


def save_results(emails: Set[str], prefix: str) -> Path:
  timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
  base = OUTPUT_DIR / f"{prefix}_{timestamp}"
  txt_path = base.with_suffix(".txt")
  json_path = base.with_suffix(".json")

  with txt_path.open("w", encoding="utf-8") as handle:
    for email in sorted(emails):
      handle.write(f"{email}\n")

  with json_path.open("w", encoding="utf-8") as handle:
    json.dump(sorted(emails), handle, indent=2)

  logger.info("Saved %d emails to %s and %s", len(emails), txt_path, json_path)
  return txt_path


def main(argv: Optional[Sequence[str]] = None) -> int:
  extractor = SearchBasedEmailExtractor()
  emails = extractor.run()
  if not emails:
    logger.warning("No emails discovered.")
    return 1
  save_results(emails, "search_emails")
  return 0


if __name__ == "__main__":
  sys.exit(main())


