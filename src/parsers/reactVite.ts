import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import type { ParsedFile, Framework } from '../types/index.js';
import type { RawFileContent, ExtractedPage } from './nextjs.js';
import { extractSignals, extractRouteDeclarations, extractImports } from './babelExtract.js';
import { safeReadFile, isBlockedFile } from '../lib/redact.js';

export interface ReactFamilyResult {
  parsedFiles: ParsedFile[];
  rawFileContents: RawFileContent[];
  extractedPages: ExtractedPage[];
}

/**
 * Parser for non-Next.js React-family frameworks:
 *   - react-vite / cra   → src/pages/, src/views/, src/screens/, src/routes/
 *   - gatsby              → src/pages/
 *   - remix               → app/routes/ (dot-separated filenames → URL segments)
 *
 * All extraction uses the shared Babel AST engine for consistent signal quality.
 */
export function parseReactFamily(rootDir: string, framework: Framework): ReactFamilyResult {
  const parsedFiles: ParsedFile[] = [];
  const rawFileContents: RawFileContent[] = [];
  const extractedPages: ExtractedPage[] = [];

  const pageFiles: { filePath: string; route: string }[] = [];

  if (framework === 'remix') {
    scanRemixRoutes(rootDir, pageFiles);
  } else if (framework === 'gatsby') {
    const gatsbyPages = path.join(rootDir, 'src', 'pages');
    if (fs.existsSync(gatsbyPages)) scanFileBasedDir(gatsbyPages, '', pageFiles);
  } else {
    // react-vite / cra — look for common page directory conventions
    const candidates = ['src/pages', 'src/views', 'src/screens', 'src/routes'].map(d => path.join(rootDir, d));
    for (const dir of candidates) {
      if (fs.existsSync(dir)) { scanFileBasedDir(dir, '', pageFiles); break; }
    }
    // Fallback: parse <Route path="..."> declarations from App.tsx / main.tsx
    // and resolve each referenced component back to its source file.
    if (pageFiles.length === 0) {
      for (const f of ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.jsx']) {
        const full = path.join(rootDir, f);
        if (!fs.existsSync(full)) continue;
        const appContent = safeReadFile(full);
        if (!appContent) continue;

        const routes = extractRouteDeclarations(appContent);
        const imports = extractImports(appContent);

        if (routes.length === 0) {
          // No <Route> found — treat entire App.tsx as a single "/" page.
          pageFiles.push({ filePath: full, route: '/' });
        } else {
          for (const { path: routePath, componentName } of routes) {
            const resolved = componentName ? resolveImport(imports.get(componentName), path.dirname(full)) : null;
            pageFiles.push({ filePath: resolved ?? full, route: routePath });
          }
        }
        break;
      }
    }
  }

  for (const { filePath, route } of pageFiles) {
    if (isBlockedFile(filePath)) continue;
    const content = safeReadFile(filePath);
    if (!content) continue;

    const extracted = extractSignals(content, route, filePath);
    extractedPages.push(extracted);

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

  return { parsedFiles, rawFileContents, extractedPages };
}

// ── File-based routing scanner (Gatsby, CRA, Vite pages/) ─────────────────────
function scanFileBasedDir(dir: string, baseRoute: string, out: { filePath: string; route: string }[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      scanFileBasedDir(full, `${baseRoute}/${entry.name}`, out);
    } else if (entry.isFile() && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const base = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
      const route = base === 'index' ? (baseRoute || '/') : `${baseRoute}/${base}`;
      out.push({ filePath: full, route });
    }
  }
}

// ── Remix routes scanner ───────────────────────────────────────────────────────
// Remix uses dot-separated filenames: officer.students.tsx → /officer/students
// Optional segments ($) and index routes (_index) are handled here.
function scanRemixRoutes(rootDir: string, out: { filePath: string; route: string }[]) {
  const routesDir =
    [path.join(rootDir, 'app', 'routes'), path.join(rootDir, 'routes')]
      .find(d => fs.existsSync(d));
  if (!routesDir) return;

  for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;

    const base = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
    const route = remixFileToRoute(base);
    out.push({ filePath: path.join(routesDir, entry.name), route });
  }
}

function remixFileToRoute(filename: string): string {
  // _index → /
  if (filename === '_index') return '/';
  const segments = filename
    .split('.')
    .map(seg => {
      if (seg === '_index') return null;       // index segment — omit
      if (seg.startsWith('_')) return null;    // pathless layout — omit
      if (seg.startsWith('(') && seg.endsWith(')')) return null; // optional — omit
      if (seg.startsWith('$')) return `:${seg.slice(1)}`; // $id → :id
      return seg;
    })
    .filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Resolve a relative import specifier to an actual source file on disk.
 * Tries common TSX/TS/JSX/JS extensions and index.* fallbacks.
 *   './pages/Dashboard'  → /abs/src/pages/Dashboard.tsx
 *   './pages/Dashboard'  → /abs/src/pages/Dashboard/index.tsx
 */
function resolveImport(spec: string | undefined, fromDir: string): string | null {
  if (!spec) return null;
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // skip node_modules
  const base = path.resolve(fromDir, spec);
  const exts = ['.tsx', '.ts', '.jsx', '.js'];
  for (const ext of exts) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of exts) {
    const idx = path.join(base, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// Keep old export name for backwards compat with parsers/index.ts
export function parseReactVite(rootDir: string): ParsedFile[] {
  return parseReactFamily(rootDir, 'react-vite').parsedFiles;
}
