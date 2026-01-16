#!/usr/bin/env node
/**
 * Run comprehensive scraping session for Russian, Middle East, and Africa targets
 */

import { execSync } from 'child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKDIR = process.cwd();
const OUTPUT_DIR = join(WORKDIR, 'output');
const LOGS_DIR = join(OUTPUT_DIR, 'logs');

interface ScrapingTarget {
  name: string;
  seedFile?: string;
  queryFile?: string;
  description: string;
}

const TARGETS: ScrapingTarget[] = [
  {
    name: 'target1',
    queryFile: 'queries/middle_east_africa.txt',
    description: 'Target 1'
  }
];

function runScraping(target: ScrapingTarget): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(LOGS_DIR, `${target.name}_${timestamp}.log`);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting: ${target.description}`);
  console.log(`${'='.repeat(60)}\n`);

  let command = 'npm run dev --';
  
  if (target.seedFile && existsSync(join(WORKDIR, target.seedFile))) {
    command += ` --seed ${target.seedFile}`;
  }
  
  if (target.queryFile && existsSync(join(WORKDIR, target.queryFile))) {
    command += ` --queries ${target.queryFile}`;
  }
  
  command += ' --require-reachable';
  
  console.log(`Command: ${command}`);
  console.log(`Log file: ${logFile}\n`);

  try {
    execSync(command, {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: WORKDIR,
      env: { ...process.env }
    });
    console.log(`✓ Completed: ${target.description}\n`);
  } catch (error) {
    console.error(`✗ Error in ${target.description}:`, error);
  }
}

function main() {
  console.log('🚀 Starting Comprehensive Scraping Session');
  console.log('Targets configured in TARGETS array\n');

  for (const target of TARGETS) {
    runScraping(target);
    
    // Small delay between targets
    console.log('Waiting 5 seconds before next target...\n');
    execSync('sleep 5', { stdio: 'inherit' });
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All scraping sessions completed!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('  1. Check results: npm run merge:archive');
  console.log('  2. View emails: cat output/emails.txt');
  console.log('  3. Check logs: ls -lh output/logs/');
}

main();

