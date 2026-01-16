import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createArrayCsvWriter } from 'csv-writer';
import ExcelJS from 'exceljs';

import { EnrichedEmailRecord } from '../types.js';
import { logger } from '../utils/logger.js';

import { DatabaseStorageAdapter } from './DatabaseStorageAdapter.js';

export interface ResultStoreOptions {
  outputDir?: string;
  useDatabase?: boolean;
  dbPath?: string;
}

const DEFAULT_OUTPUT_DIR = './output';

export class ResultStore {
  private outputDir: string;
  private databaseAdapter: DatabaseStorageAdapter | null = null;

  constructor(options: ResultStoreOptions = {}) {
    this.outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
    
    // Initialize database adapter if requested
    if (options.useDatabase ?? process.env.USE_DATABASE === 'true') {
      this.databaseAdapter = new DatabaseStorageAdapter({
        dbPath: options.dbPath,
        enableIndexing: true
      });
      // Initialize asynchronously (don't block constructor)
      this.databaseAdapter.initialize().catch((error) => {
        logger.warn('Database initialization failed, using file storage', error);
        this.databaseAdapter = null;
      });
    }
  }

  async saveAsJson(records: EnrichedEmailRecord[], filename = 'results.json') {
    // Save to database if available
    if (this.databaseAdapter?.isAvailable() && records.length > 0) {
      try {
        await this.databaseAdapter.saveEmails(records);
        logger.debug(`Saved ${records.length} records to database`);
      } catch (error) {
        logger.warn('Failed to save to database, falling back to file', error);
      }
    }

    // Always save to file as well for compatibility
    const filePath = this.ensureAbsolute(filename);
    const payload = JSON.stringify(records, null, 2);
    writeFileSync(filePath, payload, 'utf8');
    logger.success(`Saved JSON results to ${filePath}`);
  }

  async saveAsCsv(records: EnrichedEmailRecord[], filename = 'results.csv') {
    const filePath = this.ensureAbsolute(filename);
    const rows: string[][] = [];
    for (const record of records) {
      for (const email of record.emails) {
        rows.push([
          record.business.name,
          record.business.formattedAddress ?? '',
          record.business.phoneNumber ?? '',
          record.business.website ?? '',
          email.address,
          email.confidence.toFixed(2),
          email.verificationStatus ?? '',
          email.webProbe?.status ?? '',
          email.webProbe?.httpStatus?.toString() ?? '',
          email.webProbe?.finalUrl ?? '',
          email.sourceUrl ?? ''
        ]);
      }
    }

    const csvWriter = createArrayCsvWriter({
      path: filePath,
      header: [
        'Business Name',
        'Address',
        'Phone',
        'Website',
        'Email',
        'Confidence',
        'Deliverability',
        'Web Status',
        'HTTP Status',
        'Resolved URL',
        'Source URL'
      ]
    });

    await csvWriter.writeRecords(rows);
    logger.success(`Saved CSV results to ${filePath}`);
  }

  async saveAsExcel(records: EnrichedEmailRecord[], filename = 'results.xlsx') {
    const filePath = this.ensureAbsolute(filename);
    // eslint-disable-next-line import/no-named-as-default-member
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Emails');

    sheet.columns = [
      { header: 'Business Name', key: 'name', width: 30 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Deliverability', key: 'deliverability', width: 16 },
      { header: 'Web Status', key: 'webStatus', width: 16 },
      { header: 'HTTP Status', key: 'httpStatus', width: 12 },
      { header: 'Resolved URL', key: 'resolvedUrl', width: 40 },
      { header: 'Source URL', key: 'source', width: 40 }
    ];

    for (const record of records) {
      for (const email of record.emails) {
        sheet.addRow({
          name: record.business.name,
          address: record.business.formattedAddress ?? '',
          phone: record.business.phoneNumber ?? '',
          website: record.business.website ?? '',
          email: email.address,
          confidence: email.confidence,
          deliverability: email.verificationStatus ?? '',
          webStatus: email.webProbe?.status ?? '',
          httpStatus: email.webProbe?.httpStatus ?? '',
          resolvedUrl: email.webProbe?.finalUrl ?? '',
          source: email.sourceUrl ?? ''
        });
      }
    }

    await workbook.xlsx.writeFile(filePath);
    logger.success(`Saved Excel results to ${filePath}`);
  }

  saveAsTxt(records: EnrichedEmailRecord[], filename = 'emails.txt') {
    const filePath = this.ensureAbsolute(filename);
    const uniqueEmails = new Map<string, string>();
    
    // Load archive for deduplication (but don't write it to emails.txt)
    const archiveEmails = this.loadExistingEmails('dataemails.txt');
    
    // Load existing NEW emails from emails.txt (current session only)
    const existingNewEmails = this.loadExistingEmails(filename);
    for (const email of existingNewEmails) {
      uniqueEmails.set(email, email);
    }

    // Add newly scraped emails (only if not in archive)
    for (const record of records) {
      for (const email of record.emails) {
        const key = email.address.toLowerCase();
        // Only add if not in archive and not already in new emails
        if (!archiveEmails.has(key) && !uniqueEmails.has(key)) {
          uniqueEmails.set(key, email.address);
        }
      }
    }

    // Write ONLY new emails to emails.txt (not the archive)
    const payload = `${Array.from(uniqueEmails.values()).sort((a, b) => a.localeCompare(b)).join('\n')}\n`;
    writeFileSync(filePath, payload, 'utf8');
    logger.success(`Saved ${uniqueEmails.size} new emails to ${filePath} (excluding ${archiveEmails.size} archived emails)`);
  }

  loadExistingEmails(filename = 'emails.txt'): Set<string> {
    const filePath = this.ensureAbsolute(filename);
    if (!existsSync(filePath)) {
      return new Set<string>();
    }
    const content = readFileSync(filePath, 'utf8');
    return new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0)
    );
  }

  /**
   * Merge new emails from emails.txt into dataemails.txt archive
   */
  mergeToArchive(): void {
    const archivePath = this.ensureAbsolute('dataemails.txt');
    const newEmailsPath = this.ensureAbsolute('emails.txt');
    
    const archiveEmails = this.loadExistingEmails('dataemails.txt');
    const newEmails = this.loadExistingEmails('emails.txt');
    
    // Combine all emails
    const allEmails = new Set<string>([...archiveEmails, ...newEmails]);
    
    // Write to archive
    const payload = `${Array.from(allEmails).sort((a, b) => a.localeCompare(b)).join('\n')}\n`;
    writeFileSync(archivePath, payload, 'utf8');
    
    // Clear emails.txt for next scraping session
    writeFileSync(newEmailsPath, '', 'utf8');
    
    logger.success(`Merged ${newEmails.size} new emails into archive. Archive now contains ${allEmails.size} emails.`);
  }

  private ensureAbsolute(filename: string): string {
    const filePath = join(this.outputDir, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    return filePath;
  }
}

