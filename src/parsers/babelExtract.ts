/**
 * Shared Babel AST extraction engine.
 *
 * Uses @babel/parser to build a proper AST and a lightweight recursive
 * walker instead of @babel/traverse (avoids ESM/CJS interop complexity).
 *
 * Replaces all regex-based extraction in the legacy nextjs.ts / reactVite.ts.
 */

import { parse } from '@babel/parser';
import type { ExtractedPage } from './nextjs.js';

// ── Lightweight recursive AST walker ──────────────────────────────────────────

type Visitor = (node: AnyNode) => void;

interface AnyNode {
  type: string;
  [key: string]: unknown;
}

function walk(node: AnyNode, visit: Visitor): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    // Skip source-location fields — not AST children
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'errors') continue;
    const val = node[key] as unknown;
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === 'object' && typeof (child as AnyNode).type === 'string') {
          walk(child as AnyNode, visit);
        }
      }
    } else if (val && typeof val === 'object' && typeof (val as AnyNode).type === 'string') {
      walk(val as AnyNode, visit);
    }
  }
}

// ── JSX helpers ───────────────────────────────────────────────────────────────

function jsxName(opening: AnyNode): string {
  const name = opening.name as AnyNode;
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name as string;
  if (name.type === 'JSXMemberExpression') {
    const obj = name.object as AnyNode;
    const prop = name.property as AnyNode;
    return `${obj.name as string}.${prop.name as string}`;
  }
  return '';
}

function getAttr(attrs: AnyNode[], attrName: string): string | null {
  for (const attr of attrs) {
    if (attr.type !== 'JSXAttribute') continue;
    const name = attr.name as AnyNode;
    if (name.name !== attrName) continue;
    const val = attr.value as AnyNode | null;
    if (!val) return 'true';
    if (val.type === 'StringLiteral') return val.value as string;
    if (val.type === 'JSXExpressionContainer') {
      const expr = val.expression as AnyNode;
      if (expr.type === 'StringLiteral') return expr.value as string;
      // Template literal with no expressions: `static-string`
      if (expr.type === 'TemplateLiteral') {
        const quasis = expr.quasis as AnyNode[];
        if (quasis.length === 1) {
          const cooked = (quasis[0].value as { cooked: string }).cooked;
          return cooked ?? null;
        }
      }
    }
  }
  return null;
}

function hasAttr(attrs: AnyNode[], attrName: string): boolean {
  return attrs.some(a => a.type === 'JSXAttribute' && (a.name as AnyNode).name === attrName);
}

function jsxChildText(children: AnyNode[]): string {
  const parts: string[] = [];
  for (const child of children ?? []) {
    if (child.type === 'JSXText') {
      const t = (child.value as string).replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    } else if (child.type === 'JSXExpressionContainer') {
      const expr = child.expression as AnyNode;
      if (expr.type === 'StringLiteral') parts.push(expr.value as string);
    } else if (child.type === 'JSXElement') {
      const inner = jsxChildText(child.children as AnyNode[]);
      if (inner) parts.push(inner);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ── Role detection helpers ─────────────────────────────────────────────────────

const ROLE_PROP_NAMES = new Set(['role', 'userRole', 'currentRole', 'userType']);

/**
 * Unwrap TypeScript type-assertion / non-null wrappers so downstream checks
 * see the actual underlying expression.
 *   (user.role as string) === 'admin'   → MemberExpression user.role
 *   user.role!                          → MemberExpression user.role
 *   <string>user.role                   → MemberExpression user.role
 */
function unwrap(node: AnyNode): AnyNode {
  let current = node;
  while (current && ['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'ParenthesizedExpression'].includes(current.type)) {
    current = current.expression as AnyNode;
  }
  return current;
}

function isRoleAccess(node: AnyNode): boolean {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'Identifier') {
    return ROLE_PROP_NAMES.has(n.name as string);
  }
  // user.role, session.user.role, auth.role, AND optional chaining user?.role
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    const prop = n.property as AnyNode;
    if (prop.type === 'Identifier' && prop.name === 'role') return true;
  }
  return false;
}

/**
 * Extract string from a literal or single-segment template literal.
 * Handles:
 *   'hello'               → 'hello'
 *   `hello`               → 'hello'
 *   `/api/users/${id}`    → '/api/users/' (prefix up to first expression)
 */
function stringValue(node: AnyNode | undefined): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value as string;
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as AnyNode[];
    if (quasis?.length > 0) {
      const first = quasis[0].value as { cooked: string; raw: string };
      return first.cooked ?? first.raw ?? null;
    }
  }
  return null;
}

