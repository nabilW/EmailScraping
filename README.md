# 📧 Email Scraping Toolkit

<div align="center">

**A comprehensive, educational toolkit for discovering, extracting, enriching, and validating business contact information from web sources.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Educational](https://img.shields.io/badge/Purpose-Educational-purple.svg)](LICENSE)

> ⚠️ **Educational Purpose Only** - This project is intended for learning and educational purposes. Users must comply with all applicable laws, respect robots.txt, website terms of service, and obtain proper consent before collecting personal information.

</div>

---

## 📖 About

**Email Scraping** is a unified, production-ready toolkit that combines multiple proven approaches to business contact discovery and validation. This educational project demonstrates modern web scraping techniques, email extraction methods, deliverability verification, and data enrichment workflows.

### What This Project Does

This toolkit provides a complete pipeline for:

- 🔍 **Business Discovery**: Find businesses using Google Maps Places API or manual targeting
- 🕷️ **Web Crawling**: Recursively crawl websites with controlled depth and domain scoping
- 📧 **Email Extraction**: Multi-layer extraction using regex, DOM parsing, attribute scanning, and obfuscation decoding
- ✅ **Deliverability Verification**: SMTP handshake testing with MX record resolution
- 🌐 **Domain Validation**: HTTP reachability checks to ensure websites are active
- 💾 **Data Export**: Flexible output formats (JSON, CSV, Excel) for downstream integration

### Why This Project Exists

Lead generation workflows often require stitching together multiple utilities: map prospecting, HTML scraping, enrichment, and deliverability checks. This project merges proven ideas from community-built tools like:

- [Map Email Scraper](https://github.com/MickeyUK/map-email-scraper) - Google Maps prospecting
- [MailScout](https://github.com/batuhanaky/mailscout) - Deliverability probing patterns
- [e-scraper](https://github.com/0x4D-5A/e-scraper) - Web crawling utilities
- [crawler-python](https://github.com/andripwn/crawler-python) - Recursive crawling strategies

All integrated into a modern TypeScript pipeline with performance optimizations, caching, and database storage.

### Key Features

| Feature | Description |
|---------|-------------|
| 🗺️ **Google Maps Discovery** | Text search via Places API with pagination and rate limiting |
| 🔄 **Recursive Web Crawling** | Controlled depth, domain scoping, and external link filtering |
| 📧 **Multi-Layer Extraction** | Regex, DOM parsing, attribute scans, base64/unicode decoding |
| ✅ **SMTP Deliverability** | MX resolution with progressive failover and SMTP handshake |
| 🌐 **HTTP Validation** | Probes production and dev hostnames for reachability |
| 💾 **Flexible Export** | JSON, CSV, and Excel output for CRM integration |
| 🚀 **Performance Optimized** | LRU caching, connection pooling, parallel processing |
| 🗄️ **Database Storage** | SQLite integration for large-scale datasets |

---

## 🏗️ Architecture Overview

The project follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                  │
│              (EmailScrapingPipeline)                      │
└──────────────┬──────────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐  ┌──▼───┐  ┌───▼────┐
│Scraper│  │Extract│  │Verify  │
│       │  │       │  │        │
│• Maps │  │• Regex│  │• SMTP  │
│• Web  │  │• DOM  │  │• HTTP  │
└───┬───┘  └───┬───┘  └───┬────┘
    │          │          │
    └──────────┼──────────┘
               │
        ┌──────▼──────┐
        │ ResultStore │
        │             │
        │• JSON       │
        │• CSV        │
        │• Excel      │
        │• Database   │
        └─────────────┘
```

### Core Modules

| Module | Responsibility | Key Technologies |
|--------|---------------|-----------------|
| `GoogleMapsScraper` | Text search via Places API, pagination, rate limiting | Google Places API |
| `WebCrawler` | Bounded-depth recursive crawling with external link guard | Playwright, Cheerio |
| `EmailExtractor` | Multi-pass extraction (mailto, text, obfuscation decoding) | Regex, DOM parsing |
| `DeliverabilityChecker` | MX lookup + SMTP handshake with progressive fallback | DNS, SMTP client |
| `HttpDomainValidator` | HEAD/GET probes to confirm prod/dev web hosts respond | HTTP/HTTPS |
| `ResultStore` | JSON/CSV/Excel export with optional database storage | SQLite, CSV/Excel writers |
| `CacheManager` | LRU caching for HTTP, DNS, and HTML responses | In-memory LRU cache |
| `EmailScrapingPipeline` | Orchestrates data flow, deduplication, and persistence | Promise pooling |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.18.0 or higher
- **npm** or **yarn** or **pnpm**
- (Optional) **Python 3.10+** for Python helper scripts
- (Optional) **Google Maps API Key** for Places discovery

### Installation

```bash
# Clone the repository
git clone https://github.com/nabilW/EmailScraping.git
cd EmailScraping

# Install dependencies
npm install
# or
pnpm install
# or
yarn install
```

### Configuration

1. **Copy the example environment file:**
   ```bash
   cp config/example.env .env
   ```

2. **Edit `.env` with your configuration:**
   ```env
   # Optional: Google Maps Places API (for business discovery)
   GOOGLE_MAPS_API_KEY=your_api_key_here

   # Required: SMTP deliverability probing
   SMTP_PROBE_FROM=your-email@example.com
   SMTP_PROBE_HELLO=your-domain.com

   # Optional: Database storage
   USE_DATABASE=true
   DATABASE_PATH=./output/emails.db
   ```

### Quick Start Examples

#### Basic Usage - Search by Term and Location

```bash
npm run dev -- --term "business services" --location "New York" --country us
```

#### Require Website Reachability

Only keep emails from websites that respond with 2xx/3xx status codes:

```bash
npm run dev -- --term "consulting" --require-reachable
```

#### Skip Dev Subdomain Probing

Avoid false positives from internal development hosts:

```bash
npm run dev -- --term "business" --skip-dev-subdomain
```

#### Manual Website Targeting

When you already know the domains you want to crawl:

```bash
npm run dev -- --website https://example.com --require-reachable
```

#### Batch Processing with Query File

Create a JSON file with multiple queries:

```json
[
  { "term": "business services", "location": "New York", "countryCode": "us" },
  { "term": "consulting", "location": "London", "countryCode": "gb" },
  { "term": "technology", "location": "San Francisco", "countryCode": "us" }
]
```

```bash
npm run dev -- --queries ./queries.json
```

#### Using Seed Files

For more control, use seed files with additional configuration:

```json
[
  {
    "name": "Example Company",
    "website": "https://www.example.com",
    "extraPaths": [
      "/contact",
      "/about",
      "/team"
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

```bash
npm run dev -- --seed config/seeds/example.json --require-reachable
```

**Seed File Options:**
- `extraPaths` or `extraUrls` – Additional landing pages to crawl (contact, media, etc.)
- `seedEmails` – Known good addresses to bootstrap the dataset
- `allowedDomains` – Restrict scraped emails to specific domains

### Output Files

The pipeline generates several output files in the `output/` directory:

- `results.json` – Complete structured data with metadata
- `results.csv` – Spreadsheet-friendly format
- `results.xlsx` – Excel workbook with formatted data
- `emails.txt` – Simple one-email-per-line format, deduplicated
- `emails.db` – SQLite database (if database storage is enabled)

---

## 📁 Repository Structure

```
EmailScraping/
├── 📂 config/                     # Configuration templates
│   └── example.env                # Environment variables template
│
├── 📂 docs/                        # Additional documentation
│   └── WORKFLOWS.md               # Detailed workflow documentation
│
├── 📂 output/                      # Generated outputs
│   ├── results.json               # Main JSON output
│   ├── results.csv                # CSV export
│   ├── results.xlsx               # Excel export
│   ├── emails.txt                 # Simple email list
│   ├── emails.db                  # SQLite database (optional)
│   ├── logs/                      # Application logs
│   └── extract-emails/            # Python extract-emails outputs
│
├── 📂 queries/                     # Query files for batch processing
│   ├── africa_countries.txt
│   ├── middle_east_africa.txt
│   └── ...
│
├── 📂 scripts/                     # Helper scripts
│   ├── 📂 python/                 # Python utilities
│   │   ├── extract_emails_helper.py
│   │   ├── verify_emails.py
│   │   └── ...
│   ├── 📂 typescript/             # TypeScript automation
│   │   ├── googleSearch.ts
│   │   ├── mergeScrapyEmails.ts
│   │   └── ...
│   └── README.md                  # Script documentation
│
├── 📂 scrapy/                      # Scrapy spiders for bulk crawling
│   └── uae_airlines_crawler/
│       └── uae_airlines_crawler/
│           └── spiders/
│               └── multi_contacts.py
│
├── 📂 src/                         # Main TypeScript application
│   ├── 📂 extractors/             # Email extraction logic
│   ├── 📂 pipeline/               # Main pipeline orchestration
│   ├── 📂 scrapers/                # Web scraping modules
│   ├── 📂 storage/                 # Data persistence
│   ├── 📂 utils/                   # Utilities (cache, logger)
│   ├── 📂 verifiers/               # Validation modules
│   └── index.ts                    # Entry point
│
├── 📂 tests/                       # Unit and integration tests
│   └── EmailExtractor.test.ts
│
├── 📄 README.md                    # This file
├── 📄 LICENSE                      # MIT License
├── 📄 CONTRIBUTING.md              # Contribution guidelines
├── 📄 package.json                 # Node.js dependencies
└── 📄 tsconfig.json                # TypeScript configuration
```

> 💡 **Tip**: Check `scripts/README.md` for detailed documentation on all helper scripts and example invocations.

---

## 🔧 Advanced Usage

### Google Search Discovery

Discover new domains before running the pipeline:

```bash
# Inline queries (comma separated)
npm run search:google -- --queries "business services,consulting companies" --limit 20

# Or use a configuration file
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

**Output Files:**
- `output/google-search-results.json` – Full Google SERP entries
- `output/google-search-domains.{txt,json}` – Deduplicated hostnames

> 💡 **Tip**: For best results, provide Google Programmable Search credentials:
> ```bash
> export GOOGLE_API_KEY="your-api-key"
> export GOOGLE_CSE_ID="your-search-engine-id"
> ```

### Python `extract-emails` Integration

Enrich your dataset with the Python [`extract-emails`](https://pypi.org/project/extract-emails/) scraper:

1. **Set up Python environment:**
   ```bash
   python3 -m venv .venv-extract
   source .venv-extract/bin/activate
   pip install "extract-emails>=5.3.3"
   ```

2. **Run the helper:**
   ```bash
   python -m extract_emails.console.application \
     --url https://www.example.com/contact \
     --browser-name requests \
     --depth 1 \
     --output-file output/extract-emails/example.csv
   ```

3. **Merge into main archive:**
   ```bash
   npm run update:emails
   ```

The merger automatically handles duplicates, enforces `allowedDomains`, and maintains alphabetical order.

### Scrapy-Based Crawling

For deeper harvesting on JavaScript-heavy sites, use the Scrapy project:

1. **Activate virtual environment:**
   ```bash
   cd scrapy
   source .venv/bin/activate
   ```

2. **Run a spider:**
   ```bash
   cd uae_airlines_crawler
   scrapy crawl multi_contacts -O ../../output/contacts.jsonl
   ```

3. **Merge with TypeScript pipeline:**
   ```bash
   npm run update:emails
   ```

The spider respects depth limits, filters placeholder emails, and follows configured domains.

---

## 🎯 Performance Optimizations

This project includes several performance optimizations:

- **LRU Caching**: HTTP responses, DNS lookups, and HTML content are cached
- **Connection Pooling**: Persistent HTTP/HTTPS connections for faster requests
- **Parallel Processing**: Controlled concurrency using Promise pools
- **Database Storage**: SQLite for efficient large-scale data management
- **Memory Management**: Smart in-memory limits with database fallback

---

## 🧪 Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 📝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and linting (`npm test && npm run lint`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

---

## 🗺️ Roadmap

Future enhancements under consideration:

- 🔄 Google My Business session scraping for UI parity
- 🎭 Enhanced Playwright-based JavaScript rendering for SPAs
- 🔌 Pluggable deliverability providers (ZeroBounce, NeverBounce, etc.)
- 🌐 REST API & dashboard frontend
- 📊 Advanced analytics and reporting
- 🔐 Enhanced security and rate limiting

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### Educational Purpose Disclaimer

This project is intended for **educational purposes only**. Users are responsible for:

- ✅ Complying with all applicable laws and regulations regarding web scraping
- ✅ Respecting `robots.txt` and website terms of service
- ✅ Obtaining proper consent before collecting personal information
- ✅ Using collected data ethically and responsibly

The authors and contributors are not responsible for any misuse of this software.

---

## 🙏 Acknowledgments

This project draws inspiration from several open-source projects:

- [Map Email Scraper](https://github.com/MickeyUK/map-email-scraper) - Google Maps prospecting patterns
- [MailScout](https://github.com/batuhanaky/mailscout) - Deliverability verification approaches
- [e-scraper](https://github.com/0x4D-5A/e-scraper) - Web crawling utilities
- [crawler-python](https://github.com/andripwn/crawler-python) - Recursive crawling strategies
- [TS-email-scraper](https://github.com/eneiromatos/TS-email-scraper) - TypeScript email extraction patterns

---

## 📞 Support

For questions, issues, or contributions:

- 📧 Open an [Issue](https://github.com/nabilW/EmailScraping/issues)
- 🔀 Submit a [Pull Request](https://github.com/nabilW/EmailScraping/pulls)
- 📖 Check the [Documentation](docs/WORKFLOWS.md)

---

<div align="center">

**Made with ❤️ for educational purposes**

⭐ Star this repo if you find it helpful!

</div>
