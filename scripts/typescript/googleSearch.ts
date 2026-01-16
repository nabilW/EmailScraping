import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { search as googleSearchScraper } from 'googlethis';
import { load } from 'cheerio';

interface GoogleSearchConfig {
  queries: string[];
  resultsPerQuery?: number;
  language?: string;
  safeMode?: boolean;
  output?: string;
  domainsOutput?: string;
}

interface CliOptions {
  queries: string[];
  inputPath?: string;
  resultsPerQuery?: number;
  language?: string;
  safeMode?: boolean;
  output?: string;
  domainsOutput?: string;
}

interface SearchResultEntry {
  query: string;
  title: string;
  description: string;
  url: string;
  domain: string;
}

const DEFAULT_RESULTS_PER_QUERY = 20;
const WORKDIR = process.cwd();
const OUTPUT_DIR = join(WORKDIR, 'output');
const DEFAULT_RESULTS_PATH = join(OUTPUT_DIR, 'google-search-results.json');
const DEFAULT_DOMAINS_PATH = join(OUTPUT_DIR, 'google-search-domains.txt');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    queries: []
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--queries' && args[i + 1]) {
      const list = args[++i]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      options.queries.push(...list);
    } else if (arg === '--input' && args[i + 1]) {
      options.inputPath = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      options.resultsPerQuery = Number.parseInt(args[++i] ?? '', 10);
    } else if (arg === '--language' && args[i + 1]) {
      options.language = args[++i];
    } else if (arg === '--safe' && args[i + 1]) {
      options.safeMode = args[++i].toLowerCase() !== 'false';
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--domains-output' && args[i + 1]) {
      options.domainsOutput = args[++i];
    }
  }

  return options;
}

