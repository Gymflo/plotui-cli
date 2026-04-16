# PlotUI CLI

Scan your codebase and generate a knowledge graph for PlotUI.

## Installation

```bash
npm install -g plotui-cli
```

## Usage

```bash
# Scan current directory
plotui-scan

# Scan specific directory
plotui-scan --dir /path/to/project

# Save to file without uploading
plotui-scan --output knowledge-graph.json --no-upload

# Upload with API key
plotui-scan --api-key YOUR_API_KEY

# Or use environment variable
export PLOTUI_API_KEY=YOUR_API_KEY
plotui-scan
```

## Options

- `-d, --dir <directory>` - Project directory (default: current directory)
- `-o, --output <file>` - Output file for knowledge graph JSON
- `--no-upload` - Skip uploading to PlotUI
- `--api-key <key>` - PlotUI API key
- `--api-url <url>` - PlotUI API URL (default: https://plotui.com/api/scan)

## Supported Frameworks

- Next.js (App Router)
- Next.js (Pages Router)
- React + Vite
- Create React App

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js

# Watch mode
npm run dev
```
