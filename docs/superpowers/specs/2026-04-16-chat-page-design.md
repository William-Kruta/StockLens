# Chat Page — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Overview

Add a "Chat" nav tab that opens a full-screen multi-conversation LLM chat interface. Left panel lists past conversations (ChatGPT-style). Right panel is the active conversation with a provider dropdown in the toolbar. The existing "Ask LLM" sidebar remains untouched — it serves quick contextual queries; the Chat page serves deeper standalone sessions.

All code lives in `ui/`. The `secrs` package is never touched.

---

## What's Added

| File | Change |
|------|--------|
| `ui/server.py` | Add `POST /api/chat/claude` and `POST /api/chat/openai` SSE proxy endpoints; add `/chat` to `PAGE_ROUTES` |
| `ui/static/index.html` | Add "Chat" nav link; add `#chat-page` section |
| `ui/static/app.js` | Add chat state, localStorage persistence, `runChat()`, conversation CRUD, provider switching, LLM-generated titles, streaming for all three providers |
| `ui/static/styles.css` | Chat page layout, conversation list, toolbar, message styles |

---

## Layout

Layout B: shared topbar with all nav links visible. Chat page body splits into:

```
┌──────────────────────────────────────────────────────┐
│ secrs  Dashboard  Markets  Chat  Multi  …  ✦ Ask LLM │  ← topbar (unchanged)
├────────────────┬─────────────────────────────────────┤
│  Conversations │  AAPL earnings analysis    Claude ▾  │  ← toolbar
│  ─────────────  │─────────────────────────────────────│
│  ● AAPL earn…  │  You                                  │
│    Claude·2h   │  Walk me through AAPL's earnings.     │
│                │                                       │
│  DCF walkth…   │  Claude                               │
│    GPT-4o·1d   │  Apple's Q1 FY2025 revenue was…      │
│                │                                       │
│  [+ New]       │─────────────────────────────────────  │
│  [⚙]          │  [input…                         ↑ ]  │
└────────────────┴─────────────────────────────────────┘
```

- Left panel width: fixed ~220px, not resizable (YAGNI)
- Conversation list sorted by `updatedAt` descending
- Active conversation highlighted with accent left-border
- Hover on conversation item reveals ×  delete button
- Gear icon (⚙) in panel footer opens inline settings panel

---

## Data Model (localStorage)

Key: `"secrs.chat.conversations"` → JSON array of conversation objects.

```js
// Single conversation
{
  id: "uuid-v4",
  title: "AAPL earnings analysis",      // LLM-generated after first response
  provider: "claude",                    // current provider for next send
  model: "claude-sonnet-4-6",           // current model for next send
  createdAt: 1713200000,
  updatedAt: 1713203600,
  messages: [
    { role: "user",      content: "…", timestamp: 1713200100 },
    { role: "assistant", content: "…", provider: "claude",
      model: "claude-sonnet-4-6",       timestamp: 1713200105 }
  ]
}
```

Provider and model are recorded per assistant message so the history accurately reflects which model answered each turn. The conversation-level `provider`/`model` tracks the selection for the *next* send.

No maximum conversation count enforced (localStorage is ~5MB; text conversations are small).

---

## Provider Architecture

Three providers, two connection patterns:

### Llama.cpp
- Browser connects directly (existing pattern)
- URL from existing `secrs.llm_server_url` localStorage key (shared with Ask LLM sidebar)
- Endpoint: `POST <url>/v1/chat/completions` with `stream: true`