// ── React Router centralized routing extraction ──────────────────────────────
// Parses `<Route path="..." element={<Component />}>` out of an App.tsx /
// main.tsx file. Returns one record per route declaration.

export interface RouteDeclaration {
  path: string;
  componentName: string | null;
}

export function extractRouteDeclarations(content: string): RouteDeclaration[] {
  const routes: RouteDeclaration[] = [];
  let ast: AnyNode;
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    }) as unknown as AnyNode;
  } catch {
    return routes;
  }

  walk(ast, (node) => {
    if (node.type !== 'JSXElement') return;
    const opening = node.openingElement as AnyNode;
    if (jsxName(opening) !== 'Route') return;
    const attrs = (opening.attributes as AnyNode[]) ?? [];
    const path = getAttr(attrs, 'path');
    if (!path) return;

    // Try to read element={<Component />} to capture the referenced component
    let componentName: string | null = null;
    for (const attr of attrs) {
      if (attr.type !== 'JSXAttribute' || (attr.name as AnyNode).name !== 'element') continue;
      const val = attr.value as AnyNode | null;
      if (val?.type === 'JSXExpressionContainer') {
        const expr = val.expression as AnyNode;
        if (expr.type === 'JSXElement') {
          componentName = jsxName(expr.openingElement as AnyNode) || null;
        }
      }
    }
    routes.push({ path, componentName });
  });

  return routes;
}

/**
 * Resolve default + named imports from a file.
 * Returns Map<localName, sourceModulePath>.
 *   import Dashboard from './pages/Dashboard'  → Map('Dashboard', './pages/Dashboard')
 *   import { Home } from './pages/Home'         → Map('Home', './pages/Home')
 */
export function extractImports(content: string): Map<string, string> {
  const imports = new Map<string, string>();
  let ast: AnyNode;
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    }) as unknown as AnyNode;
  } catch {
    return imports;
  }

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') return;
    const source = (node.source as AnyNode).value as string;
    const specifiers = (node.specifiers as AnyNode[]) ?? [];
    for (const spec of specifiers) {
      const localName = (spec.local as AnyNode).name as string;
      imports.set(localName, source);
    }
  });

  return imports;
}

// ── Main extraction function ───────────────────────────────────────────────────

