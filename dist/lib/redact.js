import * as fs from 'fs';
import * as path from 'path';
// File patterns that should NEVER be read or sent
const BLOCKED_FILE_PATTERNS = [
    /^\.env$/,
    /^\.env\..*/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /secrets?\.json$/i,
    /credentials?\.json$/i,
    /serviceAccount.*\.json$/i,
];
// Line-level patterns — lines matching these are redacted
const SENSITIVE_LINE_PATTERNS = [
    /\b(API_KEY|SECRET|PRIVATE_KEY|DATABASE_URL|DB_URL|CONNECTION_STRING|PASSWD|PASSWORD|ACCESS_KEY|SECRET_KEY|SIGNING_SECRET|WEBHOOK_SECRET|ENCRYPTION_KEY)\s*[=:]/i,
    /\b(NEXTAUTH_SECRET|CLERK_SECRET_KEY|STRIPE_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|RESEND_API_KEY)\s*[=:]/i,
    /\b(AWS_ACCESS_KEY|AWS_SECRET|GCP_KEY|AZURE_CLIENT_SECRET)\s*[=:]/i,
    // Inline secret values — common key prefixes
    /['"`](sk_live_|sk_test_|pk_live_|pk_test_|whsec_|AKIA|sk-ant-|AIzaSy)[A-Za-z0-9_\-]{10,}/,
    // Long base64 / hex that looks like a secret (>40 chars of encoded data)
    /['"`][A-Za-z0-9+/]{40,}={0,2}['"`]/,
    // postgres / mysql / mongo connection strings
    /(postgres|mysql|mongodb|redis):\/\/[^'"`\s]+/i,
];
/**
 * Returns true if the given filename should never be read.
 */
export function isBlockedFile(filename) {
    const base = path.basename(filename);
    return BLOCKED_FILE_PATTERNS.some((p) => p.test(base));
}
/**
 * Redacts sensitive lines from file content.
 * Replaces the value portion of a sensitive line with [REDACTED].
 */
export function redactContent(content, filePath) {
    const lines = content.split('\n');
    return lines
        .map((line) => {
        if (SENSITIVE_LINE_PATTERNS.some((p) => p.test(line))) {
            // Preserve the key name if possible, redact the value
            const eqPos = line.indexOf('=');
            if (eqPos > -1) {
                return `${line.slice(0, eqPos + 1)} [REDACTED]`;
            }
            return '[REDACTED LINE]';
        }
        return line;
    })
        .join('\n');
}
/**
 * Reads a file and returns redacted content, or null if the file should be skipped.
 */
export function safeReadFile(filePath) {
    if (isBlockedFile(filePath))
        return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return redactContent(content, filePath);
}
/**
 * Generate a human-readable list of what was excluded for the consent prompt.
 */
export function listExclusions(rootDir) {
    const excluded = [];
    const check = ['.env', '.env.local', '.env.production', '.env.development'];
    for (const f of check) {
        if (fs.existsSync(path.join(rootDir, f)))
            excluded.push(f);
    }
    return excluded;
}
