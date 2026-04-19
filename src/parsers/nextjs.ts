import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { Project } from 'ts-morph';
import type { ParsedFile } from '../types/index.js';
import { safeReadFile, isBlockedFile } from '../lib/redact.js';

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
  let appDir = path.join(rootDir, 'app');
  if (!fs.existsSync(appDir)) appDir = path.join(rootDir, 'src', 'app');

  const parsedFiles: ParsedFile[] = [];
  const rawFileContents: RawFileContent[] = [];
  const extractedPages: ExtractedPage[] = [];

  if (!fs.existsSync(appDir)) return { parsedFiles, rawFileContents, extractedPages };

  // Collect all TSX/TS page files first
  const pageFiles: { filePath: string; route: string }[] = [];

  function scanDirectory(dir: string, baseRoute: string = '') {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const isRouteGroup = file.startsWith('(') && file.endsWith(')');
        const isPrivate = file.startsWith('_');
        if (!isPrivate && file !== 'node_modules') {
          scanDirectory(fullPath, isRouteGroup ? baseRoute : `${baseRoute}/${file}`);
        }
      } else if (file === 'page.tsx' || file === 'page.ts') {
        pageFiles.push({ filePath: fullPath, route: baseRoute || '/' });
      } else if (file === 'layout.tsx' || file === 'layout.ts') {
        pageFiles.push({ filePath: fullPath, route: `${baseRoute || '/'} (layout)` });
      }
    }
  }

  scanDirectory(appDir);

  // Also collect shared component files
  const componentDirs = [path.join(rootDir, 'src', 'components'), path.join(rootDir, 'components')];
  let componentDir = '';
  for (const d of componentDirs) {
    if (fs.existsSync(d)) { componentDir = d; break; }
  }

  const componentFiles: string[] = [];
  if (componentDir) {
    collectComponents(componentDir, componentFiles);
  }

  // Run ts-morph AST extraction on all files
  const project = new Project({
    compilerOptions: {
      jsx: 4, // JsxEmit.ReactJSX
      allowJs: true,
      resolveJsonModule: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  // Add all page files + component files to project
  const allFiles = [
    ...pageFiles.map(f => ({ ...f, isComponent: false })),
    ...componentFiles.map(f => ({ filePath: f, route: `[component] ${path.basename(f, path.extname(f))}`, isComponent: true })),
  ];

  for (const { filePath } of allFiles) {
    if (!isBlockedFile(filePath) && fs.existsSync(filePath)) {
      project.addSourceFileAtPath(filePath);
    }
  }

  for (const { filePath, route, isComponent } of allFiles) {
    const content = safeReadFile(filePath);
    if (!content) continue;

    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) continue;

    // AST extraction
    const extracted = extractFromAST(sourceFile, route, filePath);
    extractedPages.push(extracted);

    // Also keep raw content for Gemini description generation
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

function extractFromAST(sourceFile: any, route: string, filePath: string): ExtractedPage {
  const result: ExtractedPage = {
    route, filePath,
    tabs: [], buttons: [], inputs: [], dialogs: [], navLinks: [],
    toastMessages: [], validationMessages: [], roles: [],
    statusConditions: [], apiCalls: [], headings: [],
  };

  const text = sourceFile.getFullText();

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabMatches = text.matchAll(/<TabsTrigger[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/TabsTrigger>/g);
  for (const m of tabMatches) {
    const label = m[2].replace(/<[^>]+>/g, '').trim();
    if (label && label.length < 100) result.tabs.push(label);
  }

  // ── Buttons ───────────────────────────────────────────────────────────────
  const btnMatches = text.matchAll(/<Button[^>]*>([\s\S]*?)<\/Button>/g);
  for (const m of btnMatches) {
    const label = m[1].replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
    if (label && label.length > 1 && label.length < 80) result.buttons.push(label);
  }

  // ── Inputs ────────────────────────────────────────────────────────────────
  const inputMatches = text.matchAll(/<Input[^>]*>/g);
  for (const m of inputMatches) {
    const placeholderMatch = m[0].match(/placeholder=["']([^"']*)["']/);
    const typeMatch = m[0].match(/type=["']([^"']*)["']/);
    if (typeMatch?.[1] === 'password' || typeMatch?.[1] === 'hidden') continue; // skip sensitive
    result.inputs.push({
      label: placeholderMatch?.[1] || '',
      placeholder: placeholderMatch?.[1] || '',
      required: m[0].includes('required'),
    });
  }

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const dialogMatches = text.matchAll(/<DialogTitle[^>]*>([\s\S]*?)<\/DialogTitle>/g);
  for (const m of dialogMatches) {
    const label = m[1].replace(/<[^>]+>/g, '').trim();
    if (label && label.length < 120) result.dialogs.push(label);
  }

  // ── Sheet/Drawer titles ───────────────────────────────────────────────────
  const sheetMatches = text.matchAll(/<SheetTitle[^>]*>([\s\S]*?)<\/SheetTitle>/g);
  for (const m of sheetMatches) {
    const label = m[1].replace(/<[^>]+>/g, '').trim();
    if (label && label.length < 120) result.dialogs.push(label);
  }

  // ── NavLinks ───────────────────────────────────────────────────────────────
  const linkMatches = text.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[aA]>/g);
  for (const m of linkMatches) {
    const label = m[2].replace(/<[^>]+>/g, '').trim();
    if (label && label.length < 80) result.navLinks.push({ label, href: m[1] });
  }

  // ── Headings ──────────────────────────────────────────────────────────────
  for (const tag of ['h1', 'h2', 'h3']) {
    const headingMatches = text.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'));
    for (const m of headingMatches) {
      const label = m[1].replace(/<[^>]+>/g, '').trim();
      if (label && label.length < 120) result.headings.push(label);
    }
  }

  // ── Toast messages ────────────────────────────────────────────────────────
  const toastMatches = text.matchAll(/toast\.(error|success|info|warning)\(["'`]([^"'`\n]+)["'`]/g);
  for (const m of toastMatches) {
    result.toastMessages.push({ type: m[1], message: m[2] });
  }

  // ── Validation messages ───────────────────────────────────────────────────
  const valMatches = text.matchAll(/setError[^(]*\(["'`]([^"'`\n]+)["'`]\)/g);
  for (const m of valMatches) result.validationMessages.push(m[1]);

  // ── Status conditions ─────────────────────────────────────────────────────
  const statusMatches = text.matchAll(/status\s*===?\s*["']([^"']+)["']/g);
  for (const m of statusMatches) result.statusConditions.push(m[1]);

  // ── Role detection ────────────────────────────────────────────────────────
  const rolePatterns = [
    /role\s*===?\s*["']([^"']+)["']/g,
    /user\.role\s*===?\s*["']([^"']+)["']/g,
    /session\.user\.role\s*===?\s*["']([^"']+)["']/g,
    /hasRole\(["']([^"']+)["']\)/g,
  ];
  for (const p of rolePatterns) {
    const matches = text.matchAll(p);
    for (const m of matches) if (m[1]) result.roles.push(m[1]);
  }
  result.roles = [...new Set(result.roles)];

  // ── API calls ─────────────────────────────────────────────────────────────
  const fetchMatches = text.matchAll(/fetch\(["'`](\/api[^"'`]+)["'`]/g);
  for (const m of fetchMatches) result.apiCalls.push(m[1]);

  const helperMatches = text.matchAll(/(?:fetchJson|getJson|postJson|putJson|deleteJson)\(["'`](\/[^"'`]+)["'`]/g);
  for (const m of helperMatches) result.apiCalls.push(m[1]);

  result.apiCalls = [...new Set(result.apiCalls)];

  return result;
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
