export type QuerySource = 'google-maps' | 'web' | 'hunter' | 'manual';

export interface SearchQuery {
  id: string;
  term: string;
  location?: string;
  countryCode?: string;
  pageSize?: number;
}

export interface BusinessMetadata {
  extraUrls?: string[];
  extraPaths?: string[];
  seedEmails?: string[];
  allowedDomains?: string[];
  crawlMaxDepth?: number;
  crawlMaxPages?: number;
  followExternal?: boolean;
  crawlMaxConcurrentRequests?: number;
}

export interface BusinessLocation {
  name: string;
  address?: string;
  formattedAddress?: string;
  phoneNumber?: string;
  website?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  source: QuerySource;
  metadata?: BusinessMetadata;
}

export interface EmailMatch {
  address: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: QuerySource;
  verificationStatus?: DeliverabilityStatus;
  webProbe?: DomainProbeResult;
}

export type DeliverabilityStatus =
  | 'deliverable'
  | 'risky'
  | 'unknown'
  | 'undeliverable';

export type DomainProbeStatus = 'reachable' | 'redirected' | 'unreachable' | 'timeout' | 'error';

export interface DomainProbeResult {
  domain: string;
  attemptedUrl: string;
  finalUrl?: string;
  status: DomainProbeStatus;
  httpStatus?: number;
  error?: string;
}

export interface EnrichedEmailRecord {
  business: BusinessLocation;
  emails: EmailMatch[];
  metadata?: Record<string, unknown>;
}

export interface PipelineOptions {
  concurrency?: number;
  delayMs?: number;
  googleMapsPageSize?: number;
  retryLimit?: number;
  dryRun?: boolean;
  requireReachableDomain?: boolean;
  checkDevSubdomain?: boolean;
  skipSalesEmails?: boolean;
  autoMergeToArchive?: boolean;
}

