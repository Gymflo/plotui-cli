/**
 * Smoke tests for babelExtract.
 *
 * Runs at build-time against a set of fixtures to verify that common
 * patterns are still caught after any refactor. Run via: npm run test
 *
 * Exit code is non-zero if any assertion fails.
 */

import { extractSignals, extractRouteDeclarations } from '../babelExtract.js';

interface Case {
  name: string;
  code: string;
  assert: (r: ReturnType<typeof extractSignals>) => string | null;
}

const cases: Case[] = [
  {
    name: 'Link with href produces a navLink',
    code: `export default function Page() {
      return <Link href="/dashboard">Go to Dashboard</Link>;
    }`,
    assert: r => r.navLinks.length === 1 && r.navLinks[0].href === '/dashboard' ? null : 'expected 1 navLink to /dashboard',
  },
  {
    name: 'Button with text is captured',
    code: `export default function P() { return <Button>Submit Application</Button>; }`,
    assert: r => r.buttons.includes('Submit Application') ? null : 'expected button "Submit Application"',
  },
  {
    name: 'role === literal is extracted',
    code: `function P(){ if (role === 'admin') return null; return null; }`,
    assert: r => r.roles.includes('admin') ? null : 'expected role admin',
  },
  {
    name: 'user?.role === literal (optional chaining)',
    code: `function P({user}){ if (user?.role === 'placement_officer') return null; return null; }`,
    assert: r => r.roles.includes('placement_officer') ? null : 'expected placement_officer via optional chaining',
  },
  {
    name: 'TS cast: (user.role as string) === "admin"',
    code: `function P({user}){ if ((user.role as string) === 'admin') return null; return null; }`,
    assert: r => r.roles.includes('admin') ? null : 'expected admin via TS cast',
  },
  {
    name: "['admin','officer'].includes(role)",
    code: `function P(){ if (['admin','officer'].includes(role)) return null; return null; }`,
    assert: r => r.roles.includes('admin') && r.roles.includes('officer') ? null : 'expected admin+officer via includes',
  },
  {
    name: 'hasRole("student") is extracted',
    code: `function P(){ if (hasRole("student")) return null; return null; }`,
    assert: r => r.roles.includes('student') ? null : 'expected student via hasRole',
  },
  {
    name: 'Template literal URL in fetch',
    code: `function P(){ fetch(\`/api/students/\${id}\`); return null; }`,
    assert: r => r.apiCalls.some(u => u.startsWith('/api/students')) ? null : 'expected /api/students apiCall',
  },
  {
    name: 'axios.get with /api path',
    code: `function P(){ axios.get('/api/officers'); return null; }`,
    assert: r => r.apiCalls.includes('/api/officers') ? null : 'expected /api/officers apiCall',
  },
  {
    name: 'Multiline Button with nested Icon is still captured',
    code: `function P(){ return <Button>
      <Icon name="save"/>
      Save Changes
    </Button>; }`,
    assert: r => r.buttons.some(b => b.includes('Save Changes')) ? null : 'expected multiline button text',
  },
  {
    name: 'h1 heading is captured',
    code: `function P(){ return <h1>Welcome to PlotUI</h1>; }`,
    assert: r => r.headings.includes('Welcome to PlotUI') ? null : 'expected h1 heading',
  },
  {
    name: 'toast.success is captured',
    code: `function P(){ toast.success('Saved!'); return null; }`,
    assert: r => r.toastMessages.some(t => t.message === 'Saved!') ? null : 'expected toast success',
  },
];

const routerCase = {
  name: 'React Router: <Route path="..."> declarations',
  code: `import Home from './pages/Home';
         import Dashboard from './pages/Dashboard';
         export default function App() {
           return <Routes>
             <Route path="/" element={<Home/>} />
             <Route path="/dashboard" element={<Dashboard/>} />
           </Routes>;
         }`,
};

function run() {
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const res = extractSignals(c.code, '/test', 'test.tsx');
    const err = c.assert(res);
    if (err) {
      failed++;
      console.error(`  FAIL: ${c.name} — ${err}`);
    } else {
      passed++;
      console.log(`  PASS: ${c.name}`);
    }
  }

  // Route declaration test
  const routes = extractRouteDeclarations(routerCase.code);
  if (routes.length === 2 && routes[0].path === '/' && routes[1].path === '/dashboard') {
    passed++;
    console.log(`  PASS: ${routerCase.name}`);
  } else {
    failed++;
    console.error(`  FAIL: ${routerCase.name} — got ${JSON.stringify(routes)}`);
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run();
