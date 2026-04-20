import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import type { ParsedFile } from '../types/index.js';
import { safeReadFile, isBlockedFile } from '../lib/redact.js';
import { extractSignals } from './babelExtract.js';

export interface RawFileContent {
  route: string;
  filePath: string;
  content: string;
  contentHash: string;
}

export interface ExtractedPage {
  route: string;
  filePath: string;
  tabs: string[];
  buttons: string[];
  inputs: { label: string; placeholder: string; required: boolean }[];
  dialogs: string[];
  navLinks: { label: string; href: string }[];
  toastMessages: { type: string; message: string }[];
  validationMessages: string[];
  roles: string[];
  statusConditions: string[];
  apiCalls: string[];
  headings: string[];
}

export function parseNextJSApp(rootDir: string): { parsedFiles: ParsedFile[]; rawFileContents: RawFileContent[]; extractedPages: ExtractedPage[] } {
  const parsedFiles: ParsedFile[] = [];
  const rawFileContents: RawFileContent[] = [];
  const extractedPages: ExtractedPage[] = [];

  // ── Locate the pages/routes directory ─────────────────────────────────────
  // Support: App Router (app/), Pages Router (pages/), src/ variants
  const pageFiles: { filePath: string; route: string }[] = [];

  const appDir =
    [path.join(rootDir, 'app'), path.join(rootDir, 'src', 'app')]
      .find(d => fs.existsSync(d));

  const pagesDir =
    [path.join(rootDir, 'pages'), path.join(rootDir, 'src', 'pages')]
      .find(d => fs.existsSync(d));

  if (appDir) scanAppDir(appDir, '', pageFiles);
  if (pagesDir) scanPagesDir(pagesDir, '', pageFiles);

  if (pageFiles.length === 0) return { parsedFiles, rawFileContents, extractedPages };

  // ── Collect shared component files ────────────────────────────────────────
  const componentDirs = [path.join(rootDir, 'src', 'components'), path.join(rootDir, 'components')];
  const componentFiles: string[] = [];
  for (const d of componentDirs) {
    if (fs.existsSync(d)) { collectComponents(d, componentFiles); break; }
  }

  // ── Extract signals from every file using Babel ───────────────────────────
  const allFiles = [
    ...pageFiles.map(f => ({ ...f, isComponent: false })),
    ...componentFiles.map(f => ({
      filePath: f,
      route: `[component] ${path.basename(f, path.extname(f))}`,
      isComponent: true,
    })),
  ];

  for (const { filePath, route, isComponent } of allFiles) {
    if (isBlockedFile(filePath)) continue;
    const content = safeReadFile(filePath);
    if (!content) continue;

    const extracted = extractSignals(content, route, filePath);
    extractedPages.push(extracted);

    if (!isComponent) {
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      rawFileContents.push({ route, filePath, content, contentHash });
      parsedFiles.push({
        path: filePath,
        route,
        component: path.basename(filePath),
        elements: [
          ...extracted.tabs.map(label => ({ type: 'tab' as const, label, action: 'Switch tab view' })),
          ...extracted.buttons.map(label => ({ type: 'button' as const, label, action: 'Button click' })),
          ...extracted.dialogs.map(label => ({ type: 'dialog' as const, label, action: 'Modal dialog' })),
          ...extracted.inputs.map(i => ({ type: 'input' as const, label: i.label || i.placeholder, action: `Input field${i.required ? ' (required)' : ''}` })),
        ],
        imports: [],
        conditions: [...extracted.statusConditions, ...extracted.validationMessages],
        roles: extracted.roles,
      });
    }
  }

  return { parsedFiles, rawFileContents, extractedPages };
}

// ── App Router directory scanner ───────────────────────────────────────────────
// Strips route groups (dashboard), collects page.tsx and layout.tsx
function scanAppDir(dir: string, baseRoute: string, out: { filePath: string; route: string }[]) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file.startsWith('_')) continue;
      const isRouteGroup = file.startsWith('(') && file.endsWith(')');
      scanAppDir(fullPath, isRouteGroup ? baseRoute : `${baseRoute}/${file}`, out);
    } else if (file === 'page.tsx' || file === 'page.ts') {
      out.push({ filePath: fullPath, route: baseRoute || '/' });
    } else if (file === 'layout.tsx' || file === 'layout.ts') {
      out.push({ filePath: fullPath, route: `${baseRoute || '/'} (layout)` });
    }
  }
}

// ── Pages Router directory scanner ────────────────────────────────────────────
// Skips _app, _document, api/ — derives routes from file paths
function scanPagesDir(dir: string, baseRoute: string, out: { filePath: string; route: string }[]) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === 'api') continue;
      scanPagesDir(fullPath, `${baseRoute}/${file}`, out);
    } else if (file.match(/\.(tsx|ts|jsx|js)$/)) {
      if (file.startsWith('_')) continue; // skip _app, _document, _error
      const base = file.replace(/\.(tsx|ts|jsx|js)$/, '');
      const route = base === 'index' ? (baseRoute || '/') : `${baseRoute}/${base}`;
      out.push({ filePath: fullPath, route });
    }
  }
}

function collectComponents(dir: string, files: string[], depth = 0) {
  if (depth > 2) return;
  const MAX = 30;
  if (files.length >= MAX) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'ui' && entry.name !== 'node_modules') {
      collectComponents(full, files, depth + 1);
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      if (!isBlockedFile(full) && !entry.name.startsWith('index')) {
        const size = fs.statSync(full).size;
        if (size > 500) files.push(full); // skip tiny files
      }
    }
  }
}
