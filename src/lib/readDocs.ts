import * as fs from 'fs';
import * as path from 'path';
import { safeReadFile, isBlockedFile } from './redact.js';

// Summarizes a single API route.ts file into a compact line
// e.g. "GET/POST /api/officer/drives - manages drives for PLACEMENT_OFFICER"
function summarizeApiRoute(filePath: string, content: string): string {
  const methods = (content.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) || [])
    .map(m => m.replace('export async function ', ''));

  // Extract route from file path
  const apiMatch = filePath.match(/app[\/\\]api[\/\\](.+)[\/\\]route\.ts$/);
  const route = apiMatch ? `/api/${apiMatch[1].replace(/\\/g, '/')}` : filePath;

  // Try to extract a short summary from comments or first few lines
  const firstComment = content.match(/\/\/\s*(.+)/)?.[1]?.slice(0, 80) || '';

  // Extract body field names from destructuring (tells us what data this API accepts)
  const bodyFields = [...new Set(
    [...content.matchAll(/const\s*\{([^}]+)\}\s*=\s*(await\s+)?req\.json\(\)/g)]
      .flatMap(m => m[1].split(',').map(f => f.trim().split(':')[0].trim()))
      .filter(f => f && !f.startsWith('...') && f.length < 40)
  )];

  const parts = [`${methods.join('/')} ${route}`];
  if (firstComment) parts.push(`// ${firstComment}`);
  if (bodyFields.length) parts.push(`  accepts: { ${bodyFields.slice(0, 8).join(', ')} }`);

  return parts.join('\n');
}

export function readSupplementaryDocs(rootDir: string): string {
  const docs: string[] = [];

  // ── 1. Priority markdown docs ─────────────────────────────────────────────
  const priorityFiles = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'README.md', 'openapi.yaml', 'swagger.json'];
  for (const file of priorityFiles) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      const content = safeReadFile(filePath);
      if (content) docs.push(`# ${file}\n\n${content}`);
    }
  }

  // ── 2. Docs directory ─────────────────────────────────────────────────────
  const docsDir = path.join(rootDir, 'docs');
  if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = safeReadFile(path.join(docsDir, file));
      if (content) docs.push(`# docs/${file}\n\n${content}`);
    }
  }

  // ── 3. Prisma / Drizzle schema (safe — no data, just structure) ───────────
  const schemaFiles = [
    path.join(rootDir, 'prisma', 'schema.prisma'),
    path.join(rootDir, 'src', 'lib', 'db', 'schema.ts'),
    path.join(rootDir, 'lib', 'db', 'schema.ts'),
    path.join(rootDir, 'drizzle', 'schema.ts'),
  ];
  for (const sf of schemaFiles) {
    if (fs.existsSync(sf)) {
      const content = safeReadFile(sf);
      if (content) {
        docs.push(`# Database Schema (${path.basename(sf)})\nThis shows the data model structure — field names, types and relationships. No actual data.\n\n${content}`);
      }
    }
  }

  // ── 4. Zod validation schemas (defines form fields + validation rules) ────
  const zodFiles = [
    path.join(rootDir, 'src', 'lib', 'schemas.ts'),
    path.join(rootDir, 'src', 'lib', 'validation.ts'),
    path.join(rootDir, 'lib', 'schemas.ts'),
    path.join(rootDir, 'lib', 'validations.ts'),
  ];
  for (const zf of zodFiles) {
    if (fs.existsSync(zf)) {
      const content = safeReadFile(zf);
      if (content) {
        docs.push(`# Form Validation Schemas (${path.basename(zf)})\nThese Zod schemas define exactly what fields exist in each form and their validation rules from the user's perspective.\n\n${content}`);
      }
    }
  }

  // ── 5. API Routes summary (compact — just method + path + accepted fields) ─
  const apiDirs = [
    path.join(rootDir, 'src', 'app', 'api'),
    path.join(rootDir, 'app', 'api'),
  ];
  for (const apiDir of apiDirs) {
    if (!fs.existsSync(apiDir)) continue;
    const summaries: string[] = [];
    scanApiDir(apiDir, summaries);
    if (summaries.length) {
      docs.push(`# API Routes Summary (${summaries.length} endpoints)\nThis describes what actions are available — helps map what users can do on each page.\n\n${summaries.join('\n\n')}`);
    }
    break;
  }

  return docs.join('\n\n---\n\n');
}

function scanApiDir(dir: string, summaries: string[], maxFiles = 120): void {
  if (summaries.length >= maxFiles) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanApiDir(full, summaries, maxFiles);
    } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
      if (isBlockedFile(full)) continue;
      const content = safeReadFile(full);
      if (content) summaries.push(summarizeApiRoute(full, content));
    }
  }
}