function readConfigFromFile(path: string): Partial<GoogleSearchConfig> {
  const filePath = resolve(WORKDIR, path);
  if (!existsSync(filePath)) {
    throw new Error(`Google search input file not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<GoogleSearchConfig>;
  return parsed;
}

function mergeConfig(cli: CliOptions, fileConfig?: Partial<GoogleSearchConfig>): GoogleSearchConfig {
  const config: GoogleSearchConfig = {
    queries: [],
    resultsPerQuery: DEFAULT_RESULTS_PER_QUERY,
    language: 'en',
    safeMode: false,
    output: DEFAULT_RESULTS_PATH,
    domainsOutput: DEFAULT_DOMAINS_PATH
  };

  if (fileConfig) {
    if (Array.isArray(fileConfig.queries)) {
      config.queries.push(...fileConfig.queries.filter(Boolean));
    }
    if (fileConfig.resultsPerQuery) config.resultsPerQuery = fileConfig.resultsPerQuery;
    if (fileConfig.language) config.language = fileConfig.language;
    if (typeof fileConfig.safeMode === 'boolean') config.safeMode = fileConfig.safeMode;
    if (fileConfig.output) config.output = resolve(WORKDIR, fileConfig.output);
    if (fileConfig.domainsOutput) config.domainsOutput = resolve(WORKDIR, fileConfig.domainsOutput);
  }

  if (cli.queries.length) {
    config.queries.push(...cli.queries);
  }
  if (cli.resultsPerQuery) config.resultsPerQuery = cli.resultsPerQuery;
  if (cli.language) config.language = cli.language;
  if (typeof cli.safeMode === 'boolean') config.safeMode = cli.safeMode;
  if (cli.output) config.output = resolve(WORKDIR, cli.output);
  if (cli.domainsOutput) config.domainsOutput = resolve(WORKDIR, cli.domainsOutput);

  config.queries = Array.from(new Set(config.queries.map((item) => item.trim()).filter(Boolean)));

  if (!config.queries.length) {
    throw new Error(
      'No queries supplied. Use --queries "term1,term2" or provide an --input JSON file with a "queries" array.'
    );
  }

  return config;
}

function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function normaliseDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

async function searchWithProgrammableSearch(query: string, config: GoogleSearchConfig): Promise<SearchResultEntry[]> {
  const apiKey =
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_CSE_KEY ??
    process.env.CSE_API_KEY ??
    process.env.GOOGLE_SEARCH_API_KEY ??
    process.env.GOOGLE_SEARCH_KEY;
  const cx =
    process.env.GOOGLE_CSE_ID ?? process.env.GOOGLE_SEARCH_ENGINE_ID ?? process.env.CX ?? process.env.CSE_ID ?? '';

  if (!apiKey || !cx) {
    return [];
  }

  const perQuery = Math.max(1, config.resultsPerQuery ?? DEFAULT_RESULTS_PER_QUERY);
  const aggregated: SearchResultEntry[] = [];

  while (aggregated.length < perQuery) {
    const remaining = perQuery - aggregated.length;
    const num = Math.min(10, remaining);
    const start = aggregated.length + 1; // Custom Search is 1-indexed
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(num));
    url.searchParams.set('start', String(start));
    url.searchParams.set('lr', config.language ? `lang_${config.language}` : 'lang_en');

    // eslint-disable-next-line no-console
    console.log(`  • Programmable Search API request (start=${start}, num=${num})`);
    const response = await fetch(url);
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(
        `Programmable Search API error ${response.status} ${response.statusText} for query "${query}": ${payload}`
      );
    }
    const json = (await response.json()) as { items?: Array<Record<string, string>>; queries?: { nextPage?: unknown[] } };
    const items = json.items ?? [];
    for (const item of items) {
      const itemUrl = item.link ?? item.formattedUrl ?? '';
      const domain = normaliseDomain(itemUrl);
      if (!itemUrl || !domain) continue;
      aggregated.push({
        query,
        title: item.title ?? '',
        description: item.snippet ?? '',
        url: itemUrl,
        domain
      });
      if (aggregated.length >= perQuery) break;
    }
    if (!json.queries?.nextPage || items.length === 0) break;
  }

  return aggregated;
}

async function searchWithScraper(query: string, config: GoogleSearchConfig): Promise<SearchResultEntry[]> {
  try {
    const response = await googleSearchScraper(query, {
      safe: config.safeMode ? 'active' : 'off',
      parse_ads: false,
      use_mobile_ua: false,
      additional_params: {
        hl: config.language ?? 'en',
        gl: 'ae',
        num: config.resultsPerQuery ?? DEFAULT_RESULTS_PER_QUERY
      }
    });
    return (response.results ?? [])
      .map((item) => ({
        query,
        title: item.title ?? '',
        description: item.description ?? '',
        url: item.url ?? '',
        domain: normaliseDomain(item.url ?? '')
      }))
      .filter((entry) => entry.url && entry.domain);
  } catch (error) {
    console.error(`googlethis fallback failed for "${query}":`, error);
    return [];
  }
}

function resolveDuckDuckGoUrl(rawHref: string): string {
  try {
    const url = new URL(rawHref, 'https://duckduckgo.com');
    if (url.hostname.endsWith('duckduckgo.com')) {
      const redirected = url.searchParams.get('uddg');
      if (redirected) {
        return decodeURIComponent(redirected);
      }
    }
    return url.href;
  } catch {
    return rawHref;
  }
}

async function searchWithDuckDuckGo(query: string, config: GoogleSearchConfig): Promise<SearchResultEntry[]> {
  const perQuery = Math.max(1, config.resultsPerQuery ?? DEFAULT_RESULTS_PER_QUERY);
  const encoded = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${encoded}&num=${Math.min(perQuery, 30)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': config.language ?? 'en'
      }
    });
    if (!response.ok) {
      console.warn(`  • DuckDuckGo returned ${response.status} for "${query}".`);
      return [];
    }
    const html = await response.text();
    const $ = load(html);
    const results: SearchResultEntry[] = [];

    $('div.result').each((_, element) => {
      if (results.length >= perQuery) return false;
      const anchor = $(element).find('a.result__a').first();
      const href = anchor.attr('href');
      if (!href) return;
      const resolvedUrl = resolveDuckDuckGoUrl(href);
      const domain = normaliseDomain(resolvedUrl);
      if (!domain) return;
      const title = anchor.text().trim();
      const description =
        $(element).find('.result__snippet').text().trim() ||
        $(element).find('.result__url').text().trim() ||
        '';

      results.push({
        query,
        title,
        description,
        url: resolvedUrl,
        domain
      });
      return undefined;
    });

    return results;
  } catch (error) {
    console.warn(`  • DuckDuckGo scraping failed for "${query}":`, error);
    return [];
  }
}

async function searchWithBing(query: string, config: GoogleSearchConfig): Promise<SearchResultEntry[]> {
  const perQuery = Math.max(1, config.resultsPerQuery ?? DEFAULT_RESULTS_PER_QUERY);
  const encoded = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encoded}&count=${Math.min(perQuery, 20)}&setlang=${config.language ?? 'en'}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': config.language ?? 'en'
      }
    });
    if (!response.ok) {
      console.warn(`  • Bing returned ${response.status} for "${query}".`);
      return [];
    }
    const html = await response.text();
    const $ = load(html);
    const results: SearchResultEntry[] = [];

    $('li.b_algo').each((_, element) => {
      if (results.length >= perQuery) return false;
      const anchor = $(element).find('h2 > a').first();
      const href = anchor.attr('href');
      if (!href) return;
      const domain = normaliseDomain(href);
      if (!domain) return;

      const title = anchor.text().trim();
      const description =
        $(element).find('.b_caption p').text().trim() ||
        $(element).find('.b_snippet').text().trim() ||
        '';

      results.push({
        query,
        title,
        description,
        url: href,
        domain
      });
      return undefined;
    });

    return results;
  } catch (error) {
    console.warn(`  • Bing scraping failed for "${query}":`, error);
    return [];
  }
}

async function run() {
  const cli = parseCliArgs();
  const fileConfig = cli.inputPath ? readConfigFromFile(cli.inputPath) : undefined;
  const config = mergeConfig(cli, fileConfig);

  const allResults: SearchResultEntry[] = [];
  const domains = new Map<string, { count: number; firstQuery: string; urls: Set<string> }>();

  const apiKeyAvailable =
    (process.env.GOOGLE_API_KEY ??
      process.env.GOOGLE_CSE_KEY ??
      process.env.CSE_API_KEY ??
      process.env.GOOGLE_SEARCH_API_KEY ??
      process.env.GOOGLE_SEARCH_KEY) &&
    (process.env.GOOGLE_CSE_ID ?? process.env.GOOGLE_SEARCH_ENGINE_ID ?? process.env.CX ?? process.env.CSE_ID);

  for (const query of config.queries) {
    // eslint-disable-next-line no-console
    console.log(`Searching Google for "${query}"...`);
    try {
      const primaryResults = await searchWithProgrammableSearch(query, config);
      let results = primaryResults;

      if (!results.length) {
        if (apiKeyAvailable) {
          console.warn(`  • Programmable Search returned 0 items for "${query}". Falling back to scraping...`);
        } else {
          console.warn('  • GOOGLE_API_KEY / GOOGLE_CSE_ID not set. Using scraping fallback.');
        }
        results = await searchWithScraper(query, config);
      }

      if (!results.length) {
        console.warn(`  • Google scraping returned 0 items for "${query}". Trying DuckDuckGo.`);
        results = await searchWithDuckDuckGo(query, config);
      }

      if (!results.length) {
        console.warn(`  • DuckDuckGo returned 0 items for "${query}". Trying Bing.`);
        results = await searchWithBing(query, config);
      }

      for (const item of results) {
        allResults.push(item);

        if (!domains.has(item.domain)) {
          domains.set(item.domain, { count: 0, firstQuery: item.query, urls: new Set<string>() });
        }
        const entry = domains.get(item.domain)!;
        entry.count += 1;
        entry.urls.add(item.url);
      }
    } catch (error) {
      console.error(`Google search failed for query "${query}":`, error);
    }
  }

  ensureDir(config.output!);
  ensureDir(config.domainsOutput!);

  const dedupedResults = Array.from(
    allResults.reduce((map, entry) => {
      const key = entry.url.toLowerCase();
      if (!map.has(key)) {
        map.set(key, entry);
      }
      return map;
    }, new Map<string, SearchResultEntry>())
  ).map(([, value]) => value);

  const sortedResults = dedupedResults.sort(
    (a, b) => a.query.localeCompare(b.query) || a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url)
  );
  writeFileSync(config.output!, JSON.stringify(sortedResults, null, 2), 'utf-8');

  const sortedDomains = Array.from(domains.entries())
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([domain, info]) => ({
      domain,
      occurrences: info.count,
      query: info.firstQuery,
      sampleUrls: Array.from(info.urls).slice(0, 5)
    }));

  writeFileSync(config.domainsOutput!, sortedDomains.map((entry) => entry.domain).join('\n') + '\n', 'utf-8');

  const domainsJsonPath = config.domainsOutput!.replace(/\.txt$/i, '.json');
  writeFileSync(domainsJsonPath, JSON.stringify(sortedDomains, null, 2), 'utf-8');

  console.log(
    `Google search finished: ${sortedResults.length} unique URLs across ${config.queries.length} queries.\n` +
      `- Detailed results: ${config.output}\n- Domains list: ${config.domainsOutput}\n- Domains metadata: ${domainsJsonPath}`
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


