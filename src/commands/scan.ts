import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';
import { detectFramework, getAppName, findSupportedAppDir, loadEnvUpwards } from '../detect.js';
import { parseCodebase } from '../parsers/index.js';
import { readSupplementaryDocs } from '../lib/readDocs.js';
import { uploadParsedFiles } from '../lib/upload.js';
import { listExclusions } from '../lib/redact.js';

async function promptForApiKey(resolvedDir: string, nonInteractive: boolean): Promise<string | undefined> {
  if (nonInteractive) return undefined;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const key = await new Promise<string>((resolve) => {
    console.log('');
    console.log('No API key found in environment or .env.local.');
    console.log('Get yours at: https://www.plotui.com/dashboard/settings');
    rl.question('\n  Enter your PlotUI API key (or press Enter to skip): ', (answer) => {
      resolve(answer.trim());
    });
  });

  if (!key) { rl.close(); return undefined; }

  const save = await new Promise<boolean>((resolve) => {
    rl.question('  Save to .env.local for future scans? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });

  if (save) {
    const envPath = path.join(resolvedDir, '.env.local');
    const line = `PLOTUI_API_KEY=${key}\n`;
    if (fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf-8');
      if (!existing.includes('PLOTUI_API_KEY')) {
        fs.appendFileSync(envPath, line);
        console.log(`  Saved to ${envPath}`);
      }
    } else {
      fs.writeFileSync(envPath, line);
      console.log(`  Created ${envPath}`);
    }
  }

  return key;
}

async function promptConsent(dir: string, pageCount: number, excludedFiles: string[]): Promise<boolean> {
  console.log('');
  console.log('─────────────────────────────────────────');
  console.log('  PlotUI Scanner — Consent Check');
  console.log('─────────────────────────────────────────');
  console.log(`  Directory:   ${dir}`);
  console.log(`  Pages found: ${pageCount} UI pages`);
  console.log(`  Sends:       Component structure, tab names, form field labels,`);
  console.log(`               route definitions, validation messages`);
  console.log(`  NEVER sends: ${excludedFiles.length > 0 ? excludedFiles.join(', ') : 'none found'}`);
  console.log(`               API keys, secrets, DB credentials, env vars (auto-redacted)`);
  console.log('─────────────────────────────────────────');
  console.log('  Processing via Gemini 2.5 Flash (Google).');
  console.log('  Code is NOT stored by PlotUI after graph generation.');
  console.log('─────────────────────────────────────────');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n  Proceed with scan? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

export async function runScan(options: {
  dir?: string;
  output?: string;
  upload?: boolean;
  apiKey?: string;
  apiUrl?: string;
  reset?: boolean;
  yes?: boolean;
}) {
  let resolvedDir = path.resolve(options.dir ?? process.cwd());
  const resolvedApiUrl = options.apiUrl ?? process.env.PLOTUI_API_URL ?? 'https://www.plotui.com/api/scan';

  console.log('\nPlotUI Scanner\n');
  console.log('Detecting framework...');

  // If CWD isn't itself a supported app, try to auto-discover one in subdirs (monorepo-friendly).
  // Only kicks in when the user didn't explicitly pass --dir.
  if (!options.dir) {
    const found = findSupportedAppDir(resolvedDir);
    if (found && found.dir !== resolvedDir) {
      console.log(`Found app in subdirectory: ${path.relative(resolvedDir, found.dir)}`);
      resolvedDir = found.dir;
    }
  }

  // Re-load .env / .env.local from the resolved app dir (and upward).
  // This covers: --dir <subdir>, monorepo auto-discovery, or simply running
  // the CLI from a different directory than the project root.
  loadEnvUpwards(resolvedDir, (envFilePath, opts) =>
    loadDotenv({ path: envFilePath, override: opts.override }),
  );

  // Re-read after potential env reload
  const resolvedApiKey = options.apiKey ?? process.env.PLOTUI_API_KEY;

  const framework = detectFramework(resolvedDir);
  console.log(`Framework: ${framework}`);

  const appName = getAppName(resolvedDir);
  console.log(`App: ${appName}`);

  console.log('\nParsing codebase...');
  const { parsedFiles, rawFileContents, extractedPages } = parseCodebase(resolvedDir, framework);
  console.log(`Found ${rawFileContents.length} pages/components`);

  console.log('\nReading supplementary documentation...');
  const docs = readSupplementaryDocs(resolvedDir);
  console.log(`Documentation: ${docs ? 'Found' : 'Not found'}`);

  if (!options.yes) {
    const excluded = listExclusions(resolvedDir);
    const confirmed = await promptConsent(resolvedDir, rawFileContents.length, excluded);
    if (!confirmed) {
      console.log('\nScan cancelled.');
      process.exit(0);
    }
  }

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, JSON.stringify({ framework, appName, parsedFiles, rawFileContents, docs }, null, 2));
    console.log(`\nParsed data saved to: ${outputPath}`);
  }

  if (options.upload !== false) {
    let activeApiKey = resolvedApiKey;
    if (!activeApiKey) {
      activeApiKey = await promptForApiKey(resolvedDir, options.yes ?? false);
      if (!activeApiKey) {
        console.log('\nScan complete. Upload skipped (no API key).');
        console.log('Get your key at: https://www.plotui.com/dashboard/settings');
        console.log('Then run:  npx plotui scan --api-key <key>');
        process.exit(0);
      }
    }
    if (activeApiKey) {
      if (options.reset) {
        const resetUrl = resolvedApiUrl.replace(/\/api\/scan$/, '/api/graph');
        console.log(`\nResetting existing graph at ${resetUrl}...`);
        const res = await fetch(resetUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'reset graph', apiKey: activeApiKey }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Reset failed: ${text}`);
        }
        const data = await res.json() as { deleted?: number; message?: string };
        console.log(`  ✓ ${data.message ?? `Reset ${data.deleted ?? 0} graph(s).`}`);
      }
      console.log(`\nSending to PlotUI (${resolvedApiUrl})...`);
      await uploadParsedFiles({ parsedFiles, rawFileContents, extractedPages, docs, framework, appName }, activeApiKey!, resolvedApiUrl);
    }
  }

  console.log('\nDone!');
}
