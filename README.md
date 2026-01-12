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

Copy `.env.example` to `.env` to customize models, host, or port.

- `HOST` (default: 0.0.0.0)
- `PORT` (default: 3000)
- `PLANNER_MODEL` (default: llama3.1)
- `CODER_MODEL` (default: llama3.1)
- `RUNTIME_MODEL` (default: same as `CODER_MODEL`)
- `MODEL_OPTIONS` (comma-separated list of models to show in the UI dropdowns)
- `LLM_TIMEOUT_MS` (default: 120000) – max time (ms) to wait for any Ollama call

If you see a model error, run:

```
ollama pull <model>
```

## API Endpoints

- `GET /api/health`
- `GET /api/config` -> model defaults/options
- `POST /api/runtime/llm` -> `{ prompt }` => `{ response }`
- `POST /api/plan` -> `{ prompt }` => `{ plan, raw }`
- `POST /api/generate` -> `{ prompt, plan }` => `{ html }`
- `POST /api/pipeline` -> `{ prompt }` => `{ plan, html, timestamp }`
- `POST /api/iterate` -> `{ base_prompt, plan, html, changes_prompt }` => `{ plan, html, timestamp }`
- `GET /api/runs` -> list saved runs
- `GET /api/run/:timestamp` -> run details
- `GET /api/run/:timestamp/page.html`

## Safety

Generated HTML is sandboxed in an iframe with `sandbox="allow-scripts allow-forms"` and `srcdoc`.
The backend rejects HTML that contains:
- `<iframe>`, `<object>`, `<embed>`
- `fetch()`, `XMLHttpRequest`, `WebSocket`
- `<meta http-equiv="refresh">`
- `window.location=` or `document.location=`

A strict CSP is enforced via meta tag:

```
Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none';
```

If a generated page violates these rules the server automatically reiterates instructions to the coder, and the `/api/pipeline` flow will even re-plan once with additional guidance before failing.

If a planner model responds with malformed JSON the server now automatically retries with stricter instructions before surfacing an error, which helps when experimenting with creative local models.

## Notes

Each pipeline run is saved under `runs/<timestamp>/`:
- `prompt.txt`
- `plan.json`
- `page.html`
- `meta.json`

### Model selection & calling the AI from generated pages

The dashboard now exposes dropdowns to pick planner/coder/runtime models (populated from `MODEL_OPTIONS`). Those selections are passed to each `/api/plan`, `/api/generate`, and `/api/pipeline` request so you can quickly try stronger local models without touching the `.env` file.

The backend injects a helper so any generated HTML can talk to the locally running model without needing to expose the fetch API inside the LLM output. In your generated code you can call:

```
const reply = await window.geaRuntimeLLM("Summarize the current state", { model: "llama3.1:70b" });
```

This helper uses `/api/runtime/llm` under the hood and routes requests through `RUNTIME_MODEL` by default (you can override it per call via the `model` option). Direct `fetch`/`XMLHttpRequest` calls from generated code are still blocked by the sandbox, so always go through `window.geaRuntimeLLM`—the backend responds with the `Access-Control-Allow-*` headers that a `null`-origin iframe needs.
