import type { Framework, ParsedFile } from '../types/index.js';
import { parseNextJSApp, type RawFileContent, type ExtractedPage } from './nextjs.js';
import { parseReactFamily } from './reactVite.js';

export interface ParseResult {
  parsedFiles: ParsedFile[];
  rawFileContents: RawFileContent[];
  extractedPages: ExtractedPage[];
}

export function parseCodebase(rootDir: string, framework: Framework): ParseResult {
  switch (framework) {
    case 'nextjs-app':
    case 'nextjs-pages':
      return parseNextJSApp(rootDir);
    case 'react-vite':
    case 'cra':
    case 'gatsby':
    case 'remix':
      return parseReactFamily(rootDir, framework);
    default:
      throw new Error(`Unsupported framework: ${framework}`);
  }
}
