# Operational Workflows

This cheat sheet lists common workflows for managing email scraping operations.

## 1. Refresh master email roll-up

```bash
# Scrapy + Python dumps → output/
npm run update:emails
```

What happens:

1. Loads the existing `output/emails.txt`.
2. Reads fresh JSONL dumps from `output/contacts.jsonl`, `output/multi_contacts.jsonl`, etc.
3. Parses CSVs dropped in `output/extract-emails/`.
4. Applies the whitelisted domains from `config/seeds/`.
5. Writes a sorted, deduped roll-up back to `output/emails.txt`.

## 2. Run Python-based extractors

### Using extract-emails helper

```bash
python3 -m extract_emails.console.application --url https://example.com/contact --browser-name requests --depth 1
```

### Enhanced Cloudflare bypass

```bash
python3 scripts/python/cloudflare_bypass_extractor.py --country ru --max-listings 20
```

Results end up in `output/extract-emails/aircharterguide-<country>.csv`. Merge with `npm run update:emails`.

## 3. Launch the Google SERP collector

```bash
npm run search:google -- --queries "business services,consulting companies" --limit 15
```

Outputs:

- `output/google-search-results.json`
- `output/google-search-domains.{txt,json}`

Use the domains file to seed `config/seeds/` or to drive the Python helpers.

## 4. Open-web discovery blast

```bash
python3 scripts/python/search_based_extractor.py
```

This script:

- rotates user-agents,
- runs stealth Google searches by region,
- walks curated business directories,
- saves emails to `output/search-emails/`.

## 5. Main TypeScript pipeline

```bash
npm run dev -- --seed config/seeds/example.json --require-reachable
```

Walk-through:

1. Loads seeds (including `allowedDomains` for cleanup).
2. Crawls and extracts emails.
3. Runs deliverability checks (if SMTP keys present).
4. Writes JSON/CSV/XLSX plus updates `output/emails.txt` baseline on demand.

---

Need a new flow captured? Add a section here and link it from the root `README.md`.


