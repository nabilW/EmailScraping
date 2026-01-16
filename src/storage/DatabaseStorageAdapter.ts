/**
 * Database storage adapter for email records
 * Supports SQLite (default) with option to extend to PostgreSQL
 */

import { join } from 'node:path';

import type { Database } from 'better-sqlite3';

import { EmailMatch, EnrichedEmailRecord } from '../types.js';
import { logger } from '../utils/logger.js';

export interface DatabaseStorageOptions {
  dbPath?: string;
  enableIndexing?: boolean;
}

export class DatabaseStorageAdapter {
  private db: Database | null = null;
  private readonly dbPath: string;
  private readonly enableIndexing: boolean;

  constructor(options: DatabaseStorageOptions = {}) {
    this.dbPath = options.dbPath ?? join(process.cwd(), 'output', 'emails.db');
    this.enableIndexing = options.enableIndexing ?? true;
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid requiring better-sqlite3 if not used
      const BetterSqlite3 = await import('better-sqlite3');
      const DatabaseClass = BetterSqlite3.default ?? (BetterSqlite3 as { Database: typeof Database }).Database;
      this.db = new DatabaseClass(this.dbPath) as Database;

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      this.createTables();
      if (this.enableIndexing) {
        this.createIndexes();
      }

      logger.info(`Database initialized at ${this.dbPath}`);
    } catch (error) {
      logger.warn('Failed to initialize database, falling back to file storage', error);
      this.db = null;
    }
  }

  /**
   * Check if database is available
   */
  isAvailable(): boolean {
    return this.db !== null;
  }

  /**
   * Save email records to database
   */
  async saveEmails(records: EnrichedEmailRecord[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const insertEmail = this.db.prepare(`
      INSERT OR IGNORE INTO emails (
        address, domain, confidence, source_url, source_type,
        verification_status, web_probe_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBusiness = this.db.prepare(`
      INSERT OR IGNORE INTO businesses (
        name, website, address, phone, category, source
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertBusinessEmail = this.db.prepare(`
      INSERT OR IGNORE INTO business_emails (business_id, email_id)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const record of records) {
        // Insert business
        const businessResult = insertBusiness.run(
          record.business.name,
          record.business.website ?? null,
          record.business.formattedAddress ?? null,
          record.business.phoneNumber ?? null,
          record.business.category ?? null,
          record.business.source
        );

        const businessId = businessResult.lastInsertRowid;

        // Insert emails
        for (const email of record.emails) {
          const domain = email.address.split('@')[1] ?? null;
          const emailResult = insertEmail.run(
            email.address,
            domain,
            email.confidence,
            email.sourceUrl ?? null,
            email.sourceType,
            email.verificationStatus ?? null,
            email.webProbe?.status ?? null,
            Date.now()
          );

          const emailId = emailResult.lastInsertRowid;

          // Link business to email
          if (businessId && emailId) {
            insertBusinessEmail.run(businessId, emailId);
          }
        }
      }
    });

    transaction();
    logger.debug(`Saved ${records.length} business records to database`);
  }

  /**
   * Check if email exists in database
   */
  async emailExists(email: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    const stmt = this.db.prepare('SELECT 1 FROM emails WHERE address = ? LIMIT 1');
    const result = stmt.get(email.toLowerCase());
    return result !== undefined;
  }

  /**
   * Query emails with filters
   */
  async queryEmails(filters: {
    domain?: string;
    sourceType?: string;
    verificationStatus?: string;
    limit?: number;
    offset?: number;
  }): Promise<EmailMatch[]> {
    if (!this.db) {
      return [];
    }

    let query = 'SELECT * FROM emails WHERE 1=1';
    const params: unknown[] = [];

    if (filters.domain) {
      query += ' AND domain = ?';
      params.push(filters.domain);
    }

    if (filters.sourceType) {
      query += ' AND source_type = ?';
      params.push(filters.sourceType);
    }

    if (filters.verificationStatus) {
      query += ' AND verification_status = ?';
      params.push(filters.verificationStatus);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      address: string;
      confidence: number;
      source_url: string | null;
      source_type: string;
      verification_status: string | null;
    }>;

    return rows.map((row) => ({
      address: row.address,
      confidence: row.confidence,
      sourceUrl: row.source_url ?? undefined,
      sourceType: row.source_type as EmailMatch['sourceType'],
      verificationStatus: (row.verification_status as EmailMatch['verificationStatus']) ?? undefined
    }));
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalEmails: number;
    totalBusinesses: number;
    byDomain: Array<{ domain: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  }> {
    if (!this.db) {
      return {
        totalEmails: 0,
        totalBusinesses: 0,
        byDomain: [],
        byStatus: []
      };
    }

    const totalEmails = this.db.prepare('SELECT COUNT(*) as count FROM emails').get() as { count: number };
    const totalBusinesses = this.db.prepare('SELECT COUNT(*) as count FROM businesses').get() as { count: number };
    const byDomain = this.db
      .prepare('SELECT domain, COUNT(*) as count FROM emails GROUP BY domain ORDER BY count DESC LIMIT 10')
      .all() as Array<{ domain: string; count: number }>;
    const byStatus = this.db
      .prepare('SELECT verification_status as status, COUNT(*) as count FROM emails WHERE verification_status IS NOT NULL GROUP BY verification_status')
      .all() as Array<{ status: string; count: number }>;

    return {
      totalEmails: totalEmails.count,
      totalBusinesses: totalBusinesses.count,
      byDomain,
      byStatus
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // Emails table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL UNIQUE,
        domain TEXT,
        confidence REAL DEFAULT 0.5,
        source_url TEXT,
        source_type TEXT NOT NULL,
        verification_status TEXT,
        web_probe_status TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Businesses table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        website TEXT UNIQUE,
        address TEXT,
        phone TEXT,
        category TEXT,
        source TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Business-Email relationship table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS business_emails (
        business_id INTEGER NOT NULL,
        email_id INTEGER NOT NULL,
        PRIMARY KEY (business_id, email_id),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
      )
    `);
  }

  private createIndexes(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_emails_domain ON emails(domain);
      CREATE INDEX IF NOT EXISTS idx_emails_address ON emails(address);
      CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(verification_status);
      CREATE INDEX IF NOT EXISTS idx_emails_created ON emails(created_at);
      CREATE INDEX IF NOT EXISTS idx_businesses_website ON businesses(website);
    `);
  }
}
