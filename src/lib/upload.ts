import type { ParsedFile } from '../types/index.js';
import type { RawFileContent, ExtractedPage } from '../parsers/nextjs.js';

interface UploadPayload {
  parsedFiles: ParsedFile[];
  rawFileContents: RawFileContent[];
  extractedPages: ExtractedPage[];
  docs: string;
  framework: string;
  appName: string;
}

const UPLOAD_TIMEOUT_MS = 120_000; // 2 minutes

function startSpinner(message: string): ReturnType<typeof setInterval> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write(`  ${frames[i]} ${message}`);
  return setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r  ${frames[i]} ${message}`);
  }, 80);
}

export async function uploadParsedFiles(
  payload: UploadPayload,
  apiKey: string,
  apiUrl: string = 'https://www.plotui.com/api/scan'
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  const spinner = startSpinner('AI is processing your codebase…');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ apiKey, ...payload }),
      signal: controller.signal,
    });

    clearInterval(spinner);
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      process.stdout.write('\r');
      throw new Error(`Upload failed: ${error}`);
    }

    const result = await response.json();
    process.stdout.write('\r');
    console.log('  \x1b[32m✓\x1b[0m Knowledge graph generated and saved!');
    console.log(`  Graph ID: ${result.graphId}`);
    console.log(`  Pages:    ${result.nodeCount} nodes mapped`);
    console.log(`  View at:  https://www.plotui.com/dashboard/graph`);
  } catch (err) {
    clearInterval(spinner);
    clearTimeout(timeout);
    process.stdout.write('\r');
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s. ` +
        'The server may be busy — try again in a moment.'
      );
    }
    throw err;
  }
}
