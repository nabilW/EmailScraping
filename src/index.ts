#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { EmailScrapingPipeline } from './pipeline/Pipeline.js';
import { BusinessLocation, SearchQuery } from './types.js';
import { logger } from './utils/logger.js';

interface CLIOptions {
  queriesFile?: string;
  term?: string;
  location?: string;
  countryCode?: string;
  dryRun?: boolean;
  requireReachableDomain?: boolean;
  checkDevSubdomain?: boolean;
  seedFile?: string;
  websites?: string[];
  stopAfterFirstEmail?: boolean;
  allowSalesAddresses?: boolean;
}

function parseArgs(argv: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--queries' || arg === '-q') {
      options.queriesFile = argv[++i];
    } else if (arg === '--term' || arg === '-t') {
      options.term = argv[++i];
    } else if (arg === '--location' || arg === '-l') {
      options.location = argv[++i];
    } else if (arg === '--country' || arg === '-c') {
      options.countryCode = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--require-reachable') {
      options.requireReachableDomain = true;
    } else if (arg === '--skip-dev-subdomain') {
      options.checkDevSubdomain = false;
    } else if (arg === '--seed' || arg === '--seed-file') {
      options.seedFile = argv[++i];
    } else if (arg === '--website' || arg === '-w') {
      const value = argv[++i];
      if (!value) {
        throw new Error('Missing value for --website flag');
      }
      options.websites = options.websites ?? [];
      options.websites.push(value);
    } else if (arg === '--keep-crawling') {
      options.stopAfterFirstEmail = false;
    } else if (arg === '--stop-after-first') {
      options.stopAfterFirstEmail = true;
    } else if (arg === '--include-sales') {
      options.allowSalesAddresses = true;
    }
  }

  return options;
}

function loadQueries(options: CLIOptions): SearchQuery[] {
  if (options.queriesFile) {
    if (!existsSync(options.queriesFile)) {
      throw new Error(`Queries file not found: ${options.queriesFile}`);
    }
    const content = readFileSync(options.queriesFile, 'utf8');
    const parsed = JSON.parse(content) as Array<Partial<SearchQuery>>;
    return parsed.map((item) => ({
      id: item.id ?? randomUUID(),
      term: item.term ?? options.term ?? 'email',
      ...(item.location ?? options.location ? { location: item.location ?? options.location } : {}),
      ...(item.countryCode ?? options.countryCode ? { countryCode: item.countryCode ?? options.countryCode } : {})
    }));
  }

  if (options.term) {
    return [
      {
        id: randomUUID(),
        term: options.term,
        ...(options.location ? { location: options.location } : {}),
        ...(options.countryCode ? { countryCode: options.countryCode } : {})
      }
    ];
  }

  return [
    {
      id: randomUUID(),
      term: 'business services',
      location: 'New York',
      countryCode: 'us'
    }
  ];
}

