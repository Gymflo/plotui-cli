import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { detectFramework, getAppName } from '../detect.js';
import { parseCodebase } from '../parsers/index.js';
import { readSupplementaryDocs } from '../lib/readDocs.js';
import { uploadParsedFiles } from '../lib/upload.js';
import { injectWidget } from '../lib/inject.js';

const API_BASE = process.env.PLOTUI_API_URL?.replace('/api/scan', '') ?? 'https://plotui-web-production.up.railway.app';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function cyan(s: string) { return `\x1b[36m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }

async function fetchOrgInfo(apiKey: string): Promise<{ org_id: string; org_name: string; plan: string; widget_url: string; dashboard_url: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/cli/info`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function runInit(options: { dir?: string; apiKey?: string; yes?: boolean }) {
  const rootDir = path.resolve(options.dir ?? process.cwd());

  console.log('');
  console.log(bold('  ╔═══════════════════════════════════╗'));
  console.log(bold('  ║   PlotUI — Quick Setup            ║'));
  console.log(bold('  ╚═══════════════════════════════════╝'));
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Step 1: API key ──────────────────────────────────────────────────────
    let apiKey = options.apiKey ?? process.env.PLOTUI_API_KEY ?? '';

    if (!apiKey) {
      console.log(dim('  Get your API key at: https://plotui.com/dashboard/settings\n'));
      apiKey = (await ask(rl, cyan('  › Paste your PlotUI API key: '))).trim();
    } else {
      console.log(green('  ✓') + ` API key loaded from ${options.apiKey ? '--api-key flag' : 'PLOTUI_API_KEY env var'}`);
    }

    if (!apiKey) {
      console.error('\n  API key is required. Get one at https://plotui.com/dashboard/settings');
      process.exit(1);
    }

    // ── Step 2: Resolve org info ──────────────────────────────────────────────
    process.stdout.write('\n  Verifying API key…');
    const orgInfo = await fetchOrgInfo(apiKey);
    if (!orgInfo) {
      console.error('\n\n  Invalid API key or could not reach PlotUI. Check your key and try again.');
      process.exit(1);
    }
    console.log(green(' ✓'));
    console.log(`  ${dim('Org:')} ${orgInfo.org_name}  ${dim('Plan:')} ${orgInfo.plan ?? 'free'}`);

    // ── Step 3: Detect framework ──────────────────────────────────────────────
    console.log('');
    process.stdout.write('  Detecting framework…');
    let framework;
    let appName;
    try {
      framework = detectFramework(rootDir);
      appName = getAppName(rootDir);
      console.log(green(' ✓') + `  ${framework} — ${appName}`);
    } catch (e) {
      console.error('\n\n  ' + (e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    // ── Step 4: Inject widget ─────────────────────────────────────────────────
    console.log('');
    process.stdout.write('  Injecting widget script tag…');
    const injectResult = injectWidget(rootDir, framework, orgInfo.org_id, API_BASE);

    if (injectResult.alreadyPresent) {
      console.log(yellow(' ↩') + `  PlotUI already present in ${injectResult.filePath}`);
    } else if (injectResult.injected) {
      console.log(green(' ✓') + `  Injected into ${cyan(injectResult.filePath)}`);
    } else if (injectResult.manualInstructions) {
      console.log(yellow(' !')  + '  Could not auto-inject. Add manually:');
      console.log('');
      console.log('  ' + injectResult.manualInstructions.split('\n').join('\n  '));
    }

    // ── Step 5: Save API key to .env.local ────────────────────────────────────
    const envPath = path.join(rootDir, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    if (!envContent.includes('PLOTUI_API_KEY')) {
      fs.appendFileSync(envPath, `\n# PlotUI\nPLOTUI_API_KEY=${apiKey}\n`);
      console.log(green('  ✓') + `  API key saved to ${cyan('.env.local')}`);
    }

    // ── Step 6: Scan ──────────────────────────────────────────────────────────
    console.log('');
    const shouldScan = options.yes
      ? true
      : (await ask(rl, cyan('  › Scan codebase and generate knowledge graph now? [Y/n] '))).trim().toLowerCase() !== 'n';

    if (shouldScan) {
      console.log('\n  Parsing codebase…');
      const { parsedFiles, rawFileContents } = parseCodebase(rootDir, framework);
      console.log(`  ${dim('Pages found:')} ${rawFileContents.length}`);

      const docs = readSupplementaryDocs(rootDir);
      if (docs) console.log(green('  ✓') + '  Supplementary docs (CLAUDE.md / README) found');

      console.log('\n  Sending to PlotUI for AI processing…');
      console.log(dim('  (No source code is stored — only the parsed structure)'));
      const scanUrl = `${API_BASE}/api/scan`;
      await uploadParsedFiles({ parsedFiles, rawFileContents, docs, framework, appName }, apiKey, scanUrl);
    } else {
      console.log(dim('\n  Skipping scan. Run it later with:'));
      console.log(`  ${cyan('npx plotui-cli scan --api-key <key>')}`);
    }

    // ── Step 7: Done ──────────────────────────────────────────────────────────
    console.log('');
    console.log(bold(green('  ✓ PlotUI is set up!')));
    console.log('');
    console.log(`  ${dim('Dashboard:')} ${cyan(orgInfo.dashboard_url)}`);
    console.log(`  ${dim('Next step:')} Open the Graph Editor and verify your nodes.`);
    console.log('');

    // Try to open the dashboard in a browser
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    try {
      child_process.execSync(`${openCmd} ${orgInfo.dashboard_url}`, { stdio: 'ignore' });
    } catch {
      // Non-fatal — browser open is best-effort
    }

  } finally {
    rl.close();
  }
}
