import { PromisePool } from '@supercharge/promise-pool';

import { EmailExtractor } from '../extractors/EmailExtractor.js';
import { createGoogleMapsScraper, GoogleMapsScraper } from '../scrapers/GoogleMapsScraper.js';
import { CrawlOptions, WebCrawler } from '../scrapers/WebCrawler.js';
import { ResultStore } from '../storage/ResultStore.js';
import {
  BusinessLocation,
  EnrichedEmailRecord,
  EmailMatch,
  PipelineOptions,
  SearchQuery
} from '../types.js';
import { logger } from '../utils/logger.js';
import { createDeliverabilityChecker, DeliverabilityChecker } from '../verifiers/DeliverabilityChecker.js';
import { HttpDomainValidator } from '../verifiers/HttpDomainValidator.js';

export interface EmailScrapingPipelineDependencies {
  googleMapsScraper?: GoogleMapsScraper;
  webCrawler?: WebCrawler;
  emailExtractor?: EmailExtractor;
  deliverabilityChecker?: DeliverabilityChecker | null;
  domainValidator?: HttpDomainValidator | null;
  resultStore?: ResultStore;
}

const DEFAULT_OPTIONS: Required<PipelineOptions> = {
  concurrency: 20,
  delayMs: 0,
  googleMapsPageSize: 40,
  retryLimit: 2,
  dryRun: false,
  requireReachableDomain: false,
  checkDevSubdomain: true,
  skipSalesEmails: true,
  autoMergeToArchive: false
};

export class EmailScrapingPipeline {
  private googleScraper: GoogleMapsScraper;
  private webCrawler: WebCrawler;
  private extractor: EmailExtractor;
  private deliverability: DeliverabilityChecker | null;
  private domainValidator: HttpDomainValidator | null;
  private resultStore: ResultStore;
  private options: Required<PipelineOptions>;
  private knownEmails: Set<string>;

  constructor(options: PipelineOptions = {}, dependencies: EmailScrapingPipelineDependencies = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.googleScraper =
      dependencies.googleMapsScraper ?? createGoogleMapsScraper();
    this.webCrawler = dependencies.webCrawler ?? new WebCrawler();
    this.extractor = dependencies.emailExtractor ?? new EmailExtractor();
    const deliverabilityInstance =
      dependencies.deliverabilityChecker === undefined
        ? createDeliverabilityChecker()
        : dependencies.deliverabilityChecker;
    this.deliverability = deliverabilityInstance?.isEnabled() ? deliverabilityInstance : null;
    if (!this.deliverability) {
      logger.debug('Deliverability checker disabled (missing configuration).');
    }

    const domainValidatorInstance =
      dependencies.domainValidator === undefined
        ? new HttpDomainValidator({ checkDevSubdomain: this.options.checkDevSubdomain })
        : dependencies.domainValidator;
    this.domainValidator = domainValidatorInstance ?? null;
    if (!this.domainValidator) {
      logger.debug('HTTP domain validator disabled.');
    }
    this.resultStore = dependencies.resultStore ?? new ResultStore({
      useDatabase: process.env.USE_DATABASE === 'true'
    });
    
    // Optimized: Load from both archive and new emails for deduplication
    // If database is available, we can query it more efficiently, but for now
    // we still load into memory for fast lookups during processing
    const archiveEmails = this.resultStore.loadExistingEmails('dataemails.txt');
    const newEmails = this.resultStore.loadExistingEmails('emails.txt');
    
    // Optimized: Use Set for O(1) lookups, but limit size to prevent memory issues
    const MAX_EMAILS_IN_MEMORY = 100000; // Limit to 100k emails in memory
    const allEmails = [...archiveEmails, ...newEmails];
    this.knownEmails = new Set(
      allEmails.length > MAX_EMAILS_IN_MEMORY 
        ? allEmails.slice(0, MAX_EMAILS_IN_MEMORY)
        : allEmails
    );
    
    if (this.knownEmails.size > 0) {
      logger.info(`Loaded ${archiveEmails.size} archived emails and ${newEmails.size} new emails for deduplication (${this.knownEmails.size} in memory).`);
      if (allEmails.length > MAX_EMAILS_IN_MEMORY) {
        logger.warn(`Email set exceeds memory limit (${allEmails.length} > ${MAX_EMAILS_IN_MEMORY}), using database for additional lookups.`);
      }
    }
  }