### Claude (Anthropic)
- Browser POSTs to `POST /api/chat/claude` in `ui/server.py`
- Server reads `SECRS_CLAUDE_API_KEY` from environment
- Server proxies SSE stream back to browser in the same `data: {"choices":[{"delta":{"content":"…"}}]}` format
- Available models: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`

### OpenAI
- Browser POSTs to `POST /api/chat/openai` in `ui/server.py`
- Server reads `SECRS_OPENAI_API_KEY` from environment
- Same SSE proxy pattern as Claude
- Available models: `gpt-4o`, `gpt-4o-mini`

### Request format (browser → server)
```json
{ "messages": [{"role": "user", "content": "…"}, …], "model": "claude-sonnet-4-6" }
```

### Unavailable providers
If the server-side key is not set, `GET /api/chat/providers` returns which providers are available. Unavailable providers appear greyed out in the dropdown with tooltip "API key not configured on server".

---

## Server Endpoints

### `GET /api/chat/providers`
Returns availability of server-proxied providers based on configured env vars:
```json
{ "claude": true, "openai": false }
```
Llama.cpp availability is determined client-side: available if `secrs.llm_server_url` is set in localStorage.

### `POST /api/chat/claude` (SSE)
- Reads `SECRS_CLAUDE_API_KEY` from env
- Forwards `messages` + `model` to `https://api.anthropic.com/v1/messages` with streaming
- Proxies SSE back in OpenAI-compatible delta format
- Returns `{"error": "…"}` JSON (non-SSE) if key missing or upstream error

### `POST /api/chat/openai` (SSE)
- Reads `SECRS_OPENAI_API_KEY` from env
- Forwards to `https://api.openai.com/v1/chat/completions` with `stream: true`
- Proxies SSE back as-is (OpenAI format matches what the browser already parses)
- Returns `{"error": "…"}` JSON (non-SSE) if key missing or upstream error

---

## UI Behavior

### Conversation list
- Sorted by `updatedAt` descending (most recent first)
- Each item: title (truncated with ellipsis) + `provider · time-ago` meta line
- Hover → × delete button (right side); click × → removes from localStorage and list
- Click conversation → loads it into chat area
- "+ New" button in panel header → creates blank conversation, focuses input
- Empty state (no conversations): chat area shows centered "Start a new conversation" + "+ New" button

### Provider toolbar
- Conversation title displayed left
- Provider dropdown right: shows current provider + model name, click opens picker
- Picker lists all three providers; Claude and OpenAI include a model sub-select; Llama.cpp shows no model picker (model is whatever is loaded on the server)
- Unavailable providers greyed out with "API key not configured" tooltip (or "Server URL not set" for Llama.cpp)
- Switching provider takes effect on next send; prior messages keep their recorded `provider` label

### Sending a message
1. User types, hits Enter or ↑ button
2. Message appended to UI and `conversation.messages` immediately
3. Stream opened to the appropriate endpoint
4. Assistant bubble appended with streaming cursor
5. On stream end: assistant message with `provider`/`model` saved to localStorage
6. If this was the first assistant response: fire background title request (see below)

### LLM-generated title
After the first assistant response completes:
- Fire a non-streaming request to the same provider/model with system prompt: `"You generate conversation titles. Reply with only the title, 5 words or fewer."`
- User message: the first user message content
- On success: update `conversation.title` in localStorage and re-render sidebar item
- On failure: silently fall back to first user message truncated to 50 chars

### Settings panel
Gear icon (⚙) in panel footer toggles an inline settings panel below the footer (pushes list up):
- **Llama.cpp server URL** — shared input, same key as Ask LLM sidebar (`secrs.llm_server_url`)
- **Claude model** — select: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`; persisted to `secrs.chat.claude_model`
- **OpenAI model** — select: `gpt-4o`, `gpt-4o-mini`; persisted to `secrs.chat.openai_model`
- Note: "Claude and OpenAI API keys are set via server environment variables."

---

## State

New fields added to `state` object in `app.js`:

```js
chatConversations: [],       // loaded from localStorage on init
chatActiveId: null,          // currently open conversation id
chatStreaming: false,        // true while a stream is in progress
chatProviders: {},           // { llama: bool, claude: bool, openai: bool }
chatSettingsOpen: false,     // whether settings panel is visible
```

---

## Error Handling

- Stream error (network / upstream): show error bubble in chat, `chatStreaming = false`
- Provider key missing: greyed-out in picker; if somehow triggered, show error bubble
- localStorage full: caught on save, show transient status bar warning
- Title generation failure: silent fallback, no visible error

---

## Out of Scope

- Conversation search / filtering
- Conversation rename
- Markdown rendering in bubbles (plain text only, same as existing sidebar)
- File/image attachments
- Conversation export
- Streaming cancellation mid-message
