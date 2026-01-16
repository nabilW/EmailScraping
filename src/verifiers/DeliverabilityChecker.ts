import { resolveMx, MxRecord } from 'node:dns/promises';

import { SMTPClient } from 'smtp-client';

import { appConfig } from '../config.js';
import { DeliverabilityStatus } from '../types.js';
import { logger } from '../utils/logger.js';
import { getCacheManager } from '../utils/CacheManager.js';

export interface DeliverabilityCheckerOptions {
  fromAddress?: string;
  helloName?: string;
  timeoutMs?: number;
}

interface DeliverabilityResult {
  status: DeliverabilityStatus;
  details?: string;
}

const DEFAULT_TIMEOUT = 8000;

export class DeliverabilityChecker {
  private from: string;
  private hello: string;
  private timeout: number;
  private enabled: boolean;
  private cache = getCacheManager();

  constructor(options: DeliverabilityCheckerOptions = {}) {
    this.from = options.fromAddress ?? appConfig.smtpProbeFrom ?? '';
    this.hello = options.helloName ?? appConfig.smtpProbeHello ?? '';
    this.timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
    this.enabled = Boolean(this.from && this.hello);
  }

  async verify(email: string): Promise<DeliverabilityResult> {
    if (!this.enabled) {
      return { status: 'unknown', details: 'Deliverability checker not configured' };
    }
    const domain = email.split('@')[1];
    if (!domain) {
      return { status: 'undeliverable', details: 'Missing domain part' };
    }

    try {
      // Optimized: Check DNS cache first
      let mxRecords: MxRecord[];
      const cached = this.cache.getDns(domain);
      
      if (cached && Array.isArray(cached)) {
        logger.debug(`DNS cache hit for ${domain}`);
        mxRecords = cached as MxRecord[];
      } else {
        mxRecords = await resolveMx(domain);
        // Optimized: Cache DNS results (1 hour TTL)
        if (mxRecords && mxRecords.length > 0) {
          this.cache.setDns(domain, mxRecords, 3600000);
        }
      }

      if (!mxRecords || mxRecords.length === 0) {
        return { status: 'undeliverable', details: 'No MX records found' };
      }

      const sorted = [...mxRecords].sort((a, b) => a.priority - b.priority);
      for (const record of sorted) {
        const result = await this.probeServer(record.exchange, email);
        if (result.status === 'deliverable') {
          return result;
        }
        if (result.status === 'risky') {
          return result;
        }
      }

      return { status: 'unknown', details: 'All MX probes inconclusive' };
    } catch (error) {
      logger.warn(`Deliverability check failed for ${email}`, error);
      return { status: 'unknown', details: `Lookup failed: ${String(error)}` };
    }
  }

  private async probeServer(host: string, email: string): Promise<DeliverabilityResult> {
    const client = new SMTPClient({
      host,
      port: 25,
      // Note: timeout may not be available in SMTPClientOptions, handled via AbortController if needed
      tls: false
    });

    try {
      await client.connect();
      await client.greet({ hostname: this.hello });
      await client.mail({ from: this.from });
      const toResponse = await client.rcpt({ to: email });
      await client.quit();

      // Type assertion for SMTP response (may vary by library version)
      const response = toResponse as unknown as { code?: number; message?: string } | undefined;
      const responseCode = response?.code;
      const responseMessage = response?.message;

      if (responseCode && responseCode >= 250 && responseCode < 300) {
        return { status: 'deliverable', details: `Accepted by ${host}` };
      }

      if (responseCode && responseCode >= 400 && responseCode < 500) {
        return { status: 'risky', details: `Soft failure from ${host}: ${responseMessage ?? 'unknown'}` };
      }

      return {
        status: 'unknown',
        details: `Unexpected response from ${host}: ${responseCode ?? 'n/a'}`
      };
    } catch (error) {
      const message = String(error);
      if (/5\d{2}/.test(message)) {
        return { status: 'undeliverable', details: message };
      }
      if (/4\d{2}/.test(message)) {
        return { status: 'risky', details: message };
      }
      logger.debug(`Probe failed for MX ${host}`, error);
      return { status: 'unknown', details: message };
    } finally {
      try {
        await client.quit();
      } catch {
        // ignore
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export function createDeliverabilityChecker(): DeliverabilityChecker {
  const options: DeliverabilityCheckerOptions = {};
  if (appConfig.smtpProbeFrom) {
    options.fromAddress = appConfig.smtpProbeFrom;
  }
  if (appConfig.smtpProbeHello) {
    options.helloName = appConfig.smtpProbeHello;
  }
  options.timeoutMs = DEFAULT_TIMEOUT;
  return new DeliverabilityChecker(options);
}