  async run(
    queries: SearchQuery[],
    manualBusinesses: BusinessLocation[] = []
  ): Promise<EnrichedEmailRecord[]> {
    const manualSeeds = manualBusinesses.filter((business) => business.website);
    const discoveredBusinesses = queries.length > 0 ? await this.collectBusinesses(queries) : [];
    const businesses = this.mergeBusinessLists(manualSeeds, discoveredBusinesses);

    logger.info(
      `Collected ${businesses.length} candidate businesses (manual ${manualSeeds.length}, google ${discoveredBusinesses.length}).`
    );

    if (businesses.length === 0) {
      logger.warn('No candidate businesses available; nothing to enrich.');
      return [];
    }

    const { results } = await PromisePool.withConcurrency(this.options.concurrency)
      .for(businesses)
      .process(async (business) => this.enrichBusiness(business));

    const flattened: EnrichedEmailRecord[] = results.filter(Boolean) as EnrichedEmailRecord[];

    if (!this.options.dryRun) {
      // Optimized: Save in parallel, database save happens inside saveAsJson
      await Promise.all([
        this.resultStore.saveAsCsv(flattened),
        this.resultStore.saveAsExcel(flattened),
        this.resultStore.saveAsJson(flattened), // Now async and saves to DB if enabled
        Promise.resolve().then(() => this.resultStore.saveAsTxt(flattened))
      ]);
      
      // Optionally merge new emails into archive (can be controlled via option)
      if (this.options.autoMergeToArchive) {
        this.resultStore.mergeToArchive();
      }
    }

    logger.success('Pipeline completed.');
    return flattened;
  }

  private async collectBusinesses(queries: SearchQuery[]): Promise<BusinessLocation[]> {
    if (queries.length === 0) {
      return [];
    }
    const { results } = await PromisePool.withConcurrency(this.options.concurrency)
      .for(queries)
      .process(async (query) => {
        try {
          return this.googleScraper.search({ ...query, pageSize: this.options.googleMapsPageSize });
        } catch (error) {
          logger.error(`Google Maps search failed for ${query.term}`, error);
          return [];
        }
      });

    return results.flat();
  }

  private async enrichBusiness(business: BusinessLocation): Promise<EnrichedEmailRecord | null> {
    if (!business.website) {
      logger.debug(`Skipping ${business.name} (no website).`);
      return null;
    }
    logger.info(`Enriching ${business.name}`);

    const extraUrls = this.getExtraUrls(business);
    const crawlOverrides = this.getCrawlOverrides(business);
    const htmlDocuments = await this.webCrawler.crawl(business.website, extraUrls, crawlOverrides);
    let matches: EmailMatch[] = [...this.getSeedEmails(business)];
    for (const [url, html] of Object.entries(htmlDocuments)) {
      const extracted = this.extractor.extract(html, {
        sourceUrl: url,
        sourceType: 'web'
      });
      matches.push(...extracted);
    }

    matches = this.filterByAllowedDomains(business, matches);

    let deduped = this.deduplicateEmails(matches);

    // Optimized: Filter emails (synchronous check, fast enough)
    deduped = deduped.filter((email) => this.shouldKeepEmail(email));

    if (deduped.length === 0) {
      logger.debug(`No new emails to record for ${business.name}`);
      return null;
    }

    // Optimized: Use PromisePool for parallel processing with concurrency control
    if (this.deliverability && deduped.length > 0) {
      await PromisePool.withConcurrency(Math.min(10, deduped.length))
        .for(deduped)
        .process(async (email) => {
          try {
            const result = await this.deliverability!.verify(email.address);
            email.verificationStatus = result.status;
          } catch (error) {
            logger.debug(`Deliverability check failed for ${email.address}`, error);
          }
        });
    }

    if (this.domainValidator && deduped.length > 0) {
      await PromisePool.withConcurrency(Math.min(10, deduped.length))
        .for(deduped)
        .process(async (email) => {
          try {
            email.webProbe = await this.domainValidator!.validate(email.address);
          } catch (error) {
            logger.debug(`HTTP probe failed for ${email.address}`, error);
          }
        });

      if (this.options.requireReachableDomain) {
        deduped = deduped.filter((email) =>
          email.sourceType === 'manual' ||
          (email.webProbe && ['reachable', 'redirected'].includes(email.webProbe.status))
        );
      }
    }

    if (deduped.length === 0) {
      logger.debug(`No new emails to record for ${business.name} after domain checks`);
      return null;
    }

    for (const email of deduped) {
      this.knownEmails.add(email.address.toLowerCase());
    }

    return { business, emails: deduped } satisfies EnrichedEmailRecord;
  }

