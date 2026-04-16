#!/usr/bin/env node
import { Command } from 'commander';
import { runScan } from './commands/scan.js';
import { runInit } from './commands/init.js';
const program = new Command();
program
    .name('plotui')
    .description('PlotUI CLI — add AI support to your SaaS in minutes')
    .version('0.3.0');
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
    }
    catch (err) {
        console.error('\nError:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
// ── plotui scan ───────────────────────────────────────────────────────────────
program
    .command('scan')
    .description('Scan your codebase and (re)generate the knowledge graph')
    .option('-d, --dir <directory>', 'Project directory', process.cwd())
    .option('-o, --output <file>', 'Save parsed JSON to file')
    .option('--no-upload', 'Skip upload to PlotUI')
    .option('--api-key <key>', 'PlotUI API key')
    .option('--api-url <url>', 'PlotUI API URL override')
    .option('--yes', 'Skip consent prompt (CI/CD)')
    .action(async (options) => {
    try {
        await runScan(options);
    }
    catch (err) {
        console.error('\nError:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program.parse();