function loadManualBusinesses(options: CLIOptions): BusinessLocation[] {
  const records: BusinessLocation[] = [];

  const pushBusiness = (entry: Partial<BusinessLocation> & {
    website?: string;
    name?: string;
    extraUrls?: string[];
    extraPaths?: string[];
    seedEmails?: string[];
    allowedDomains?: string[];
    crawlMaxDepth?: number;
    crawlMaxPages?: number;
    followExternal?: boolean;
    crawlMaxConcurrentRequests?: number;
  }) => {
    if (!entry.website) {
      logger.warn('Skipping manual seed with missing website.', entry);
      return;
    }

    const value = entry.website.trim();
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      logger.warn(`Manual seed website must include protocol: ${value}`);
      return;
    }

    let hostname: string;
    try {
      hostname = new URL(value).hostname.replace(/^www\./, '');
    } catch (error) {
      logger.warn(`Invalid manual seed URL: ${value}`, error);
      return;
    }

    const normalizedName = entry.name ?? hostname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const finalName = normalizedName ? normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1) : hostname;

    const metadata: BusinessLocation['metadata'] = {};
    if (Array.isArray(entry.extraUrls) && entry.extraUrls.length > 0) {
      metadata.extraUrls = entry.extraUrls.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (Array.isArray(entry.extraPaths) && entry.extraPaths.length > 0) {
      metadata.extraPaths = entry.extraPaths.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (Array.isArray(entry.seedEmails) && entry.seedEmails.length > 0) {
      metadata.seedEmails = entry.seedEmails
        .filter((item) => typeof item === 'string' && item.includes('@'))
        .map((item) => item.trim().toLowerCase());
    }
    if (Array.isArray(entry.allowedDomains) && entry.allowedDomains.length > 0) {
      metadata.allowedDomains = entry.allowedDomains
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter((item) => item.length > 0);
    }
    if (typeof entry.crawlMaxDepth === 'number' && Number.isFinite(entry.crawlMaxDepth)) {
      metadata.crawlMaxDepth = Math.max(1, Math.floor(entry.crawlMaxDepth));
    }
    if (typeof entry.crawlMaxPages === 'number' && Number.isFinite(entry.crawlMaxPages)) {
      metadata.crawlMaxPages = Math.max(1, Math.floor(entry.crawlMaxPages));
    }
    if (typeof entry.followExternal === 'boolean') {
      metadata.followExternal = entry.followExternal;
    }
    if (
      typeof entry.crawlMaxConcurrentRequests === 'number' &&
      Number.isFinite(entry.crawlMaxConcurrentRequests)
    ) {
      metadata.crawlMaxConcurrentRequests = Math.max(1, Math.floor(entry.crawlMaxConcurrentRequests));
    }

    const business: BusinessLocation = {
      name: finalName,
      website: value,
      ...(entry.formattedAddress ? { formattedAddress: entry.formattedAddress } : {}),
      ...(entry.phoneNumber ? { phoneNumber: entry.phoneNumber } : {}),
      ...(entry.category ? { category: entry.category } : {}),
      source: 'manual'
    };

    if (Object.keys(metadata).length > 0) {
      business.metadata = metadata;
    }

    records.push(business);
  };

  if (options.seedFile) {
    if (!existsSync(options.seedFile)) {
      throw new Error(`Seed file not found: ${options.seedFile}`);
    }
    const content = readFileSync(options.seedFile, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Seed file must be a JSON array.');
    }
    for (const item of parsed) {
      if (typeof item === 'string') {
        pushBusiness({ website: item });
      } else if (item && typeof item === 'object') {
        pushBusiness(item as Partial<BusinessLocation> & {
          website?: string;
          name?: string;
          extraUrls?: string[];
          extraPaths?: string[];
          seedEmails?: string[];
        });
      }
    }
  }

  if (options.websites) {
    for (const website of options.websites) {
      pushBusiness({ website });
    }
  }

  const dedup = new Map<string, BusinessLocation>();
  for (const business of records) {
    if (!business.website) continue;
    const key = business.website.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, business);
    }
  }

  return Array.from(dedup.values());
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const queries = loadQueries(options);
    const manualBusinesses = loadManualBusinesses(options);

    logger.info(
      `Running pipeline with ${queries.length} queries and ${manualBusinesses.length} manual targets.`
    );

    const pipelineOptions: {
      dryRun?: boolean;
      requireReachableDomain?: boolean;
      checkDevSubdomain?: boolean;
      stopAfterFirstEmail?: boolean;
      skipSalesEmails?: boolean;
    } = {};

    if (options.dryRun) {
      pipelineOptions.dryRun = true;
    }
    if (options.requireReachableDomain !== undefined) {
      pipelineOptions.requireReachableDomain = options.requireReachableDomain;
    }
    if (options.checkDevSubdomain !== undefined) {
      pipelineOptions.checkDevSubdomain = options.checkDevSubdomain;
    }
    if (options.stopAfterFirstEmail !== undefined) {
      pipelineOptions.stopAfterFirstEmail = options.stopAfterFirstEmail;
    }
    if (options.allowSalesAddresses !== undefined) {
      pipelineOptions.skipSalesEmails = !options.allowSalesAddresses;
    }

    const pipeline = new EmailScrapingPipeline(pipelineOptions);
    const results = await pipeline.run(queries, manualBusinesses);

    logger.info(`Pipeline discovered ${results.reduce((acc, record) => acc + record.emails.length, 0)} emails.`);
  } catch (error) {
    logger.error('Pipeline failed.', error);
    process.exitCode = 1;
  }
}

main();

