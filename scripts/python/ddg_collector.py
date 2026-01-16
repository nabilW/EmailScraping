#!/usr/bin/env python3
"""
Collect DuckDuckGo search results for a batch of queries and write them to JSON.
The output structure matches the format consumed by `process_search_results.py`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable, List, Set

from duckduckgo_search import DDGS

WORKDIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUTPUT = WORKDIR / "output" / "duckduckgo-results.json"


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Collect DuckDuckGo SERP entries.")
  parser.add_argument(
    "--queries",
    nargs="+",
    required=True,
    help="List of query strings (wrap phrases in quotes).",
  )
  parser.add_argument(
    "--region",
    default="wt-wt",
    help="DuckDuckGo region code (e.g., ru-ru, ae-en, wt-wt). Default: %(default)s",
  )
  parser.add_argument(
    "--limit",
    type=int,
    default=50,
    help="Maximum results per query (default: %(default)s)",
  )
  parser.add_argument(
    "--output",
    default=DEFAULT_OUTPUT,
    help="Output JSON path (default: %(default)s)",
  )
  return parser.parse_args(argv)


def gather_results(queries: List[str], region: str, limit: int) -> List[dict]:
  collected: List[dict] = []
  seen_urls: Set[str] = set()

  with DDGS() as ddgs:
    for query in queries:
      for item in ddgs.text(query, region=region, safesearch="off", max_results=limit):
        url = item.get("href") or item.get("url")
        if not url or url in seen_urls:
          continue
        seen_urls.add(url)
        collected.append(
          {
            "query": query,
            "title": item.get("title") or "",
            "description": item.get("body") or "",
            "url": url,
            "domain": item.get("domain") or "",
            "source": "duckduckgo",
          }
        )
  return collected


def main(argv: Iterable[str] | None = None) -> int:
  args = parse_args(argv)
  output_path = Path(args.output)
  output_path.parent.mkdir(parents=True, exist_ok=True)

  results = gather_results(args.queries, args.region, max(args.limit, 1))
  if not results:
    print("No results retrieved.")
    return 0

  output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
  print(f"Wrote {len(results)} entries to {output_path}")
  return 0


if __name__ == "__main__":
  import sys

  sys.exit(main())


