import * as fs from 'fs';
import * as path from 'path';
import type { Framework } from '../types/index.js';

export interface InjectResult {
  filePath: string;
  alreadyPresent: boolean;
  injected: boolean;
  /** Instructions to show when auto-injection isn't possible */
  manualInstructions?: string;
}

const SCRIPT_TAG = (orgId: string, apiBase: string) =>
  `<script src="${apiBase}/widget.js" data-org="${orgId}" async></script>`;

// ─── Framework-specific layout locators ──────────────────────────────────────

function findNextjsAppLayout(rootDir: string): string | null {
  const candidates = [
    path.join(rootDir, 'app', 'layout.tsx'),
    path.join(rootDir, 'app', 'layout.jsx'),
    path.join(rootDir, 'src', 'app', 'layout.tsx'),
    path.join(rootDir, 'src', 'app', 'layout.jsx'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

function findNextjsPagesDocument(rootDir: string): string | null {
  const candidates = [
    path.join(rootDir, 'pages', '_document.tsx'),
    path.join(rootDir, 'pages', '_document.jsx'),
    path.join(rootDir, 'pages', '_document.js'),
    path.join(rootDir, 'src', 'pages', '_document.tsx'),
    path.join(rootDir, 'src', 'pages', '_document.jsx'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

function findHtmlEntry(rootDir: string): string | null {
  const candidates = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'public', 'index.html'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

// ─── Injection strategies ─────────────────────────────────────────────────────

/**
 * HTML files: inject before </body>.
 */
function injectIntoHtml(filePath: string, tag: string): 'already_present' | 'injected' | 'not_found' {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes('plotui')) return 'already_present';
  if (!content.includes('</body>')) return 'not_found';
  const updated = content.replace('</body>', `  ${tag}\n</body>`);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return 'injected';
}

/**
 * Next.js App Router layout.tsx: the root layout always has <body>…</body>.
 * We inject the script as the last child of <body> by replacing </body> in JSX.
 *
 * Handles both:
 *   <body>{children}</body>
 *   <body className="...">\n  {children}\n</body>
 */
function injectIntoNextjsLayout(filePath: string, tag: string): 'already_present' | 'injected' | 'not_found' {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes('plotui')) return 'already_present';

  // In JSX, self-closing </body> is just </body>
  if (!content.includes('</body>')) return 'not_found';

  // Insert the script tag as a JSX expression sibling of {children}
  const jsxTag = `      {/* PlotUI support widget */}\n      <script src="${tag.match(/src="([^"]+)"/)?.[1]}" data-org="${tag.match(/data-org="([^"]+)"/)?.[1]}" async={true}></script>`;
  const updated = content.replace('</body>', `${jsxTag}\n      </body>`);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return 'injected';
}

/**
 * Next.js Pages Router: look for _document.tsx with <body>.
 * If not found, we'll print manual instructions instead.
 */
function injectIntoNextjsDocument(filePath: string, tag: string): 'already_present' | 'injected' | 'not_found' {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes('plotui')) return 'already_present';
  if (!content.includes('</body>') && !content.includes('<Body>') && !content.includes('<Main />')) return 'not_found';

  if (content.includes('</body>')) {
    const jsxTag = `        {/* PlotUI support widget */}\n        <script src="${tag.match(/src="([^"]+)"/)?.[1]}" data-org="${tag.match(/data-org="([^"]+)"/)?.[1]}" async></script>`;
    const updated = content.replace('</body>', `${jsxTag}\n        </body>`);
    fs.writeFileSync(filePath, updated, 'utf-8');
    return 'injected';
  }
  return 'not_found';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function injectWidget(
  rootDir: string,
  framework: Framework,
  orgId: string,
  apiBase = 'https://www.plotui.com'
): InjectResult {
  const tag = SCRIPT_TAG(orgId, apiBase);

  if (framework === 'nextjs-app') {
    const layoutPath = findNextjsAppLayout(rootDir);
    if (!layoutPath) {
      return {
        filePath: 'app/layout.tsx',
        alreadyPresent: false,
        injected: false,
        manualInstructions: manualInstructions(tag, 'app/layout.tsx'),
      };
    }
    const result = injectIntoNextjsLayout(layoutPath, tag);
    return {
      filePath: path.relative(rootDir, layoutPath),
      alreadyPresent: result === 'already_present',
      injected: result === 'injected',
      manualInstructions: result === 'not_found' ? manualInstructions(tag, path.relative(rootDir, layoutPath)) : undefined,
    };
  }

  if (framework === 'nextjs-pages') {
    const docPath = findNextjsPagesDocument(rootDir);
    if (docPath) {
      const result = injectIntoNextjsDocument(docPath, tag);
      if (result !== 'not_found') {
        return {
          filePath: path.relative(rootDir, docPath),
          alreadyPresent: result === 'already_present',
          injected: result === 'injected',
        };
      }
    }
    // No _document.tsx — create one
    const newDocPath = path.join(rootDir, 'pages', '_document.tsx');
    const docContent = generateDocument(tag);
    fs.mkdirSync(path.dirname(newDocPath), { recursive: true });
    fs.writeFileSync(newDocPath, docContent, 'utf-8');
    return {
      filePath: path.relative(rootDir, newDocPath),
      alreadyPresent: false,
      injected: true,
    };
  }

  // react-vite or cra — inject into index.html
  const htmlPath = findHtmlEntry(rootDir);
  if (!htmlPath) {
    return {
      filePath: 'index.html',
      alreadyPresent: false,
      injected: false,
      manualInstructions: manualInstructions(tag, 'index.html'),
    };
  }
  const result = injectIntoHtml(htmlPath, tag);
  return {
    filePath: path.relative(rootDir, htmlPath),
    alreadyPresent: result === 'already_present',
    injected: result === 'injected',
    manualInstructions: result === 'not_found' ? manualInstructions(tag, path.relative(rootDir, htmlPath)) : undefined,
  };
}

function manualInstructions(tag: string, file: string): string {
  return `Add this tag before </body> in ${file}:\n\n  ${tag}`;
}

function generateDocument(tag: string): string {
  const src = tag.match(/src="([^"]+)"/)?.[1] ?? '';
  const orgId = tag.match(/data-org="([^"]+)"/)?.[1] ?? '';
  return `import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
        {/* PlotUI support widget */}
        <script src="${src}" data-org="${orgId}" async></script>
      </body>
    </Html>
  );
}
`;
}
