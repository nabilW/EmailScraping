import http from 'node:http';
import https from 'node:https';

import fetch, { RequestInit } from 'node-fetch';
import { PromisePool } from '@supercharge/promise-pool';

import { logger } from '../utils/logger.js';
import { getCacheManager } from '../utils/CacheManager.js';

export interface CrawlOptions {
  headers?: Record<string, string>;
  maxDepth?: number;
  maxPages?: number;
  timeoutMs?: number;
  followExternal?: boolean;
  userAgent?: string;
  maxConcurrentRequests?: number;
}

interface CrawlState {
  visited: Set<string>;
  queue: Array<{ url: string; depth: number }>;
  htmlDocuments: Record<string, string>;
}

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_CONCURRENCY = 15;

export class WebCrawler {
  private defaultOptions: Required<CrawlOptions>;
  private cache = getCacheManager();
  // Optimized: Connection pooling with keep-alive
  private httpAgent: https.Agent;
  private httpAgentHttp: http.Agent;

  constructor(options: CrawlOptions = {}) {
    this.defaultOptions = {
      headers: options.headers ?? {},
      maxDepth: options.maxDepth ?? 3,
      maxPages: options.maxPages ?? 50,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
      followExternal: options.followExternal ?? false,
      userAgent:
        options.userAgent ??
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      maxConcurrentRequests: options.maxConcurrentRequests ?? DEFAULT_CONCURRENCY
    } satisfies Required<CrawlOptions>;

    // Optimized: Create connection pools for HTTP/HTTPS
    this.httpAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: this.defaultOptions.timeoutMs
    });

    this.httpAgentHttp = new http.Agent({
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: this.defaultOptions.timeoutMs
    });
  }

  async crawl(
    startUrl: string,
    extraUrls: string[] = [],
    overrides: Partial<CrawlOptions> = {}
  ): Promise<Record<string, string>> {
    const options: Required<CrawlOptions> = {
      ...this.defaultOptions,
      ...overrides,
      headers: {
        ...this.defaultOptions.headers,
        ...overrides.headers
      }
    };
    const state: CrawlState = {
      visited: new Set<string>(),
      queue: [],
      htmlDocuments: {}
    };

    const normalizedStart = this.normalizeUrl(startUrl, startUrl);
    if (normalizedStart) {
      state.queue.push({ url: normalizedStart, depth: 0 });
    }

    const normalizedExtras = extraUrls
      .map((url) => this.normalizeUrl(url, normalizedStart ?? startUrl))
      .filter((url): url is string => Boolean(url));

    for (const extra of normalizedExtras) {
      state.queue.push({ url: extra, depth: 0 });
    }

    const startHostname = normalizedStart ? this.getHostname(normalizedStart) : this.getHostname(startUrl);

    let pagesFetched = 0;
    let reachedLimit = false;

    while (state.queue.length > 0 && !reachedLimit) {
      const batch: Array<{ url: string; depth: number }> = [];

      while (
        state.queue.length > 0 &&
        batch.length < options.maxConcurrentRequests &&
        pagesFetched + batch.length < options.maxPages
      ) {
        const next = state.queue.shift();
        if (!next) {
          break;
        }
        const { url, depth } = next;
        if (state.visited.has(url) || depth > options.maxDepth) {
          continue;
        }
        state.visited.add(url);
        batch.push(next);
      }

      if (batch.length === 0) {
        if (state.queue.length === 0) {
          break;
        }
        continue;
      }

      const { results } = await PromisePool.withConcurrency(
        Math.min(options.maxConcurrentRequests, batch.length)
      )
        .for(batch)
        .process(async ({ url, depth }) => {
          try {
            const html = await this.fetchHtml(url, options);
            return { url, depth, html };
          } catch (error) {
            logger.warn(`Failed to crawl ${url}`, error);
            return null;
          }
        });

      for (const result of results) {
        if (!result) {
          continue;
        }
        const { url, depth, html } = result;
        if (state.htmlDocuments[url]) {
          continue;
        }
        state.htmlDocuments[url] = html;
        pagesFetched += 1;

        if (pagesFetched >= options.maxPages) {
          reachedLimit = true;
          break;
        }

        const links = this.extractLinks(html, url);
        for (const link of links) {
          const hostname = this.getHostname(link);
          if (!hostname) continue;
          if (!options.followExternal && startHostname && hostname !== startHostname) continue;
          if (state.visited.has(link)) continue;
          state.queue.push({ url: link, depth: depth + 1 });
        }
      }
    }

    return state.htmlDocuments;
  }

  private async fetchHtml(url: string, options: Required<CrawlOptions>): Promise<string> {
    // Optimized: Check cache first
    const cached = this.cache.getHttp(url);
    if (cached) {
      logger.debug(`Cache hit for ${url}`);
      return cached;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    const headers = {
      ...options.headers,
      'User-Agent': options.userAgent,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive'
    };

    // Optimized: Use connection pooling
    const urlObj = new URL(url);
    const agent = urlObj.protocol === 'https:' ? this.httpAgent : this.httpAgentHttp;

    const requestOptions: RequestInit = {
      headers,
      signal: controller.signal,
      redirect: 'follow',
      // @ts-expect-error - node-fetch supports agent
      agent
    };

    try {
      const response = await fetch(url, requestOptions);
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Optimized: Cache successful responses (cache for 1 hour)
      if (response.ok && html.length > 0) {
        this.cache.setHttp(url, html, 3600000); // 1 hour TTL
      }

      return html;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const hrefRegex = /href\s*=\s*"([^"]+)"/gi;
    const links: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1];
      if (href.startsWith('mailto:') || href.startsWith('javascript:') || href.startsWith('#')) {
        continue;
      }

      try {
        const absoluteUrl = new URL(href, baseUrl);
        if (['http:', 'https:'].includes(absoluteUrl.protocol)) {
          links.push(absoluteUrl.toString());
        }
      } catch (error) {
        logger.debug(`Skipping malformed URL ${href}`, error);
      }
    }

    return Array.from(new Set(links));
  }

  private getHostname(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (error) {
      logger.debug(`Failed to parse hostname for ${url}`, error);
      return null;
    }
  }

  private normalizeUrl(candidate: string, baseUrl: string): string | null {
    try {
      const url = new URL(candidate, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return null;
      }
      url.hash = '';
      return url.toString();
    } catch (error) {
      logger.debug(`Failed to normalize URL ${candidate}`, error);
      return null;
    }
  }
}

