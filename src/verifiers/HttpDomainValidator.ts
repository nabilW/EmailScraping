import { setTimeout as delay } from 'node:timers/promises';

import fetch, { Response } from 'node-fetch';

import { DomainProbeResult, DomainProbeStatus } from '../types.js';
import { logger } from '../utils/logger.js';

export interface HttpDomainValidatorOptions {
  timeoutMs?: number;
  userAgent?: string;
  checkDevSubdomain?: boolean;
  cooldownMs?: number;
}

const DEFAULT_TIMEOUT = 7000;
const DEFAULT_COOLDOWN = 150;

const SUCCESS_STATUSES = new Set<number>([
  200, 201, 202, 203, 204, 205, 206, 301, 302, 303, 307, 308
]);

export class HttpDomainValidator {
  private timeout: number;
  private userAgent: string;
  private checkDev: boolean;
  private cooldownMs: number;

  constructor(options: HttpDomainValidatorOptions = {}) {
    this.timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
    this.userAgent =
      options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    this.checkDev = options.checkDevSubdomain ?? true;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN;
  }

  async validate(email: string): Promise<DomainProbeResult | null> {
    const domain = this.extractDomain(email);
    if (!domain) {
      return null;
    }

    const hosts = new Set<string>([domain, `www.${domain}`]);
    if (this.checkDev) {
      hosts.add(`dev.${domain}`);
    }

    const attempts: DomainProbeResult[] = [];

    for (const host of hosts) {
      for (const scheme of ['https', 'http']) {
        const url = `${scheme}://${host}`;
        const probe = await this.probeUrl(domain, url);
        attempts.push(probe);

        if (probe.status === 'reachable' || probe.status === 'redirected') {
          return probe;
        }

        // short cooldown to avoid hammering domains
        await delay(this.cooldownMs);
      }
    }

    // Return best attempt prioritising errors over timeouts, etc.
    return attempts[0] ?? null;
  }

  private async probeUrl(domain: string, url: string): Promise<DomainProbeResult> {
    const attempt = async (method: 'HEAD' | 'GET') => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await this.fetchWithMethod(url, method, controller);
        clearTimeout(timeout);
        return response;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    };

    const finalize = (response: Response, attempted: string): DomainProbeResult => {
      const status = this.mapStatus(response);
      return {
        domain,
        attemptedUrl: attempted,
        finalUrl: response.url,
        status,
        httpStatus: response.status
      } satisfies DomainProbeResult;
    };

    try {
      let response = await attempt('HEAD');
      if (!response.ok || response.status >= 400) {
        response = await attempt('GET');
        return finalize(response, url);
      }
      return finalize(response, url);
    } catch (headError) {
      logger.debug(`HEAD probe failed for ${url}, retrying with GET`, headError);
      try {
        const response = await attempt('GET');
        return finalize(response, url);
      } catch (getError) {
        const errorMessage =
          (getError && typeof getError === 'object' && 'name' in getError && getError.name === 'AbortError')
            ? 'Request timed out'
            : String(getError);
        const status: DomainProbeStatus = errorMessage === 'Request timed out' ? 'timeout' : 'error';
        return {
          domain,
          attemptedUrl: url,
          status,
          error: errorMessage
        } satisfies DomainProbeResult;
      }
    }
  }

  private async fetchWithMethod(url: string, method: 'HEAD' | 'GET', controller: AbortController): Promise<Response> {
    return fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
  }

  private mapStatus(response: Response): DomainProbeStatus {
    if (SUCCESS_STATUSES.has(response.status)) {
      if (response.status >= 300) {
        return 'redirected';
      }
      return 'reachable';
    }
    if (response.status >= 400 && response.status < 500) {
      return 'unreachable';
    }
    if (response.status >= 500) {
      return 'unreachable';
    }
    return 'error';
  }

  private extractDomain(email: string): string | null {
    const [, domain] = email.split('@');
    if (!domain) {
      return null;
    }
    return domain.toLowerCase();
  }
}

