import { parseNextJSApp } from './nextjs.js';
import { parseReactVite } from './reactVite.js';
export function parseCodebase(rootDir, framework) {
    switch (framework) {
        case 'nextjs-app':
        case 'nextjs-pages':
            return parseNextJSApp(rootDir);
        case 'react-vite':
        case 'cra': {
            const parsedFiles = parseReactVite(rootDir);
            return { parsedFiles, rawFileContents: [], extractedPages: [] };
        }
        default:
            throw new Error(`Unsupported framework: ${framework}`);
    }
}
