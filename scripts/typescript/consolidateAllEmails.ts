#!/usr/bin/env node
/**
 * Consolidate ALL emails from all files in the project into dataemails.txt
 * This script searches through all email files, CSV files, and JSONL files
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

const OUTPUT_DIR = join(process.cwd(), 'output');
const ARCHIVE_FILE = join(OUTPUT_DIR, 'dataemails.txt');

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmailsFromText(content: string): Set<string> {
  const emails = new Set<string>();
  const matches = content.match(EMAIL_REGEX);
  if (matches) {
    for (const email of matches) {
      const normalized = email.trim().toLowerCase();
      if (normalized.length > 0 && normalized.includes('@')) {
        emails.add(normalized);
      }
    }
  }
  return emails;
}

function loadEmailsFromFile(filePath: string): Set<string> {
  if (!existsSync(filePath)) {
    return new Set<string>();
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return extractEmailsFromText(content);
  } catch (error) {
    console.warn(`Failed to read ${filePath}:`, error);
    return new Set<string>();
  }
}

function loadEmailsFromCSV(filePath: string): Set<string> {
  if (!existsSync(filePath)) {
    return new Set<string>();
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    }) as Array<Record<string, unknown>>;

    const emails = new Set<string>();
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        if (!key || !/email/i.test(key)) continue;
        if (typeof value !== 'string') continue;
        const extracted = extractEmailsFromText(value);
        extracted.forEach((e) => emails.add(e));
      }
      // Also check all values for email patterns
      const allValues = Object.values(record).join(' ');
      const extracted = extractEmailsFromText(allValues);
      extracted.forEach((e) => emails.add(e));
    }
    return emails;
  } catch (error) {
    console.warn(`Failed to parse CSV ${filePath}:`, error);
    return new Set<string>();
  }
}

function loadEmailsFromJSONL(filePath: string): Set<string> {
  if (!existsSync(filePath)) {
    return new Set<string>();
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const emails = new Set<string>();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
          if (typeof value === 'string' && /email/i.test(key)) {
            const extracted = extractEmailsFromText(value);
            extracted.forEach((e) => emails.add(e));
          }
          // Check all string values
          if (typeof value === 'string') {
            const extracted = extractEmailsFromText(value);
            extracted.forEach((e) => emails.add(e));
          }
        }
      } catch {
        // If not JSON, try extracting emails directly
        const extracted = extractEmailsFromText(line);
        extracted.forEach((e) => emails.add(e));
      }
    }
    return emails;
  } catch (error) {
    console.warn(`Failed to parse JSONL ${filePath}:`, error);
    return new Set<string>();
  }
}

function main() {
  console.log('🔍 Consolidating ALL emails from all files in the project...\n');

  const allEmails = new Set<string>();
  const sources: Array<{ file: string; count: number }> = [];

  // 1. Check all .txt files in output/
  console.log('📄 Scanning .txt files...');
  const txtFiles = [
    'emails.txt',
    'dataemails.txt',
    'organized_emails.txt',
    'filtered_emails.txt',
    'new_emails.txt'
  ];

  for (const file of txtFiles) {
    const filePath = join(OUTPUT_DIR, file);
    const emails = loadEmailsFromFile(filePath);
    if (emails.size > 0) {
      sources.push({ file, count: emails.size });
      emails.forEach((e) => allEmails.add(e));
      console.log(`  ✓ ${file}: ${emails.size} emails`);
    }
  }

  // 2. Check archive folder
  console.log('\n📦 Scanning archive folder...');
  const archiveDir = join(OUTPUT_DIR, 'archive');
  if (existsSync(archiveDir)) {
    const archiveFiles = readdirSync(archiveDir).filter((f) => f.endsWith('.txt'));
    for (const file of archiveFiles) {
      const filePath = join(archiveDir, file);
      const emails = loadEmailsFromFile(filePath);
      if (emails.size > 0) {
        sources.push({ file: `archive/${file}`, count: emails.size });
        emails.forEach((e) => allEmails.add(e));
        console.log(`  ✓ archive/${file}: ${emails.size} emails`);
      }
    }
  }

  // 3. Check CSV files
  console.log('\n📊 Scanning .csv files...');
  const csvFiles = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.csv'));
  for (const file of csvFiles) {
    const filePath = join(OUTPUT_DIR, file);
    const emails = loadEmailsFromCSV(filePath);
    if (emails.size > 0) {
      sources.push({ file, count: emails.size });
      emails.forEach((e) => allEmails.add(e));
      console.log(`  ✓ ${file}: ${emails.size} emails`);
    }
  }

  // 4. Check extract-emails CSV folder
  console.log('\n📁 Scanning extract-emails folder...');
  const extractEmailsDir = join(OUTPUT_DIR, 'extract-emails');
  if (existsSync(extractEmailsDir)) {
    const csvFiles = readdirSync(extractEmailsDir).filter((f) => f.endsWith('.csv'));
    let totalExtract = 0;
    for (const file of csvFiles) {
      const filePath = join(extractEmailsDir, file);
      const emails = loadEmailsFromCSV(filePath);
      if (emails.size > 0) {
        totalExtract += emails.size;
        emails.forEach((e) => allEmails.add(e));
      }
    }
    if (totalExtract > 0) {
      sources.push({ file: 'extract-emails/*.csv', count: totalExtract });
      console.log(`  ✓ extract-emails/*.csv: ${totalExtract} emails`);
    }
  }

  // 5. Check JSONL files
  console.log('\n📋 Scanning .jsonl files...');
  const jsonlFiles = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.jsonl'));
  for (const file of jsonlFiles) {
    const filePath = join(OUTPUT_DIR, file);
    const emails = loadEmailsFromJSONL(filePath);
    if (emails.size > 0) {
      sources.push({ file, count: emails.size });
      emails.forEach((e) => allEmails.add(e));
      console.log(`  ✓ ${file}: ${emails.size} emails`);
    }
  }

  // Write consolidated emails to dataemails.txt
  const sorted = Array.from(allEmails).sort((a, b) => a.localeCompare(b));
  const payload = `${sorted.join('\n')}\n`;
  writeFileSync(ARCHIVE_FILE, payload, 'utf8');

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Consolidated ${allEmails.size} unique emails into dataemails.txt`);
  console.log(`📊 Processed ${sources.length} source files`);
  console.log('='.repeat(50));
}

main();

