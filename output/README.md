# Output Directory

This directory contains all scraped data and logs from email scraping operations.

## Structure

- `emails.txt` - Main consolidated email list
- `dataemails.txt` - Archive of all collected emails
- `results.json` - JSON format results
- `results.csv` - CSV format results
- `results.xlsx` - Excel format results
- `logs/` - Log files from scraping sessions
- `extract-emails/` - CSV outputs from Python extract-emails tool
- `archive/` - Archived email collections

## Note

All files in this directory are excluded from version control via `.gitignore` to protect privacy and prevent accidental commits of scraped data.
