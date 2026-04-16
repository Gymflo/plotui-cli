import * as fs from 'fs';
import * as path from 'path';
export function detectFramework(rootDir) {
    const pkgPath = path.join(rootDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        throw new Error('package.json not found. Please run this command in a project directory.');
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasNext = !!deps['next'];
    const hasVite = !!deps['vite'];
    const hasCRA = !!deps['react-scripts'];
    const hasAppDir = fs.existsSync(path.join(rootDir, 'app')) || fs.existsSync(path.join(rootDir, 'src', 'app'));
    const hasPagesDir = fs.existsSync(path.join(rootDir, 'pages')) || fs.existsSync(path.join(rootDir, 'src', 'pages'));
    if (hasNext && hasAppDir)
        return 'nextjs-app';
    if (hasNext && hasPagesDir)
        return 'nextjs-pages';
    if (hasVite)
        return 'react-vite';
    if (hasCRA)
        return 'cra';
    throw new Error('Framework not supported. Supported frameworks: Next.js (App Router), Next.js (Pages Router), React + Vite, Create React App');
}
export function getAppName(rootDir) {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.name || 'Unknown App';
}
