#!/usr/bin/env python3
"""
Cloudflare-aware Air Charter Guide email extractor.

This script drives a full Chrome browser with human-like heuristics to bypass
Cloudflare checks, walks operator listings, and captures visible email
addresses. Results are written to a tidy CSV inside `output/extract-emails/`.
"""

from __future__ import annotations

import argparse
import base64
import codecs
import csv
import html
import random
import re
import sys
import time
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set, Tuple

from urllib.parse import unquote

import requests

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output" / "extract-emails"
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
BASE64_REGEX = re.compile(r"[A-Za-z0-9+/]{32,}={0,2}")
ROT13_CANDIDATE_REGEX = re.compile(r"[A-Za-z0-9._%+-@]{10,}")


def build_listing_url(country_code: str) -> str:
  country = country_code.strip().lower()
  return f"https://www.aircharterguide.com/listingsearch?dt=8&country={country}"


def write_csv(path: Path, rows: Iterable[dict]) -> None:
  fieldnames = ["Company", "Email", "URL"]
  sorted_rows = sorted(rows, key=lambda row: row["Email"].lower())
  path.parent.mkdir(parents=True, exist_ok=True)

  with path.open("w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fieldnames)
    writer.writeheader()
    for row in sorted_rows:
      writer.writerow(row)


class CloudflareBypassEmailExtractor:
  """Email extractor designed to work with Cloudflare protection."""

  def __init__(self, headless: bool = False, max_company_pages: int = 10, delay: float = 3.0) -> None:
    self.driver: Optional[webdriver.Chrome] = None
    self.headless = headless
    self.max_company_pages = max_company_pages
    self.delay = delay
    self._emails: Set[str] = set()
    self.session = requests.Session()
    self._configure_session()
    self._advanced_patterns = [
      re.compile(r"[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}"),
      re.compile(r"[a-zA-Z0-9._%+-]+%40[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
      re.compile(r"[a-zA-Z0-9._%+-]+&#64;[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
      re.compile(r"[a-zA-Z0-9._%+-]+\s*(?:at|@)\s*[a-zA-Z0-9.-]+\s*(?:dot|\.)\s*[a-zA-Z0-9.-]+"),
      re.compile(r'"email"\s*:\s*"([^"]+)"'),
      re.compile(r"'email'\s*:\s*'([^']+)'"),
      re.compile(r'data-email=["\']([^"\']+)["\']'),
      re.compile(r'data-contact=["\']([^"\']+)["\']'),
      re.compile(r'data-mail=["\']([^"\']+)["\']'),
      re.compile(r'content\s*:\s*["\']([^"\']+)["\']'),
    ]

  def _configure_session(self) -> None:
    self.session.headers.update(
      {
        "User-Agent": self._random_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      }
    )

  def _random_user_agent(self) -> str:
    pool = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    ]
    return random.choice(pool)

  def _fetch_raw_content(self, url: str) -> str:
    try:
      response = self.session.get(url, timeout=15)
      if response.ok:
        return response.text
    except requests.RequestException:
      return ""
    return ""

  def _clean_email(self, email: str) -> str:
    if not email:
      return ""
    email = html.unescape(email)
    email = unquote(email)
    email = email.replace("&amp;", "&")
    email = re.sub(r"\s*@\s*", "@", email)
    email = re.sub(r"\s*\.\s*", ".", email)
    email = email.replace(" at ", "@").replace(" dot ", ".")
    email = email.strip(" \"'()[]{}<>")
    return email.lower()

  def _extract_from_decoded(self, text: str) -> Set[str]:
    emails: Set[str] = set()
    if not text:
      return emails
    for match in EMAIL_REGEX.findall(text):
      cleaned = self._clean_email(match)
      if EMAIL_REGEX.fullmatch(cleaned):
        emails.add(cleaned)
    return emails

  def _extract_advanced_emails(self, content: str) -> Set[str]:
    emails: Set[str] = set()
    if not content:
      return emails

    working = html.unescape(content)
    for pattern in self._advanced_patterns:
      try:
        matches = pattern.findall(working)
      except re.error:
        continue
      for match in matches:
        if isinstance(match, tuple):
          match = next((m for m in match if m), "")
        cleaned = self._clean_email(str(match))
        if EMAIL_REGEX.fullmatch(cleaned):
          emails.add(cleaned)

    for encoded in BASE64_REGEX.findall(working):
      if len(encoded) % 4 != 0:
        continue
      try:
        decoded = base64.b64decode(encoded).decode("utf-8", errors="ignore")
      except (ValueError, UnicodeDecodeError):
        continue
      emails.update(self._extract_from_decoded(decoded))

    for candidate in ROT13_CANDIDATE_REGEX.findall(working):
      try:
        decoded = codecs.decode(candidate, "rot13")
      except Exception:
        continue
      if decoded and decoded != candidate and "@" in decoded:
        emails.update(self._extract_from_decoded(decoded))

    url_decoded = unquote(working)
    if url_decoded != working:
      emails.update(self._extract_from_decoded(url_decoded))

    return emails

  # ---------------------------------------------------------------------------
  # Browser setup & human-like behaviour
  # ---------------------------------------------------------------------------
  def setup_browser(self) -> bool:
    try:
      service = Service(ChromeDriverManager().install())
      options = Options()
      if self.headless:
        options.add_argument("--headless=new")
      options.add_argument("--no-sandbox")
      options.add_argument("--disable-dev-shm-usage")
      options.add_argument("--disable-blink-features=AutomationControlled")
      options.add_experimental_option("excludeSwitches", ["enable-automation"])
      options.add_experimental_option("useAutomationExtension", False)
      options.add_argument("--window-size=1366,768")
      options.add_argument("--start-maximized")
      options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      )

      binaries = ["/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      for binary in binaries:
        try:
          options.binary_location = binary
          self.driver = webdriver.Chrome(service=service, options=options)
          break
        except Exception:
          continue

      if not self.driver:
        # Try default binary as last resort
        self.driver = webdriver.Chrome(service=service, options=options)

      self.driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"},
      )
      self.driver.set_page_load_timeout(60)
      self.driver.implicitly_wait(10)
      return True
    except Exception as exc:  # pragma: no cover - purely defensive
      print(f"[CF] Browser setup failed: {exc}")
      return False

  def simulate_human_behaviour(self) -> None:
    if not self.driver:
      return
    try:
      actions = ActionChains(self.driver)
      for _ in range(random.randint(3, 7)):
        actions.move_by_offset(random.randint(50, 500), random.randint(50, 300)).perform()
        time.sleep(random.uniform(0.1, 0.3))
      for _ in range(random.randint(2, 4)):
        self.driver.execute_script("window.scrollBy(0, arguments[0]);", random.randint(100, 300))
        time.sleep(random.uniform(0.3, 0.8))
      actions.send_keys(random.choice([Keys.END, Keys.HOME, Keys.PAGE_DOWN, Keys.PAGE_UP])).perform()
      time.sleep(random.uniform(0.2, 0.5))
    except WebDriverException:
      pass

  # ---------------------------------------------------------------------------
  # Cloudflare detection & waiting
  # ---------------------------------------------------------------------------
  def wait_for_cloudflare(self, url: str, max_wait: int = 120) -> Tuple[bool, str]:
    if not self.driver:
      return False, "DRIVER_NOT_READY"

    print("🛡️  Handling Cloudflare Protection")
    try:
      self.driver.get(url)
      start = time.time()
      challenge_seen = False

      while time.time() - start < max_wait:
        time.sleep(1)
        page_source = self.driver.page_source.lower()
        current_url = self.driver.current_url.lower()

        if "checking your browser" in page_source or "enable cookies" in page_source:
          challenge_seen = True
          print(f"   Cloudflare challenge detected... waiting ({int(time.time() - start)}s)")
          continue
        if any(
          token in page_source for token in ["cf-captcha-container", "cf-chl-captcha", "g-recaptcha", "hcaptcha"]
        ):
          print("   CAPTCHA detected - cannot proceed automatically.")
          return False, "CAPTCHA"
        if "access denied" in page_source or "forbidden" in page_source:
          print("   Access denied.")
          return False, "DENIED"

        if "aircharterguide" in current_url or "aircharterguide" in page_source:
          if challenge_seen:
            print("   🔓 Cloudflare challenge bypassed")
          print(f"   ✅ Site loaded after {int(time.time() - start)} seconds")
          return True, "SUCCESS"

        if challenge_seen:
          self.simulate_human_behaviour()

      print("   ⏰ Timed out waiting for Cloudflare.")
      return False, "TIMEOUT"

    except Exception as exc:  # pragma: no cover - defensive
      print(f"   ❌ Error during Cloudflare wait: {exc}")
      return False, "ERROR"

  # ---------------------------------------------------------------------------
  # Extraction helpers
  # ---------------------------------------------------------------------------
  def find_company_links(self) -> List[str]:
    if not self.driver:
      return []

    selectors = [
      "a[href*='operator_info']",
      "a[href*='company']",
      "a[href*='operator']",
      "a[href*='listing']",
      "a[title*='View']",
      "a[title*='Details']",
      ".company-link",
      ".operator-link",
      ".listing-link",
    ]

    links: Set[str] = set()
    for selector in selectors:
      try:
        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
        for element in elements:
          href = element.get_attribute("href")
          if href and "aircharterguide.com" in href:
            links.add(href)
      except WebDriverException:
        continue
    return list(links)

  def extract_emails_from_text(self, text: str) -> Set[str]:
    emails: Set[str] = set()
    if not text:
      return emails
    for raw in EMAIL_REGEX.findall(text):
      cleaned = self._clean_email(raw)
      if EMAIL_REGEX.fullmatch(cleaned):
        emails.add(cleaned)
    emails.update(self._extract_advanced_emails(text))
    return emails

  def capture_emails_on_page(self) -> Set[str]:
    if not self.driver:
      return set()
    emails = set()
    try:
      body = self.driver.find_element(By.TAG_NAME, "body")
      page_source = self.driver.page_source
      emails.update(self.extract_emails_from_text(page_source))
      emails.update(self.extract_emails_from_text(body.text))
    except WebDriverException:
      pass
    return emails

  def reveal_email_if_needed(self) -> bool:
    if not self.driver:
      return False

    selectors = [
      (By.XPATH, "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'show email')]"),
      (By.XPATH, "//span[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'show email')]"),
      (By.CSS_SELECTOR, "button[data-automation='show-email']"),
      (By.CSS_SELECTOR, "button.show-email"),
    ]

    for by, value in selectors:
      try:
        element = WebDriverWait(self.driver, 8).until(EC.presence_of_element_located((by, value)))
        if element:
          self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
          time.sleep(0.3)
          try:
            WebDriverWait(self.driver, 4).until(EC.element_to_be_clickable((by, value)))
          except Exception:
            pass
          try:
            element.click()
          except Exception:
            self.driver.execute_script("arguments[0].click();", element)
          time.sleep(0.8)
          return True
      except Exception:
        continue
    return False

  def process_company_pages(self) -> List[dict]:
    if not self.driver:
      return []

    company_links = self.find_company_links()
    print(f"🏢 Found {len(company_links)} potential company pages")

    collected_rows: List[dict] = []
    limit = min(self.max_company_pages, len(company_links))

    if limit == 0:
      try:
        WebDriverWait(self.driver, 15).until(
          EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='operator_info']"))
        )
        company_links = self.find_company_links()
        limit = min(self.max_company_pages, len(company_links))
      except Exception:
        print("   ⚠️  No operator links detected on listing page.")
        return collected_rows

    for idx, company_url in enumerate(company_links[:limit], start=1):
      try:
        print(f"   Visiting {idx}/{limit}: {company_url}")
        self.driver.get(company_url)
        time.sleep(self.delay)
        try:
          WebDriverWait(self.driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        except Exception:
          pass
        self.reveal_email_if_needed()
        emails = self.capture_emails_on_page()
        raw_content = self._fetch_raw_content(company_url)
        emails.update(self._extract_advanced_emails(raw_content))
        if emails:
          print(f"     ➜ {len(emails)} email(s) found: {sorted(emails)}")
          for email in emails:
            collected_rows.append(
              {
                "Company": self.driver.title.strip() or "Unknown",
                "Email": email,
                "URL": company_url,
              }
            )
        else:
          print("     (No emails detected)")
        self.driver.back()
        time.sleep(2)
      except Exception as exc:
        print(f"   Error processing {company_url}: {exc}")

    return collected_rows

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------
  def extract(self, url: str) -> List[dict]:
    print("🚀 CLOUDFLARE BYPASS EMAIL EXTRACTION")
    print("=" * 80)
    print(f"Target URL: {url}")
    print("=" * 80)

    try:
      if not self.setup_browser():
        return []

      success, status = self.wait_for_cloudflare(url)
      if not success:
        print(f"❌ Cloudflare bypass failed: {status}")
        return []

      rows = self.process_company_pages()
      emails = {row["Email"].lower() for row in rows}

      print("\n" + "=" * 80)
      print("🏆 EXTRACTION RESULTS")
      print("=" * 80)
      print(f"✅ Total unique emails found: {len(emails)}")
      for idx, email in enumerate(sorted(emails), start=1):
        print(f"   {idx:2d}. {email}")
      return rows
    finally:
      if self.driver:
        self.driver.quit()
        self.driver = None


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Air Charter Guide Cloudflare bypass extractor")
  parser.add_argument("--country", default="ru", help="Target country code (default: ru)")
  parser.add_argument("--url", help="Override listing URL")
  parser.add_argument("--max-listings", type=int, default=15, help="Maximum company pages to visit")
  parser.add_argument("--delay", type=float, default=3.0, help="Delay between navigation steps")
  parser.add_argument("--headless", action="store_true", help="Run Chrome in headless mode")
  parser.add_argument(
    "--output",
    help="Output CSV path (default: output/extract-emails/aircharterguide-<country>-cloudflare.csv)",
  )
  return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
  args = parse_args(argv)
  url = args.url or build_listing_url(args.country)
  output_path = (
    Path(args.output).resolve()
    if args.output
    else OUTPUT_DIR / f"aircharterguide-{args.country.lower()}-cloudflare.csv"
  )

  extractor = CloudflareBypassEmailExtractor(
    headless=args.headless,
    max_company_pages=max(args.max_listings, 1),
    delay=max(args.delay, 1.0),
  )

  rows = extractor.extract(url)
  if not rows:
    print("⚠️  No emails captured.")
    return 1

  write_csv(output_path, rows)
  print(f"\n📄 Saved {len(rows)} rows to {output_path}")
  return 0


if __name__ == "__main__":
  sys.exit(main())


