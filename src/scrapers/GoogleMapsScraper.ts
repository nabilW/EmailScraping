import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';

import { appConfig } from '../config.js';
import { BusinessLocation, SearchQuery } from '../types.js';
import { logger } from '../utils/logger.js';

interface GoogleMapsPlace {
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  place_id?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
  types?: string[];
}

interface GooglePlacesResponse {
  results?: Array<GoogleMapsPlace & { business_status?: string }>;
  next_page_token?: string;
  status?: string;
  error_message?: string;
}

export interface GoogleMapsScraperOptions {
  apiKey?: string;
  pageSize?: number;
  delayMs?: number;
}

const DEFAULT_DELAY = 500;

export class GoogleMapsScraper {
  private apiKey: string;
  private pageSize: number;
  private delayMs: number;

  constructor(options: GoogleMapsScraperOptions = {}) {
    const { apiKey, pageSize = 20, delayMs = DEFAULT_DELAY } = options;
    this.apiKey = apiKey ?? appConfig.googleMapsApiKey ?? '';
    this.pageSize = pageSize;
    this.delayMs = delayMs;
  }

  async search(query: SearchQuery): Promise<BusinessLocation[]> {
    if (!this.apiKey) {
      logger.warn('Google Maps API key missing; skipping Google Maps scraping.');
      return [];
    }

    const locations: BusinessLocation[] = [];
    let nextPageToken: string | undefined;
    let page = 0;

    do {
      page += 1;
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      url.searchParams.set('query', this.buildQueryString(query));
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('language', query.countryCode ?? 'en');
      url.searchParams.set('type', 'establishment');
      url.searchParams.set('radius', '50000');
      if (nextPageToken) {
        url.searchParams.set('pagetoken', nextPageToken);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Google Places API returned ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as GooglePlacesResponse;
      if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
        const message = json.error_message ?? 'Unknown error';
        throw new Error(`Google Places API error: ${json.status} - ${message}`);
      }

      const results = json.results ?? [];
      logger.debug(`Google Maps page ${page} returned ${results.length} results.`);

      for (const place of results.slice(0, this.pageSize)) {
        locations.push(this.mapPlaceToBusiness(place));
      }

      nextPageToken = json.next_page_token;
      if (nextPageToken) {
        logger.debug('Waiting for next page token cool-down.');
        await this.sleep(this.delayMs);
      }
    } while (nextPageToken);

    return locations;
  }

  private mapPlaceToBusiness(place: GoogleMapsPlace): BusinessLocation {
    return {
      name: place.name,
      address: place.formatted_address,
      formattedAddress: place.formatted_address,
      phoneNumber: place.formatted_phone_number ?? place.international_phone_number,
      website: place.website,
      placeId: place.place_id ?? uuid(),
      latitude: place.geometry?.location?.lat,
      longitude: place.geometry?.location?.lng,
      category: place.types?.[0],
      source: 'google-maps'
    } satisfies BusinessLocation;
  }

  private buildQueryString(query: SearchQuery): string {
    const parts = [query.term];
    if (query.location) {
      parts.push(query.location);
    }
    if (query.countryCode) {
      parts.push(query.countryCode);
    }
    return parts.filter(Boolean).join(' ');
  }

  private async sleep(durationMs: number) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}

export function createGoogleMapsScraper(): GoogleMapsScraper {
  return new GoogleMapsScraper({
    apiKey: appConfig.googleMapsApiKey,
    pageSize: 40,
    delayMs: 500
  });
}

