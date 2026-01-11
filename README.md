# Local LLM Web Pipeline Prototype

This project is a minimal, free, local prototype that demonstrates a pipeline:

Prompt -> Planner LLM -> Plan -> HTML/CSS/JS -> sandboxed preview

## Requirements

- Windows 10/11
- Node.js LTS (18+)
- Ollama (local LLM)

## Setup

1) Install Node.js LTS from https://nodejs.org
2) Install Ollama from https://ollama.com
3) Pull a model:

```
ollama pull llama3.1
```

4) Install dependencies:

```
npm install
```

5) Start the server:

```
npm start
```

6) Open the app:

```
http://localhost:3000
```

## Configuration

Copy `.env.example` to `.env` to customize models or port.

- `PLANNER_MODEL` (default: llama3.1)
- `CODER_MODEL` (default: llama3.1)
- `PORT` (default: 3000)

If you see a model error, run:

```
ollama pull <model>
```

## API Endpoints

- `GET /api/health`
- `POST /api/plan` -> `{ prompt }` => `{ plan, raw }`
- `POST /api/generate` -> `{ prompt, plan }` => `{ html }`
- `POST /api/pipeline` -> `{ prompt }` => `{ plan, html, timestamp }`
- `GET /api/run/:timestamp/page.html`

## Safety

Generated HTML is sandboxed in an iframe with `sandbox="allow-scripts"` and `srcdoc`.
The backend rejects HTML that contains:
- `<iframe>`, `<object>`, `<embed>`
- `fetch()`, `XMLHttpRequest`, `WebSocket`
- `<meta http-equiv="refresh">`
- `window.location=` or `document.location=`

A strict CSP is enforced via meta tag:

```
Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
```

## Notes

Each pipeline run is saved under `runs/<timestamp>/`:
- `prompt.txt`
- `plan.json`
- `page.html`
- `meta.json`