  private deduplicateEmails(matches: EmailMatch[]): EmailMatch[] {
    const map = new Map<string, EmailMatch>();
    for (const match of matches) {
      const key = match.address.toLowerCase();
      const existing = map.get(key);
      if (!existing || match.confidence > existing.confidence) {
        map.set(key, {
          ...(existing ?? {}),
          ...match,
          confidence: Math.max(match.confidence, existing?.confidence ?? 0),
          verificationStatus: match.verificationStatus ?? existing?.verificationStatus,
          webProbe: match.webProbe ?? existing?.webProbe
        });
      } else if (existing) {
        if (match.sourceUrl && !existing.sourceUrl) {
          existing.sourceUrl = match.sourceUrl;
        }
        if (!existing.webProbe && match.webProbe) {
          existing.webProbe = match.webProbe;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.confidence - a.confidence);
  }

  private extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch (error) {
      logger.debug(`Failed to extract domain from ${url}`, error);
      return null;
    }
  }

  private mergeBusinessLists(
    manual: BusinessLocation[],
    discovered: BusinessLocation[]
  ): BusinessLocation[] {
    const map = new Map<string, BusinessLocation>();
    const add = (business: BusinessLocation) => {
      const key = (business.website ?? business.name).toLowerCase();
      if (!map.has(key)) {
        map.set(key, business);
      }
    };

    manual.forEach(add);
    discovered.forEach(add);

    return Array.from(map.values());
  }

  private getExtraUrls(business: BusinessLocation): string[] {
    const metadata = business.metadata;
    if (!metadata) {
      return [];
    }

    const urls = new Set<string>();
    const base = business.website ?? '';

    if (Array.isArray(metadata.extraUrls)) {
      for (const value of metadata.extraUrls) {
        if (typeof value !== 'string') continue;
        try {
          urls.add(new URL(value, base).toString());
        } catch (error) {
          logger.debug(`Failed to resolve extra URL ${value} for ${business.name}`, error);
        }
      }
    }

    if (Array.isArray(metadata.extraPaths)) {
      for (const value of metadata.extraPaths) {
        if (typeof value !== 'string') continue;
        try {
          urls.add(new URL(value, base).toString());
        } catch (error) {
          logger.debug(`Failed to resolve extra path ${value} for ${business.name}`, error);
        }
      }
    }

    return Array.from(urls);
  }

  private getSeedEmails(business: BusinessLocation): EmailMatch[] {
    const seeds = business.metadata?.seedEmails ?? [];
    const allowed = this.getAllowedDomains(business);
    return seeds
      .filter((email): email is string => typeof email === 'string' && email.includes('@'))
      .filter((email) => {
        if (allowed.size === 0) {
          return true;
        }
        const domain = email.split('@')[1]?.toLowerCase();
        return Boolean(domain) && allowed.has(domain);
      })
      .map((email) => ({
        address: email.toLowerCase(),
        confidence: 0.95,
        sourceType: 'manual',
        sourceUrl: business.website
      } satisfies EmailMatch));
  }

  private filterByAllowedDomains(
    business: BusinessLocation,
    matches: EmailMatch[]
  ): EmailMatch[] {
    const allowed = this.getAllowedDomains(business);

    if (allowed.size === 0) {
      return matches;
    }

    return matches.filter((match) => {
      if (match.sourceType === 'manual') {
        return true;
      }
      const domain = match.address.split('@')[1]?.toLowerCase();
      if (!domain) {
        return false;
      }
      return allowed.has(domain);
    });
  }

  private getCrawlOverrides(business: BusinessLocation): Partial<CrawlOptions> {
    const metadata = business.metadata;
    if (!metadata) {
      return {};
    }

    const overrides: Partial<CrawlOptions> = {};
    if (typeof metadata.crawlMaxDepth === 'number') {
      overrides.maxDepth = Math.max(1, metadata.crawlMaxDepth);
    }
    if (typeof metadata.crawlMaxPages === 'number') {
      overrides.maxPages = Math.max(1, metadata.crawlMaxPages);
    }
    if (typeof metadata.followExternal === 'boolean') {
      overrides.followExternal = metadata.followExternal;
    }
    if (typeof metadata.crawlMaxConcurrentRequests === 'number') {
      overrides.maxConcurrentRequests = Math.max(1, metadata.crawlMaxConcurrentRequests);
    }
    return overrides;
  }

  private getAllowedDomains(business: BusinessLocation): Set<string> {
    const allowed = new Set<string>();
    if (business.website) {
      const domain = this.extractDomain(business.website);
      if (domain) {
        allowed.add(domain.toLowerCase());
      }
    }
    const metadataDomains = business.metadata?.allowedDomains ?? [];
    for (const value of metadataDomains) {
      if (typeof value === 'string' && value.trim()) {
        allowed.add(value.trim().toLowerCase());
      }
    }
    return allowed;
  }

  private shouldKeepEmail(email: EmailMatch): boolean {
    const normalized = email.address.toLowerCase();
    
    // Fast in-memory check first
    if (this.knownEmails.has(normalized)) {
      return false;
    }

    if (this.options.skipSalesEmails && email.sourceType !== 'manual') {
      const localPart = normalized.split('@')[0] ?? '';
      if (localPart === 'sales') {
        return false;
      }
    }

    return true;
  }
}

