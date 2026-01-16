import { describe, expect, it } from 'vitest';

import { EmailExtractor } from '../src/extractors/EmailExtractor.js';

describe('EmailExtractor', () => {
  const extractor = new EmailExtractor();

  it('extracts emails from mailto links', () => {
    const html = '<a href="mailto:hello@acme.io">Contact</a>';
    const results = extractor.extract(html, { sourceType: 'web' });
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe('hello@acme.io');
  });

  it('extracts base64 obfuscated emails', () => {
    const encoded = Buffer.from('mailto:sales@acme.io').toString('base64');
    const html = `<a href="javascript:window.location.href=atob('${encoded}')">Email</a>`;
    const results = extractor.extract(html, { sourceType: 'web' });
    expect(results.some((r) => r.address === 'sales@acme.io')).toBe(true);
  });
});

