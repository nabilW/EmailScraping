# Scripts Overview

The `scripts/` folder is split by runtime so it is easier to find the right automation entry point.

## Python (`scripts/python/`)

| Script | Purpose |
| --- | --- |
| `cloudflare_bypass_extractor.py` | Selenium workflow that handles Air Charter Guide pages protected by Cloudflare before scraping exposed emails. |
| `ddg_collector.py` | Batch DuckDuckGo collector that writes SERP entries to JSON for further processing. |
| `extract_emails_helper.py` | Thin wrapper around the `extract-emails` package, used when we want a quick CSV extraction from a single URL. |
| `extract_emails_requests_helper.py` | Requests-based helper for the extractor pipeline. |
| `process_search_results.py` | Takes SERP JSON (Google or DuckDuckGo), crawls each site (contact/about pages included), and writes discovered emails to CSV. |
| `deep_email_harvester.py` | One-stop pipeline: collect DuckDuckGo results for many queries and harvest aviation emails in a single pass. |
| `run_aircharterguide_extractor.py` | Launches the packaged Air Charter Guide extractor (headless Chrome) for a given country. |
| `run_aircharterguide_ultimate.py` | Extended version of the Air Charter Guide run helper with additional crawling knobs. |
| `search_based_extractor.py` | Stealth Google + open-web scraper that discovers aviation emails across search results, directories, and associations. |

### Usage

All Python scripts assume you execute them from the project root:

```bash
python3 scripts/python/run_aircharterguide_extractor.py --country ae
python3 scripts/python/cloudflare_bypass_extractor.py --country ru
python3 scripts/python/search_based_extractor.py
python3 scripts/python/ddg_collector.py --queries "uae business aviation" "russia private jet" --region ru-ru --limit 80
python3 scripts/python/process_search_results.py --max-pages 5
python3 scripts/python/deep_email_harvester.py --queries-file queries/ru.txt --region ru-ru --limit 80 --require .ru air avia
```

## TypeScript (`scripts/typescript/`)

| Script | Purpose |
| --- | --- |
| `generateUaeSeeds.ts` | Generates fresh seed configurations for UAE crawls. |
| `googleSearch.ts` | Performs Google Programmable Search when API keys are present, or falls back to DuckDuckGo and Bing scraping when they are not. |
| `mergeScrapyEmails.ts` | Consolidates email outputs (`output/`) into the master `emails.txt` roll-up. |

### Usage

These scripts are wired into `package.json` for convenience:

```bash
npm run generate:uae
npm run search:google -- --queries "airline contact uae" --limit 10
npm run update:emails
```

You can also execute them directly with `tsx` (the DuckDuckGo fallback is automatic when Google keys are absent):

```bash
npx tsx scripts/typescript/googleSearch.ts --queries "private jet dubai"
```


