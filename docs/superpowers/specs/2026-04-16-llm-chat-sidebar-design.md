# LLM Chat Sidebar — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Overview

Add an "Ask LLM" button to the topbar that opens a persistent chat sidebar. The sidebar is context-aware — it automatically includes a description of whatever is currently on screen as a system prompt. Default provider is Llama.cpp via its OpenAI-compatible API. All logic lives in the frontend; no server changes required.

---

## Layout

- **Button placement:** `✦ Ask LLM` button added to the right end of the topbar, after the nav links.
- **Sidebar behavior:** Fixed overlay panel sliding in from the right edge. Does **not** push main content — floats above it. Width ~320px.
- **Slide animation:** CSS `transform: translateX(100%)` → `translateX(0)` on open, reversed on close.
- **Z-index:** Above main content, below any future modals.

---

## Sidebar Structure

Three sub-views within the same panel, toggled by icon buttons in the header:

### Chat view (default)
```
┌─────────────────────────────┐
│ ✦ Ask LLM        [⚙]  [✕] │  ← header
├─────────────────────────────┤
│ ● Context: AAPL · Chart · 1Y│  ← context bar (auto-updated)
├─────────────────────────────┤
│                             │
│  [LLM bubble]               │  ← message history (scrollable)
│             [User bubble]   │
│  [LLM bubble, streaming▌]   │
│                             │
├─────────────────────────────┤
│ [textarea____________] [↑]  │  ← input area
└─────────────────────────────┘
```

### Settings view (⚙ icon)
```
┌─────────────────────────────┐
│ ✦ Settings          [← Back]│
├─────────────────────────────┤
│ Provider                    │
│ [Llama.cpp ──────────────]  │
│                             │
│ Server URL                  │
│ [http://localhost:8080 ───] │
│ /v1/chat/completions appended│
│                             │
│ Connection                  │
│ ● Connected · llama-3.1-8b  │
│                             │
│ [Save & Test Connection]    │
└─────────────────────────────┘
```

---

## Files Changed

| File | Change |
|------|--------|
| `ui/static/index.html` | Add `✦ Ask LLM` button to topbar; add `#llm-sidebar` div with full panel HTML |
| `ui/static/styles.css` | Sidebar fixed positioning, slide animation, message bubbles, context bar, settings form |
| `ui/static/app.js` | Toggle open/close, context assembly, streaming fetch, history, settings persistence |

No changes to `ui/server.py`.

---

## Context Assembly

On each user message send, a fresh system prompt is built from the current page state. Chat history persists across navigation; the system message is always rebuilt (never stored in history).

### Context per page

| Page | Context included |
|------|-----------------|
| Ticker → Chart | ticker, active period/interval, active indicators |
| Ticker → Financials | ticker, statement type, period, first ~20 rows of visible table as compact JSON |
| Ticker → Info | ticker, sector, industry, market cap, description excerpt |
| Single page | ticker, statement type, period, result table data |
| Multi page | tickers, analysis type (ratios/margins), result table data |
| Other pages | page name only |

### System prompt template
```
You are a financial analysis assistant embedded in secrs, a SEC EDGAR filings tool.
The user is currently viewing: {page description}.
{serialized context data}
Answer concisely. If asked about data not shown, say so.
```

---

## Streaming

- `fetch()` with `ReadableStream` reader against `{serverUrl}/v1/chat/completions`
- Request body: `{ model: "local", messages: [systemMsg, ...history], stream: true }`
- Parse `data: {...}` SSE lines, extract `choices[0].delta.content`, append tokens to current bubble
- Blinking cursor element during streaming, removed on stream end
- On error (non-200, network failure): inline error bubble `⚠ Could not reach LLM server. Check settings.`

---

## History Management

- `state.llmHistory`: array of `{ role: "user" | "assistant", content: string }`
- Persists across page navigation and ticker changes
- Max 20 messages kept (oldest dropped) to avoid token overflow
- System message freshly built per send — not stored in history

---

## Settings Persistence

- Server URL stored in `localStorage` under key `llm_server_url`
- Default: `http://localhost:8080`
- "Save & Test Connection": PINGs `{url}/v1/models`
  - Success: green `● Connected · {model name}` (from first model in response)
  - Failure: red `✕ Unreachable — check server URL`
- Provider field is display-only ("Llama.cpp") — extensible later

---

## Future Considerations (out of scope for this implementation)

- **Web search tool:** LLM-initiated web search for real-time context (e.g. news, macro data). Noted as a planned capability; not implemented here.
- **Additional providers:** OpenAI, Anthropic, Ollama — provider picker in settings.
- **Context pinning:** "Send to LLM" buttons on individual table rows or chart annotations.
- **Conversation export:** Copy/save chat transcript.
