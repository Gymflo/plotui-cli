import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { detectFramework, getAppName } from '../detect.js';
import { parseCodebase } from '../parsers/index.js';
import { readSupplementaryDocs } from '../lib/readDocs.js';
import { uploadParsedFiles } from '../lib/upload.js';
import { listExclusions } from '../lib/redact.js';

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
  yes?: boolean;
}) {
  const resolvedDir = path.resolve(options.dir ?? process.cwd());
  const resolvedApiKey = options.apiKey ?? process.env.PLOTUI_API_KEY;
  const resolvedApiUrl = options.apiUrl ?? process.env.PLOTUI_API_URL ?? 'https://www.plotui.com/api/scan';

  console.log('\nPlotUI Scanner\n');
  console.log('Detecting framework...');
  const framework = detectFramework(resolvedDir);
  console.log(`Framework: ${framework}`);

  const appName = getAppName(resolvedDir);
  console.log(`App: ${appName}`);

  console.log('\nParsing codebase...');
  const { parsedFiles, rawFileContents } = parseCodebase(resolvedDir, framework);
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
    if (!resolvedApiKey) {
      console.log('\nNo API key provided. Skipping upload.');
      console.log('Add PLOTUI_API_KEY to .env.local or use --api-key flag.');
      console.log('Get your key: https://www.plotui.com/dashboard/settings');
    } else {
      console.log(`\nSending to PlotUI (${resolvedApiUrl})...`);
      await uploadParsedFiles({ parsedFiles, rawFileContents, docs, framework, appName }, resolvedApiKey, resolvedApiUrl);
    }
  }

  console.log('\nDone!');
}
