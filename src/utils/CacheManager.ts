/**
 * Centralized cache manager for HTTP responses, DNS results, and parsed HTML
 * Uses LRU (Least Recently Used) eviction policy
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
}

export class CacheManager {
  private httpCache = new Map<string, CacheEntry<string>>();
  private dnsCache = new Map<string, CacheEntry<unknown>>();
  private htmlCache = new Map<string, CacheEntry<string>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.ttl ?? 3600000; // 1 hour default
  }

  /**
   * Get cached HTTP response
   */
  getHttp(url: string): string | null {
    return this.get<string>(this.httpCache, url);
  }

  /**
   * Set cached HTTP response
   */
  setHttp(url: string, html: string, ttl?: number): void {
    this.set(this.httpCache, url, html, ttl);
  }

  /**
   * Get cached DNS result
   */
  getDns(domain: string): unknown | null {
    return this.get<unknown>(this.dnsCache, domain);
  }

  /**
   * Set cached DNS result
   */
  setDns(domain: string, records: unknown, ttl?: number): void {
    // DNS records typically cached for 1 hour
    this.set(this.dnsCache, domain, records, ttl ?? 3600000);
  }

  /**
   * Get cached parsed HTML
   */
  getHtml(url: string): string | null {
    return this.get<string>(this.htmlCache, url);
  }

  /**
   * Set cached parsed HTML
   */
  setHtml(url: string, html: string, ttl?: number): void {
    this.set(this.htmlCache, url, html, ttl);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.httpCache.clear();
    this.dnsCache.clear();
    this.htmlCache.clear();
  }

  /**
   * Clear expired entries from all caches
   */
  clearExpired(): void {
    this.clearExpiredFrom(this.httpCache);
    this.clearExpiredFrom(this.dnsCache);
    this.clearExpiredFrom(this.htmlCache);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    http: { size: number; maxSize: number };
    dns: { size: number; maxSize: number };
    html: { size: number; maxSize: number };
  } {
    return {
      http: { size: this.httpCache.size, maxSize: this.maxSize },
      dns: { size: this.dnsCache.size, maxSize: this.maxSize },
      html: { size: this.htmlCache.size, maxSize: this.maxSize }
    };
  }

  private get<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
    }

    // Move to end (LRU - most recently used)
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  private set<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl?: number): void {
    // Remove expired entries if cache is full
    if (cache.size >= this.maxSize) {
      this.evictLRU(cache);
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + (ttl ?? this.defaultTtl),
      createdAt: now
    };

    cache.set(key, entry);
  }

  private evictLRU<T>(cache: Map<string, CacheEntry<T>>): void {
    // Find oldest entry (least recently used)
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  private clearExpiredFrom<T>(cache: Map<string, CacheEntry<T>>): void {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now > entry.expiresAt) {
        cache.delete(key);
      }
    }
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager({
      maxSize: parseInt(process.env.CACHE_MAX_SIZE ?? '1000', 10),
      ttl: parseInt(process.env.CACHE_TTL_MS ?? '3600000', 10)
    });
  }
  return cacheManagerInstance;
}
