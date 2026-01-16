import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

import { EmailMatch } from '../types.js';

// Optimized: Remove global flags to avoid state issues, create new regex instances
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_VALIDATION_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const MAILTO_REGEX = /mailto:([^"'>\s]+)/i;
const BASE64_REGEX = /atob\(['"]([^'"]+)['"]\)/i;

export interface EmailExtractorOptions {
  minConfidence?: number;
  includeMailto?: boolean;
  includeTextMatches?: boolean;
}

interface ExtractionContext {
  sourceUrl?: string;
  sourceType: EmailMatch['sourceType'];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false
});

export class EmailExtractor {
  private options: Required<EmailExtractorOptions>;

  constructor(options: EmailExtractorOptions = {}) {
    this.options = {
      minConfidence: options.minConfidence ?? 0.35,
      includeMailto: options.includeMailto ?? true,
      includeTextMatches: options.includeTextMatches ?? true
    } satisfies Required<EmailExtractorOptions>;
  }

  extract(sourceHtml: string, context: ExtractionContext): EmailMatch[] {
    const results: EmailMatch[] = [];
    const seen = new Set<string>();

    const addResult = (email: string, confidence: number, sourceDetails?: Partial<EmailMatch>) => {
      const sanitized = this.sanitizeEmail(email);
      if (!sanitized) {
        return;
      }
      const normalized = sanitized.trim().toLowerCase();
      if (!this.isValidEmail(normalized) || confidence < this.options.minConfidence) {
        return;
      }
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      const match: EmailMatch = {
        address: normalized,
        confidence,
        sourceType: context.sourceType,
        ...(context.sourceUrl ? { sourceUrl: context.sourceUrl } : {}),
        ...sourceDetails
      };
      results.push(match);
    };

    if (this.options.includeMailto) {
      // Optimized: Use matchAll instead of exec loop for better performance
      const mailtoMatches = sourceHtml.matchAll(new RegExp(MAILTO_REGEX.source, 'gi'));
      for (const match of mailtoMatches) {
        const value = decodeURIComponent(match[1] ?? '');
        if (value) {
          addResult(value, 0.9);
        }
      }
    }

    // Handle base64 obfuscation via atob
    // Optimized: Use matchAll for better performance
    const base64Matches = sourceHtml.matchAll(new RegExp(BASE64_REGEX.source, 'gi'));
    for (const match of base64Matches) {
      try {
        const decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
        const emails = decoded.match(new RegExp(EMAIL_REGEX.source, 'gi')) ?? [];
        for (const email of emails) {
          addResult(email, 0.7);
        }
      } catch {
        // ignore invalid base64
      }
    }

    // Decode HTML entities before searching raw text
    try {
      const parsed = xmlParser.parse(`<root>${sourceHtml}</root>`);
      const flattenedText = JSON.stringify(parsed);
      const textEmails = flattenedText.match(new RegExp(EMAIL_REGEX.source, 'gi')) ?? [];
      for (const email of textEmails) {
        addResult(email, 0.55);
      }
    } catch {
      // If parsing fails, fallback to raw HTML scanning below
    }

    if (this.options.includeTextMatches) {
      // Optimized: Use global flag only when needed
      const textEmails = sourceHtml.match(new RegExp(EMAIL_REGEX.source, 'gi')) ?? [];
      for (const email of textEmails) {
        addResult(email, 0.45);
      }
    }

    const $ = load(sourceHtml);
    $('*').each((_, element) => {
      // Type guard for Element nodes with attributes
      if (element.type !== 'tag' || !('attribs' in element)) return;
      const attribs = (element as { attribs?: Record<string, string> }).attribs;
      if (!attribs) return;
      
      for (const attrValue of Object.values(attribs)) {
        if (!attrValue || typeof attrValue !== 'string') continue;
        // Optimized: Create regex instance with global flag only when needed
        const emails = attrValue.match(new RegExp(EMAIL_REGEX.source, 'gi')) ?? [];
        for (const email of emails) {
          addResult(email, 0.6);
        }
      }
    });

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  private isValidEmail(value: string): boolean {
    if (!EMAIL_VALIDATION_REGEX.test(value)) {
      return false;
    }
    const lower = value.toLowerCase();
    if (
      lower.includes('example.com') ||
      lower.includes('example@') ||
      lower.includes('test@') ||
      lower.includes('johnsmith') ||
      lower.includes('providername') ||
      lower === 'name@domain.com'
    ) {
      return false;
    }
    const [local, domain] = value.split('@');
    if (!local || !domain) {
      return false;
    }
    if (domain.startsWith('-') || domain.endsWith('-')) {
      return false;
    }
    if (!domain.includes('.')) {
      return false;
    }
    return true;
  }

  private sanitizeEmail(email: string): string {
    let value = email
      .replace(/\u003e/gi, '')
      .replace(/^u003e/gi, '')
      .replace(/[<>\s]+$/g, '')
      .replace(/^[<>\s]+/g, '');
    value = value.replace(/,$/, '');
    return value.trim();
  }
}