export function extractSignals(content: string, route: string, filePath: string): ExtractedPage {
  const result: ExtractedPage = {
    route, filePath,
    tabs: [], buttons: [], inputs: [], dialogs: [], navLinks: [],
    toastMessages: [], validationMessages: [], roles: [],
    statusConditions: [], apiCalls: [], headings: [],
    marketingText: '',
  };

  const isMarketingRoute = route === '/' || /^\/(about|contact|pricing|faq|help|terms|privacy)/i.test(route);
  const marketingChunks: string[] = [];

  let ast: AnyNode;
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true, // keep going even with syntax errors
    }) as unknown as AnyNode;
  } catch {
    return result; // unparseable file — return empty
  }

  // ── Pass 1: extract nav arrays like const adminNav = [{href:"/x",title:"X"}]
  // This catches the common React pattern where navigation is defined as a
  // static array of objects and rendered via <Link href={item.href}>.
  const navArrayHrefs = new Map<string, { href: string; label: string }[]>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const init = node.init as AnyNode | null;
    if (!init || init.type !== 'ArrayExpression') return;
    const elements = (init.elements as AnyNode[]) ?? [];
    const pairs: { href: string; label: string }[] = [];
    for (const el of elements) {
      if (!el || el.type !== 'ObjectExpression') continue;
      const props = (el.properties as AnyNode[]) ?? [];
      let href: string | null = null;
      let label: string | null = null;
      for (const prop of props) {
        if (prop.type !== 'ObjectProperty') continue;
        const key = prop.key as AnyNode;
        const keyName = key.type === 'Identifier' ? key.name as string : null;
        const val = prop.value as AnyNode;
        const valStr = stringValue(val);
        if (keyName === 'href' && valStr?.startsWith('/')) href = valStr;
        if ((keyName === 'title' || keyName === 'label' || keyName === 'name') && valStr) label = valStr;
      }
      if (href) pairs.push({ href, label: label ?? href });
    }
    if (pairs.length > 0) {
      const id = ((node.id as AnyNode)?.name as string) ?? 'unknown';
      navArrayHrefs.set(id, pairs);
    }
  });

  // Flatten all nav-array hrefs into navLinks
  for (const pairs of navArrayHrefs.values()) {
    for (const { href, label } of pairs) {
      result.navLinks.push({ href, label });
    }
  }

  walk(ast, (node) => {
    // ── JSXElement: covers everything that has children ────────────────────
    if (node.type === 'JSXElement') {
      const opening = node.openingElement as AnyNode;
      const name = jsxName(opening);
      const attrs = (opening.attributes as AnyNode[]) ?? [];
      const children = (node.children as AnyNode[]) ?? [];

      // ── NavLinks: <Link href="/..."> or <a href="/..."> ──────────────────
      if (name === 'Link' || name === 'a') {
        const href = getAttr(attrs, 'href');
        if (href && href.startsWith('/')) {
          let label = jsxChildText(children).slice(0, 80);
          if (!label || label.length < 2) {
            label = getAttr(attrs, 'aria-label') || getAttr(attrs, 'title') || '';
          }
          if (label && label.length > 0) result.navLinks.push({ label, href });
        }
      }

      // ── Buttons ──────────────────────────────────────────────────────────
      if (name === 'Button' || name === 'button' || name === 'IconButton') {
        let label = jsxChildText(children).slice(0, 80);
        if (!label || label.length < 2) {
          label = getAttr(attrs, 'aria-label') || getAttr(attrs, 'title') || '';
        }
        if (label && label.length > 0) result.buttons.push(label);
      }

      // ── Tabs ─────────────────────────────────────────────────────────────
      if (name === 'TabsTrigger') {
        const label = jsxChildText(children).slice(0, 100);
        if (label) result.tabs.push(label);
      }

      // ── Semantic Dashboard UI & Headings ─────────────────────────────────
      if (['h1', 'h2', 'h3', 'CardTitle', 'CardDescription', 'CardHeader', 'Badge', 'Label', 'dt', 'dd', 'Legend'].includes(name)) {
        const label = jsxChildText(children).slice(0, 120);
        if (label) result.headings.push(label);
      }

      // ── Dialog/Sheet titles ───────────────────────────────────────────────
      if (name === 'DialogTitle' || name === 'SheetTitle' || name === 'AlertDialogTitle') {
        const label = jsxChildText(children).slice(0, 120);
        if (label) result.dialogs.push(label);
      }

      // ── Inputs ───────────────────────────────────────────────────────────
      if (name === 'Input' || name === 'input' || name === 'Textarea' || name === 'textarea') {
        const type = getAttr(attrs, 'type');
        if (type === 'password' || type === 'hidden') return;
        result.inputs.push({
          label: getAttr(attrs, 'placeholder') ?? '',
          placeholder: getAttr(attrs, 'placeholder') ?? '',
          required: hasAttr(attrs, 'required'),
        });
      }

      // ── Marketing Text Extraction (only on landing / info pages) ─────────
      if (isMarketingRoute) {
        if (['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'article'].includes(name.toLowerCase())) {
          const text = jsxChildText(children);
          if (text.length > 15) marketingChunks.push(text);
        }
      }
    }

    // ── BinaryExpression: role === 'admin', status === 'active' ────────────
    if (node.type === 'BinaryExpression') {
      const op = node.operator as string;
      if (op !== '===' && op !== '==') return;
      const left = unwrap(node.left as AnyNode);
      const right = unwrap(node.right as AnyNode);
      const leftStr = stringValue(left);
      const rightStr = stringValue(right);

      if (isRoleAccess(left) && rightStr) result.roles.push(rightStr);
      if (isRoleAccess(right) && leftStr) result.roles.push(leftStr);

      // status === 'pending'
      if (left.type === 'Identifier' && (left.name as string) === 'status' && rightStr) {
        result.statusConditions.push(rightStr);
      }
    }

    // ── CallExpression: toast.success(), hasRole(), fetch(), axios.get() ───
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee as AnyNode);
      const args = (node.arguments as AnyNode[]) ?? [];
      const firstArg = args[0];
      const firstArgStr = stringValue(firstArg);

      // hasRole('admin') / checkRole('admin') / fetch() / setError()
      if (callee.type === 'Identifier') {
        const fnName = callee.name as string;
        if ((fnName === 'hasRole' || fnName === 'checkRole') && firstArgStr) {
          result.roles.push(firstArgStr);
        }
        if (fnName === 'fetch' && firstArgStr?.startsWith('/api')) {
          result.apiCalls.push(firstArgStr);
        }
        if (fnName === 'setError' && firstArgStr) {
          result.validationMessages.push(firstArgStr);
        }
      }

      // toast.success('msg'), axios.get('/api/...'), api.post('/api/...')
      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const obj = callee.object as AnyNode;
        const prop = callee.property as AnyNode;
        const propName = prop.name as string;

        if (obj.type === 'Identifier' && (obj.name as string) === 'toast') {
          if (['success', 'error', 'info', 'warning', 'promise'].includes(propName) && firstArgStr) {
            result.toastMessages.push({ type: propName, message: firstArgStr });
          }
        }

        // HTTP client methods on ANY identifier: axios.get, api.post, http.put, etc.
        if (['get', 'post', 'put', 'patch', 'delete'].includes(propName) && firstArgStr?.startsWith('/api')) {
          result.apiCalls.push(firstArgStr);
        }

        // ['admin','officer'].includes(role) — array literal containing roles
        if (propName === 'includes' && obj.type === 'ArrayExpression') {
          if (args.some(a => isRoleAccess(a))) {
            for (const el of (obj.elements as AnyNode[]) ?? []) {
              const v = stringValue(el);
              if (v) result.roles.push(v);
            }
          }
        }
      }
    }
  });

  // Fallback: if the AST walk produced no navLinks (e.g. Babel's JSX parser
  // choked on a regex literal containing <> in a .tsx file), scan the raw
  // source text for href="..." / href='...' literals as a safety net.
  if (result.navLinks.length === 0) {
    const hrefRe = /href=["'](\/?[^"'#?]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(content)) !== null) {
      const href = m[1];
      if (href.startsWith('/')) {
        result.navLinks.push({ href, label: href });
      }
    }
  }

  // Deduplicate
  if (marketingChunks.length > 0) {
    result.marketingText = marketingChunks.join('\n\n');
  }

  result.roles = [...new Set(result.roles)];
  result.apiCalls = [...new Set(result.apiCalls)];
  const seenHrefs = new Set<string>();
  result.navLinks = result.navLinks.filter(n => {
    if (seenHrefs.has(n.href)) return false;
    seenHrefs.add(n.href);
    return true;
  });

  return result;
}
