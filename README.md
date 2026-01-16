# Email Scraping

> **Educational Project** - Unified toolkit for discovering, enriching, and validating business contact data.

> ⚠️ **Disclaimer**: This project is intended for **educational purposes only**. Users must comply with all applicable laws, respect robots.txt, website terms of service, and obtain proper consent before collecting personal information. The authors are not responsible for any misuse of this software.

## Why This Project Exists

Lead generation workflows often stitch together multiple utilities: map prospecting, HTML scraping, enrichment, and deliverability checks. Email Scraping merges proven ideas from projects such as [Map Email Scraper](https://github.com/MickeyUK/map-email-scraper), community-built email extractors, [MailScout deliverability probing](https://github.com/batuhanaky/mailscout), and web crawling utilities like [e-scraper](https://github.com/0x4D-5A/e-scraper) or [crawler-python](https://github.com/andripwn/crawler-python) into a modern TypeScript pipeline.

## Feature Highlights

- **Google Maps prospect discovery** — powered by the Places API for the “collections” style querying popularized by Map Email Scraper.
- **Multi-layer HTML extraction** — regex, DOM, attribute scans, base64/unicode decoding inspired by battle-tested parsers.
- **Recursive web crawling** — controlled depth, domain scoping, and external link filtering derived from Python crawlers.
- **SMTP deliverability probing** — MX resolution with progressive failover as practiced by MailScout/MailTester workflows.
- **Web reachability checks** — probes production and dev hostnames to ensure websites respond before trusting an address.
- **Export flexibility** — JSON, CSV, and Excel output for downstream CRMs thanks to inspiration from WebDiver and MailScout exporters.

## Tech Stack

- Node.js 18+, TypeScript, Playwright crawler, SMTP handshake verifier.
- Async orchestration with `@supercharge/promise-pool` and modular service classes for easy substitution.

## Repository Layout

```
EmailScraping/
├── config/                     # Seed and environment templates
├── docs/                        # Additional project documentation
├── output/                      # Aggregated scrape artefacts (JSON/CSV/XLSX/TXT)
│   ├── dataemails.txt          # Main email archive
│   ├── emails.txt              # New emails from scraping sessions
│   ├── logs/                    # All log files
│   └── extract-emails/         # Python extract-emails CSV outputs
├── queries/                     # Query files for batch processing
├── scripts/
│   ├── python/                 # Selenium / requests helpers and rich scrapers
│   └── typescript/             # Node/TS automation invoked via `npm run`
├── scrapy/                      # Scrapy spiders for bulk crawling
├── src/                         # Primary TypeScript application code
└── tests/                       # Vitest unit/integration coverage
```

> Tip: `scripts/README.md` summarises every helper and shows example invocations.

## Getting Started

```bash
cd EmailScraping
pnpm install # or npm install / yarn install

# Copy and edit configuration
cp config/example.env .env
```

Populate the `.env` file with:

- `GOOGLE_MAPS_API_KEY` (optional; required only for Google Places discovery)
- `SMTP_PROBE_FROM` and `SMTP_PROBE_HELLO` (required when deliverability probing is enabled)

Run the pipeline:

```bash
npm run dev -- --term "business services" --location "New York" --country us
```

Require that the website responds with 2xx/3xx and remove addresses tied to dead domains:

```bash
npm run dev -- --term "charter" --require-reachable
```

Skip dev subdomain probing if internal hosts flag as false positives:

```bash
npm run dev -- --term "business" --skip-dev-subdomain
```

### Batch Queries

You can provide a JSON file containing query objects:

```json
[
  { "term": "business services", "location": "New York", "countryCode": "us" },
  { "term": "consulting", "location": "London" }
]
```

```bash
npm run dev -- --queries ./queries.json
```

Outputs are saved to `./output/results.{json,csv,xlsx}` by default.

### Manual Targets (no Google Maps key)

When you already know the domains you want to crawl, provide them directly:

```bash
npm run dev -- --website https://example.com --require-reachable
```

You can also provide a seed file with target websites:

```bash
npm run dev -- --seed config/seeds/example.json --require-reachable
```

Each seed entry can optionally include:

- `extraPaths` or `extraUrls` – additional landing pages (contact, media, etc.) that should be crawled even if they are not linked from the homepage
- `seedEmails` – known good addresses to bootstrap the dataset (these still run through dedupe + verification)
- `allowedDomains` – restrict scraped emails to the airline’s own domains (helpful to exclude third-party agencies)

Example seed file structure:

```json
[
  {
    "name": "Example Company",
    "website": "https://www.example.com",
    "extraPaths": [
      "/contact",
      "/about"
    ],
    "seedEmails": [
      "contact@example.com",
      "info@example.com"
    ],
    "allowedDomains": [
      "example.com"
    ]
  }
]
```

Besides `results.json`, `results.csv`, and `results.xlsx`, the run also produces `emails.txt` containing one email per line, deduplicated across all sources.

### Optional: Discover new domains via Google search

When you need fresh domains before running the pipeline, you can launch the bundled Google discovery helper (inspired by community scrapers such as [TS-email-scraper](https://github.com/eneiromatos/TS-email-scraper)):

```bash
# Inline queries (comma separated)
npm run search:google -- --queries "business services,consulting companies" --limit 20

# Or drive it from a config file
cat > config/google-search.json <<'JSON'
{
  "queries": [
    "business services",
    "consulting companies"
  ],
  "resultsPerQuery": 25,
  "output": "output/google-search-results.json",
  "domainsOutput": "output/google-search-domains.txt"
}
JSON
npm run search:google -- --input config/google-search.json
```

The script writes two handy artefacts:

- `output/google-search-results.json`: full Google SERP entries (query, title, description, URL, domain).  
- `output/google-search-domains.{txt,json}`: deduplicated hostnames ranked by frequency. Feed these into your seed list or the Python helper to keep growing the dataset.

> **Tip:** Provide Google Programmable Search credentials for best results. Export your API key and custom search engine ID (CSE) before running:
> ```bash
> export GOOGLE_API_KEY=\"your-api-key\"
> export GOOGLE_CSE_ID=\"your-search-engine-id\"
> ```
> Without these, the helper falls back to a lightweight scraper which may return fewer (or zero) results if Google enforces bot detection.

### Optional: Python `extract-emails` helper

You can enrich the dataset with the Python [`extract-emails`](https://pypi.org/project/extract-emails/) scraper when public websites block our Playwright crawler.

1. Use Python 3.10+ and install the CLI:

   ```bash
   python3 -m venv .venv-extract
   source .venv-extract/bin/activate
   pip install "extract-emails>=5.3.3"
   ```

2. Run the helper against a target page (the `requests` backend avoids the need for a local chromedriver). Save results into `output/extract-emails/` so the merger can spot them:

   ```bash
   python -m extract_emails.console.application \
     --url https://www.example.com/contact \
     --browser-name requests \
     --depth 1 \
     --output-file output/extract-emails/example.csv
   ```

   Increase `--depth` when you want the helper to follow in-site links (e.g. `/contact` pages). Switch `--browser-name` to `chrome` only if you have Chrome installed and need to defeat aggressive anti-bot filtering.

3. Merge the CSV output into the main `emails.txt` roll-up:

   ```bash
   npm run update:emails
   ```

The merger automatically ignores duplicates, enforces the seed `allowedDomains`, and keeps the running list alphabetised.

## Architecture Overview

| Module | Responsibility |
| --- | --- |
| `GoogleMapsScraper` | Text search via Places API, pagination, rate limiting |
| `WebCrawler` | Bounded-depth recursive crawling with external link guard |
| `EmailExtractor` | Multi-pass extraction (mailto, text, obfuscation decoding) |
| `DeliverabilityChecker` | MX lookup + SMTP handshake with progressive fallback |
| `HttpDomainValidator` | HEAD/GET probes to confirm prod/dev web hosts respond |
| `ResultStore` | JSON/CSV/Excel export |
| `EmailScrapingPipeline` | Orchestrates the data flow, deduplication, and persistence |

## Roadmap Ideas

- Integrate Google My Business session scraping for UI parity with desktop electron apps.
- Add Playwright-based JavaScript rendering for SPAs (inspired by WebDiver).
- Allow pluggable deliverability providers (ZeroBounce, NeverBounce, etc.).
- Bundle REST API & dashboard frontend backed by the same pipeline.

## Contributing

1. Fork & clone
2. Create a feature branch
3. Run `npm test && npm run lint`
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Educational Purpose**: This project is intended for educational purposes only. Please review the educational disclaimer in the LICENSE file.

Scrapy-based crawling
---------------------

For deeper harvesting on JavaScript-heavy sites, a dedicated Scrapy project lives under `scrapy/uae_airlines_crawler`.

1. Create/activate the virtualenv and install Scrapy (already bootstrapped for you):
   ```bash
   cd scrapy
   source .venv/bin/activate
   ```
2. Run a spider and export contacts as JSON Lines:
   ```bash
   cd uae_airlines_crawler
   scrapy crawl multi_contacts -O ../../output/contacts.jsonl
   ```
3. Feed that JSON back into the TypeScript pipeline (e.g. merge addresses into a seed file or run deliverability checks by converting into the existing schema).

The spider respects depth limits, filters out placeholder emails, and follows configured domains. Adjust start URLs or metadata as the public site structure evolves.

---

