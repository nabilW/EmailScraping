import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

interface ScrapedRecord {
  email?: string;
  source_url?: string;
  company?: string;
}

const WORKDIR = process.cwd();
const OUTPUT_DIR = join(WORKDIR, 'output');
const TARGET_FILE = join(OUTPUT_DIR, 'emails.txt');
const SEED_FILE = join(WORKDIR, 'config', 'seeds', 'example.json');
const EXTRACT_EMAILS_DIR = join(OUTPUT_DIR, 'extract-emails');

const SCRAPY_FILES = [
  'contacts.jsonl',
  'multi_contacts.jsonl'
];

const PLACEHOLDER_PATTERNS = [
  'example',
  'test@',
  'domain.com',
  'providername',
  'johnsmith'
];

const BUSINESS_KEYWORDS = [
  'business',
  'company',
  'corp',
  'enterprise',
  'services',
  'solutions',
  'group',
  'holdings',
  'industries'
];

const TRUSTED_LOCAL_PREFIXES = [
  'info',
  'sales',
  'support',
  'contact',
  'hello',
  'inquiry',
  'admin',
  'office',
  'service'
];

const PRIORITY_TLDS = new Set([
  'ru',
  'su',
  'ae',
  'qa',
  'om',
  'sa',
  'bh',
  'kw',
  'aero',
  'za',
  'zm',
  'zw',
  'ng',
  'gh',
  'ke',
  'ug',
  'tz',
  'et',
  'er',
  'dj',
  'sd',
  'ss',
  'eg',
  'ly',
  'tn',
  'ao',
  'na',
  'bw',
  'mz',
  'mw',
  'mg',
  'ga',
  'cm',
  'cg',
  'cd',
  'cf',
  'td',
  'ne',
  'ml',
  'bf',
  'ci',
  'gn',
  'gw',
  'gm',
  'sl',
  'lr',
  'gh',
  'bj',
  'tg',
  'sn',
  'mr',
  'st',
  'gq',
  'cv',
  'sc',
  'mu',
  'km',
  'sz',
  'ls',
  'bw',
  'za',
  'zw',
  'rw',
  'bi',
  'so',
  'ke',
  'ug'
]);

const GENERIC_DOMAINS = new Set([
  'facebook.com',
  'twitter.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'google.com',
  'maps.google.com'
]);

function loadExistingEmails(): Set<string> {
  if (!existsSync(TARGET_FILE)) {
    return new Set<string>();
  }
  const content = readFileSync(TARGET_FILE, 'utf-8');
  const allowed = allowedDomains();
  const sanitized = content
    .split(/\r?\n/)
    .map((line) => sanitizeEmail(line))
    .filter((email): email is string => Boolean(email) && isAllowedEmail(email, allowed));
  return new Set(sanitized);
}

function loadScrapyEmails(): Set<string> {
  const emails = new Set<string>();
  const allowed = allowedDomains();
  for (const file of SCRAPY_FILES) {
    const path = join(OUTPUT_DIR, file);
    if (!existsSync(path)) {
      continue;
    }
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ScrapedRecord;
        const email = sanitizeEmail(record.email ?? '');
        if (email && isAllowedEmail(email, allowed) && isValidEmail(email)) {
          emails.add(email);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to parse line from ${file}:`, line);
      }
    }
  }
  return emails;
}

function loadPythonExtractedEmails(): Set<string> {
  const emails = new Set<string>();
  if (!existsSync(EXTRACT_EMAILS_DIR)) {
    return emails;
  }
  const allowed = allowedDomains();
  const candidates = readdirSync(EXTRACT_EMAILS_DIR).filter((file) => file.toLowerCase().endsWith('.csv'));

  for (const file of candidates) {
    const path = join(EXTRACT_EMAILS_DIR, file);
    const content = readFileSync(path, 'utf-8');
    if (!content.trim()) continue;

    try {
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
      }) as Array<Record<string, unknown>>;

      for (const record of records) {
        for (const [key, value] of Object.entries(record)) {
          if (!key || !/email/i.test(key)) continue;
          if (typeof value !== 'string') continue;
          const email = sanitizeEmail(value);
          if (email && isAllowedEmail(email, allowed) && isValidEmail(email)) {
            emails.add(email);
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to parse extract-emails csv: ${file}`, error);
    }
  }

  return emails;
}

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

let cachedAllowedDomains: Set<string> | null = null;

function allowedDomains(): Set<string> {
  if (cachedAllowedDomains) {
    return cachedAllowedDomains;
  }
  const domains = new Set<string>();
  if (!existsSync(SEED_FILE)) {
    cachedAllowedDomains = domains;
    return domains;
  }
  const seeds = JSON.parse(readFileSync(SEED_FILE, 'utf-8')) as Array<Record<string, unknown>>;
  for (const seed of seeds) {
    const extra = seed.allowedDomains as string[] | undefined;
    if (Array.isArray(extra)) {
      for (const domain of extra) {
        if (domain) domains.add(domain.toLowerCase());
      }
    } else {
      const website = typeof seed.website === 'string' ? seed.website : '';
      const domain = domainOf(website);
      if (domain) domains.add(domain);
    }
  }
  cachedAllowedDomains = domains;
  return domains;
}

function domainOf(emailOrUrl: string): string {
  const atIndex = emailOrUrl.indexOf('@');
  if (atIndex !== -1) {
    return emailOrUrl.slice(atIndex + 1).toLowerCase();
  }
  try {
    const url = new URL(emailOrUrl);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function topLevelDomain(domain: string): string {
  const parts = domain.split('.');
  return parts.length ? parts[parts.length - 1] : '';
}

function looksBusiness(email: string): boolean {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return false;
  const combined = `${localPart}.${domain}`;
  if (BUSINESS_KEYWORDS.some((keyword) => combined.includes(keyword))) {
    return true;
  }
  return TRUSTED_LOCAL_PREFIXES.some((prefix) => localPart.startsWith(prefix));
}

function isAllowedEmail(email: string, allowed: Set<string>): boolean {
  const domain = domainOf(email);
  if (!domain || GENERIC_DOMAINS.has(domain)) {
    return false;
  }
  if (allowed.has(domain)) {
    return true;
  }
  const tld = topLevelDomain(domain);
  if (PRIORITY_TLDS.has(tld)) {
    return true;
  }
  return looksBusiness(email);
}

function isValidEmail(email: string): boolean {
  if (!EMAIL_REGEX.test(email)) {
    return false;
  }
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (email.includes(pattern)) {
      return false;
    }
  }
  return true;
}

function sanitizeEmail(raw: string): string | undefined {
  if (!raw) return undefined;
  let email = raw.trim().toLowerCase();
  if (!email) return undefined;
  email = email.replace(/^u003e+/g, '');
  email = email.replace(/u003e/g, '');
  if (!EMAIL_REGEX.test(email)) {
    return undefined;
  }
  return email;
}

function main() {
  const baseline = loadExistingEmails();
  const scraped = loadScrapyEmails();
  const pythonExtracted = loadPythonExtractedEmails();
  const combined = new Set<string>([...baseline, ...scraped, ...pythonExtracted]);

  const sorted = Array.from(combined).sort((a, b) => a.localeCompare(b));
  const payload = sorted.join('\n') + (sorted.length ? '\n' : '');
  writeFileSync(TARGET_FILE, payload, 'utf-8');

  // eslint-disable-next-line no-console
  console.log(
    `Merged email list written to ${TARGET_FILE} (baseline ${baseline.size}, scrapy ${scraped.size}, python ${pythonExtracted.size}, total ${sorted.length}).`
  );
}

main();

