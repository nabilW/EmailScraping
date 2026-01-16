#!/usr/bin/env python3
"""
Generate comprehensive queries by combining countries with keywords.
"""

from pathlib import Path
import random

def load_lines(file_path: Path) -> list[str]:
    """Load lines from a text file, filtering out empty lines and comments."""
    if not file_path.exists():
        return []
    
    lines = []
    for line in file_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            lines.append(line)
    return lines

def generate_queries(countries: list[str], keywords: list[str], max_queries: int = 500) -> list[str]:
    """Generate targeted aviation queries combining countries with keywords."""
    queries = []
    
    # Core templates for contact discovery
    templates = [
        '"{keyword}" "{country}" "contact" email',
        '"{keyword}" "{country}" "email address" contact',
        '"{keyword}" "{country}" "get in touch" email',
        '"{keyword}" "{country}" "contact us" email',
        '"{keyword}" "{country}" "email us" contact',
        '"{keyword}" "{country}" "contact details" email',
        '"{keyword}" "{country}" "contact form" email',
        '"{keyword}" "{country}" "get quote" email',
        '"{keyword}" "{country}" email inquire',
        'site:.{tld} "{keyword}" email contact',
        'site:.{tld} "{keyword}" "contact us"',
        'site:.{tld} "{keyword}" "email address"',
    ]
    
    # Country TLD mapping for site-specific searches
    tld_map = {
        'South Africa': 'za', 'Kenya': 'ke', 'Nigeria': 'ng', 'Ghana': 'gh',
        'Uganda': 'ug', 'Tanzania': 'tz', 'Egypt': 'eg',
        'Tunisia': 'tn', 'Libya': 'ly', 'Mauritius': 'mu', 'Seychelles': 'sc',
        'Botswana': 'bw', 'Namibia': 'na', 'Zambia': 'zm', 'Zimbabwe': 'zw',
        'Rwanda': 'rw', 'Ethiopia': 'et', 'Mozambique': 'mz', 'Angola': 'ao',
        'Cameroon': 'cm', 'Senegal': 'sn', 'Mali': 'ml', 'Burkina Faso': 'bf',
        'Niger': 'ne', 'Chad': 'td', 'Sudan': 'sd', 'Somalia': 'so',
        'Djibouti': 'dj', 'Eritrea': 'er', 'Madagascar': 'mg', 'Malawi': 'mw',
        'Gabon': 'ga', 'Republic of the Congo': 'cg', 'Côte d\'Ivoire': 'ci',
        'Guinea': 'gn', 'Sierra Leone': 'sl', 'Liberia': 'lr', 'Togo': 'tg',
        'Benin': 'bj', 'Central African Republic': 'cf'
    }
    
    for country in countries:
        for keyword in keywords:
            tld = tld_map.get(country, 'com')
            
            for template in templates:
                query = template.format(
                    keyword=keyword,
                    country=country,
                    tld=tld
                )
                queries.append(query)
                
                if len(queries) >= max_queries:
                    break
            
            if len(queries) >= max_queries:
                break
        
        if len(queries) >= max_queries:
            break
    
    # Shuffle to avoid pattern detection
    random.shuffle(queries)
    return queries[:max_queries]

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate queries for countries')
    parser.add_argument('--countries', default='queries/africa_countries.txt', 
                       help='Path to countries list file')
    parser.add_argument('--keywords', default='queries/keywords.txt',
                       help='Path to keywords file') 
    parser.add_argument('--output', default='queries/africa_generated.txt',
                       help='Output file for generated queries')
    parser.add_argument('--max-queries', type=int, default=500,
                       help='Maximum number of queries to generate')
    
    args = parser.parse_args()
    
    countries = load_lines(Path(args.countries))
    keywords = load_lines(Path(args.keywords))
    
    print(f"Loaded {len(countries)} countries and {len(keywords)} keywords")
    
    queries = generate_queries(countries, keywords, args.max_queries)
    
    Path(args.output).write_text('\n'.join(queries) + '\n', encoding='utf-8')
    
    print(f"Generated {len(queries)} queries saved to {args.output}")

if __name__ == "__main__":
    main()