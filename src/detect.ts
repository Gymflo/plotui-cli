import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Framework } from './types/index.js';

// Common monorepo conventions to peek into when CWD itself isn't an app.
const SUBDIR_CANDIDATES = [
  'apps/web', 'apps/app', 'apps/dashboard', 'apps/frontend',
  'packages/web', 'packages/app', 'packages/frontend',
  'web', 'frontend', 'client', 'app',
];

function frameworkOf(dir: string): Framework | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch { return null; }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const dirsToCheck = [dir, path.join(dir, 'src')];
  const hasAppDir = dirsToCheck.some((d) => fs.existsSync(path.join(d, 'app')));
  const hasPagesDir = dirsToCheck.some((d) => fs.existsSync(path.join(d, 'pages')));
  if (deps.next && hasAppDir) return 'nextjs-app';
  if (deps.next && hasPagesDir) return 'nextjs-pages';
  if (deps.next) return 'nextjs-app';
  if (deps.vite) return 'react-vite';
  if (deps['react-scripts']) return 'cra';
  return null;
}

/**
 * Find the nearest supported app starting from `startDir`.
 * Strategy: check startDir, then known monorepo subdirs, then immediate children.
 * Returns null if nothing supported is found.
 */
export function findSupportedAppDir(startDir: string): { dir: string; framework: Framework } | null {
  const direct = frameworkOf(startDir);
  if (direct) return { dir: startDir, framework: direct };

  // Try common monorepo conventions first (faster than full directory listing)
  for (const sub of SUBDIR_CANDIDATES) {
    const candidate = path.join(startDir, sub);
    const fw = frameworkOf(candidate);
    if (fw) return { dir: candidate, framework: fw };
  }

  // Fall back to scanning immediate children one level deep
  let entries: string[] = [];
  try { entries = fs.readdirSync(startDir); } catch { return null; }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const candidate = path.join(startDir, entry);
    let stat;
    try { stat = fs.statSync(candidate); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const fw = frameworkOf(candidate);
    if (fw) return { dir: candidate, framework: fw };
  }
  return null;
}

export function detectFramework(rootDir: string): Framework {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `package.json not found at ${rootDir}.\n` +
      `  Pass --dir <path> to point at your Next.js / Vite / CRA app, or cd into it first.`
    );
  }
  const fw = frameworkOf(rootDir);
  if (fw) return fw;

  // Try to be helpful — check if there's a supported app in a subdir we can suggest
  const auto = findSupportedAppDir(rootDir);
  const hint = auto
    ? `\n  Looks like your app is at: ${path.relative(rootDir, auto.dir) || '.'}\n  Try:  npx plotui-cli@latest scan --dir ${path.relative(rootDir, auto.dir)}`
    : `\n  Pass --dir <path> to point at your Next.js / Vite / CRA app.`;

  throw new Error(
    `Framework not detected in ${rootDir}.\n` +
    `  Supported: Next.js (App / Pages Router), React + Vite, Create React App.${hint}`
  );
}

export function getAppName(rootDir: string): string {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.name || 'Unknown App';
}

/**
 * Walk UP from startDir loading every .env / .env.local found, so that
 *   apps/web/        ← user's app, may have its own .env.local
 *   monorepo-root/   ← may have shared .env
 * both contribute. Stops at the filesystem root.
 */
export function loadEnvUpwards(startDir: string, loader: (path: string, opts: { override?: boolean }) => unknown): void {
  let dir = path.resolve(startDir);
  const seen = new Set<string>();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    // .env first, then .env.local (which overrides)
    const envPath = path.join(dir, '.env');
    const envLocalPath = path.join(dir, '.env.local');
    if (fs.existsSync(envPath)) loader(envPath, {});
    if (fs.existsSync(envLocalPath)) loader(envLocalPath, { override: true });
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
