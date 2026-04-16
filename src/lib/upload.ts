import type { ParsedFile } from '../types/index.js';
import type { RawFileContent } from '../parsers/nextjs.js';

interface UploadPayload {
  parsedFiles: ParsedFile[];
  rawFileContents: RawFileContent[];
  docs: string;
  framework: string;
  appName: string;
}

export async function uploadParsedFiles(
  payload: UploadPayload,
  apiKey: string,
  apiUrl: string = 'https://plotui.com/api/scan'
): Promise<void> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ apiKey, ...payload }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }

  const result = await response.json();
  console.log('✓ Knowledge graph generated and saved!');
  console.log(`  Graph ID: ${result.graphId}`);
  console.log(`  Pages:    ${result.nodeCount} nodes mapped`);
  console.log(`  View at:  https://plotui.com/dashboard/graph`);
}
