import * as fs from 'fs';
import * as path from 'path';
import type { ParsedFile } from '../types/index.js';

export function parseReactVite(rootDir: string): ParsedFile[] {
  const srcDir = path.join(rootDir, 'src');
  const parsedFiles: ParsedFile[] = [];

  if (!fs.existsSync(srcDir)) {
    return parsedFiles;
  }

  // Look for router configuration
  const routerFiles = [
    path.join(srcDir, 'App.tsx'),
    path.join(srcDir, 'App.jsx'),
    path.join(srcDir, 'main.tsx'),
    path.join(srcDir, 'main.jsx'),
  ];

  for (const routerFile of routerFiles) {
    if (fs.existsSync(routerFile)) {
      const content = fs.readFileSync(routerFile, 'utf-8');
      const routes = extractRoutes(content);
      
      for (const route of routes) {
        parsedFiles.push({
          path: routerFile,
          route: route.path,
          component: route.component,
          elements: extractUIElements(content),
          imports: extractImports(content),
          conditions: [],
          roles: [],
        });
      }
    }
  }

  return parsedFiles;
}

function extractRoutes(content: string) {
  const routes: any[] = [];
  
  // Look for react-router-dom Route declarations
  const routeMatches = content.matchAll(/<Route\s+path=['"]([^'"]+)['"][^>]*element={[^}]*}[^>]*\/>/g);
  for (const match of routeMatches) {
    routes.push({
      path: match[1],
      component: 'Route Component',
    });
  }

  return routes;
}

function extractUIElements(content: string) {
  const elements: any[] = [];
  
  // Extract buttons
  const buttonMatches = content.matchAll(/<button[^>]*>(.*?)<\/button>/gi);
  for (const match of buttonMatches) {
    elements.push({
      type: 'button',
      label: match[1].trim(),
      action: 'Click action',
    });
  }

  return elements;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importMatches = content.matchAll(/import.*from\s+['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    imports.push(match[1]);
  }
  return imports;
}
