#!/usr/bin/env node

import { Command } from 'commander';
import * as readline from 'readline';
import { detectFramework, getAppName } from './detect.js';
import { parseCodebase } from './parsers/index.js';
import { readSupplementaryDocs } from './lib/readDocs.js';
import { uploadParsedFiles } from './lib/upload.js';
import { listExclusions } from './lib/redact.js';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

async function promptConsent(dir: string, pageCount: number, excludedFiles: string[]): Promise<boolean> {
  console.log('');
  console.log('─────────────────────────────────────────');
  console.log('  PlotUI Scanner v0.2.0 — Consent Check');
  console.log('─────────────────────────────────────────');
  console.log(`  Directory:   ${dir}`);
  console.log(`  Pages found: ${pageCount} UI pages (page.tsx / layout.tsx)`);
  console.log(`  Sends:       Component structure, tab names, form field labels,`);
  console.log(`               route definitions, validation messages`);
  console.log(`  NEVER sends: ${excludedFiles.length > 0 ? excludedFiles.join(', ') : 'none found'}`);
  console.log(`               API keys, secrets, DB credentials, env vars (auto-redacted)`);
  console.log('─────────────────────────────────────────');
  console.log('  Processing happens via Gemini 2.5 Pro (Google).');
  console.log('  Code is NOT stored by PlotUI after knowledge graph generation.');
  console.log('─────────────────────────────────────────');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n  Proceed with scan? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

program
  .name('plotui-scan')
  .description('Scan your codebase and generate a knowledge graph for PlotUI')
  .version('0.2.0')
  .option('-d, --dir <directory>', 'Project directory', process.cwd())
  .option('-o, --output <file>', 'Output file for knowledge graph JSON')
  .option('--no-upload', 'Skip uploading to PlotUI')
  .option('--api-key <key>', 'PlotUI API key')
  .option('--api-url <url>', 'PlotUI API URL', 'https://www.plotui.com/api/scan')
  .option('--yes', 'Skip consent prompt (useful for CI/CD)')
  .action(async (options) => {
    try {
      const resolvedDir = path.resolve(options.dir);

      // Resolve API key: flag > PLOTUI_API_KEY env var
      const resolvedApiKey: string | undefined =
        options.apiKey || process.env.PLOTUI_API_KEY;

      const resolvedApiUrl: string =
        options.apiUrl !== 'https://www.plotui.com/api/scan'
          ? options.apiUrl
          : (process.env.PLOTUI_API_URL ?? 'https://www.plotui.com/api/scan');

      console.log('\nPlotUI Scanner v0.2.0\n');

      // Detect framework
      console.log('Detecting framework...');
      const framework = detectFramework(resolvedDir);
      console.log(`Framework detected: ${framework}`);

      const appName = getAppName(resolvedDir);
      console.log(`App name: ${appName}`);

      // Parse codebase (get count for consent prompt)
      console.log('\nParsing codebase...');
      const { parsedFiles, rawFileContents, extractedPages } = parseCodebase(resolvedDir, framework);
      console.log(`Found ${rawFileContents.length} pages/components`);

      // Read supplementary docs
      console.log('\nReading supplementary documentation...');
      const docs = readSupplementaryDocs(resolvedDir);
      console.log(`Documentation: ${docs ? 'Found' : 'Not found'}`);

      // Consent check (unless --yes flag)
      if (!options.yes) {
        const excluded = listExclusions(resolvedDir);
        const confirmed = await promptConsent(resolvedDir, rawFileContents.length, excluded);
        if (!confirmed) {
          console.log('\nScan cancelled.');
          process.exit(0);
        }
      }
      console.log('');

      // Save raw parsed files to disk if requested
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, JSON.stringify({ framework, appName, parsedFiles, rawFileContents, docs }, null, 2));
        console.log(`Parsed data saved to: ${outputPath}`);
      }

      // Upload to PlotUI
      if (!options.noUpload) {
        if (!resolvedApiKey) {
          console.log('No API key provided. Skipping upload.');
          console.log('Add PLOTUI_API_KEY=your_key to your .env.local or use --api-key flag.');
          console.log('Get your key from: https://www.plotui.com/dashboard/settings');
        } else {
          console.log(`Sending to PlotUI for AI processing (${resolvedApiUrl})...`);
          await uploadParsedFiles({ parsedFiles, rawFileContents, extractedPages, docs, framework, appName }, resolvedApiKey, resolvedApiUrl);
        }
      } else {
        console.log('Skipping upload (--no-upload flag set)');
      }

      console.log('\nDone!');
    } catch (error) {
      console.error('\nError:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
