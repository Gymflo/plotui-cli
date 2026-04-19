#!/usr/bin/env node

import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';
import { loadEnvUpwards } from './detect.js';
import { runScan } from './commands/scan.js';
import { runInit } from './commands/init.js';

// Walk UP the directory tree from CWD loading every .env / .env.local found.
// Handles monorepos where the founder runs from the repo root but .env.local
// lives in apps/web/, OR runs from apps/web/ but .env lives at the root.
loadEnvUpwards(process.cwd(), (envPath, opts) =>
  loadDotenv({ path: envPath, override: opts.override, quiet: true }),
);

const program = new Command();

program
  .name('plotui')
  .description('PlotUI CLI — add AI support to your SaaS in minutes')
  .version('0.6.0');

// ── plotui init ───────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Set up PlotUI: inject widget, scan codebase, open dashboard')
  .option('-d, --dir <directory>', 'Project directory', process.cwd())
  .option('--api-key <key>', 'PlotUI API key (or set PLOTUI_API_KEY env var)')
  .option('--yes', 'Skip confirmation prompts (for CI)')
  .action(async (options) => {
    try {
      await runInit(options);
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── plotui scan ───────────────────────────────────────────────────────────────
program
  .command('scan')
  .description('Scan your codebase and (re)generate the knowledge graph')
  .option('-d, --dir <directory>', 'Project directory (auto-detected if omitted)')
  .option('-o, --output <file>', 'Save parsed JSON to file')
  .option('--no-upload', 'Skip upload to PlotUI')
  .option('--api-key <key>', 'PlotUI API key')
  .option('--api-url <url>', 'PlotUI API URL override')
  .option('--reset', 'Wipe the existing graph before scanning (clean slate)')
  .option('--yes', 'Skip consent prompt (CI/CD)')
  .action(async (options) => {
    try {
      await runScan(options);
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
