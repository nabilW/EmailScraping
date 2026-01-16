#!/usr/bin/env node
/**
 * Merge new emails from emails.txt into dataemails.txt archive
 * This script should be run after scraping to archive new emails
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), 'output');
const ARCHIVE_FILE = join(OUTPUT_DIR, 'dataemails.txt');
const NEW_EMAILS_FILE = join(OUTPUT_DIR, 'emails.txt');

function loadEmails(filename: string): Set<string> {
  const filePath = join(OUTPUT_DIR, filename);
  if (!existsSync(filePath)) {
    return new Set<string>();
  }
  const content = readFileSync(filePath, 'utf8');
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && line.includes('@'))
  );
}

function main() {
  console.log('Merging new emails into archive...\n');
  
  const archiveEmails = loadEmails('dataemails.txt');
  const newEmails = loadEmails('emails.txt');
  
  console.log(`Archive (dataemails.txt): ${archiveEmails.size} emails`);
  console.log(`New emails (emails.txt): ${newEmails.size} emails`);
  
  // Combine all emails
  const allEmails = new Set<string>([...archiveEmails, ...newEmails]);
  const newCount = allEmails.size - archiveEmails.size;
  
  // Write to archive (sorted)
  const sorted = Array.from(allEmails).sort((a, b) => a.localeCompare(b));
  const payload = `${sorted.join('\n')}\n`;
  writeFileSync(ARCHIVE_FILE, payload, 'utf8');
  
  // Clear emails.txt for next scraping session
  writeFileSync(NEW_EMAILS_FILE, '', 'utf8');
  
  console.log(`\n✓ Merged ${newCount} new emails into archive`);
  console.log(`✓ Archive now contains ${allEmails.size} total emails`);
  console.log(`✓ Cleared emails.txt for next scraping session`);
}

main();

