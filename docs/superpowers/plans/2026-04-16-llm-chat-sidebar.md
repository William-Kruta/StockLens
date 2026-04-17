# LLM Chat Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context-aware "✦ Ask LLM" button to the topbar that opens a streaming chat sidebar powered by a local Llama.cpp server.

**Architecture:** Pure frontend implementation — no server changes. The sidebar is a fixed overlay `<div>` toggled by a topbar button. On each send, a fresh system prompt is built from the current page state (active ticker, tab, visible data) and prepended to the persisted chat history before calling `{serverUrl}/v1/chat/completions` with SSE streaming.

**Tech Stack:** Vanilla JS (ES2020), CSS custom properties, Fetch API with ReadableStream, localStorage for settings persistence.

---

## File Map

| File | Change |
|------|--------|
| `ui/static/index.html` | Add `#llm-btn` to topbar; add `#llm-sidebar` panel + `#llm-backdrop` |
| `ui/static/styles.css` | Sidebar fixed overlay, slide animation, message bubbles, settings form |
| `ui/static/app.js` | All sidebar logic: toggle, settings, context, streaming, history |

---

## Task 1: HTML — Button and Sidebar Structure

**Files:**
- Modify: `ui/static/index.html`

- [ ] **Step 1: Add "Ask LLM" button to the topbar**

In `index.html`, after the closing `</nav>` tag (line 38) and before `</header>`, add:

```html
      <button class="llm-btn" id="llm-btn" type="button">✦ Ask LLM</button>
```

- [ ] **Step 2: Add the sidebar and backdrop divs**

Before the closing `</body>` tag (after the `<script>` tag), add:

```html
    <div class="llm-sidebar" id="llm-sidebar" aria-label="LLM Chat" role="complementary">

      <!-- Chat view (default) -->
      <div class="llm-view llm-chat-view active" id="llm-chat-view">
        <div class="llm-header">
          <span class="llm-header-icon">✦</span>
          <span class="llm-header-title">Ask LLM</span>
          <button class="llm-icon-btn" id="llm-settings-btn" type="button" title="Settings">⚙</button>
          <button class="llm-icon-btn" id="llm-close-btn" type="button" title="Close">✕</button>
        </div>
        <div class="llm-ctx-bar" id="llm-ctx-bar">
          <span class="llm-ctx-dot" id="llm-ctx-dot"></span>
          <span id="llm-ctx-text">No context</span>
        </div>
        <div class="llm-messages" id="llm-messages"></div>
        <div class="llm-input-area">
          <textarea
            class="llm-textarea"
            id="llm-textarea"
            placeholder="Ask about this ticker… (Enter to send)"
            rows="1"
          ></textarea>
          <button class="llm-send" id="llm-send" type="button" title="Send">↑</button>
        </div>
      </div>

      <!-- Settings view -->
      <div class="llm-view llm-settings-view" id="llm-settings-view">
        <div class="llm-header">
          <span class="llm-header-icon">✦</span>
          <span class="llm-header-title">Settings</span>
          <button class="llm-icon-btn" id="llm-back-btn" type="button">← Back</button>
        </div>
        <div class="llm-settings-body">
          <div class="llm-setting-group">
            <span class="llm-setting-label">Provider</span>
            <div class="llm-setting-static">Llama.cpp</div>
          </div>
          <div class="llm-setting-group">
            <label class="llm-setting-label" for="llm-server-url">Server URL</label>
            <input
              class="llm-setting-input"
              id="llm-server-url"
              type="text"
              placeholder="http://localhost:8080"
              spellcheck="false"
              autocomplete="off"
            />
            <span class="llm-setting-hint">/v1/chat/completions will be appended automatically</span>
          </div>
          <div class="llm-setting-group">
            <span class="llm-setting-label">Connection</span>
            <span class="llm-conn-status" id="llm-conn-status">—</span>
          </div>
          <button class="llm-save-btn" id="llm-save-btn" type="button">Save &amp; Test Connection</button>
        </div>
      </div>

    </div>
    <div class="llm-backdrop" id="llm-backdrop"></div>
```

- [ ] **Step 3: Verify HTML structure**

Open `http://localhost:5173` (or the app's dev server port). The topbar should show a purple "✦ Ask LLM" button on the right. Clicking it does nothing yet — that's expected. No console errors.

- [ ] **Step 4: Commit**

```bash
git add ui/static/index.html
git commit -m "feat: add LLM sidebar HTML structure and topbar button"
```

---

## Task 2: CSS — Sidebar Styles

**Files:**
- Modify: `ui/static/styles.css`

- [ ] **Step 1: Add topbar button styles**

Append to `ui/static/styles.css`:

```css
/* ── LLM Sidebar ────────────────────────────────────────────── */

/* Topbar button */
.llm-btn {
  background: #7c6af5;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1;
}
.llm-btn:hover { background: #6a5ae0; }
.llm-btn.active { background: #5a4ad0; }
```

- [ ] **Step 2: Add sidebar container and backdrop styles**

```css
/* Sidebar overlay */
.llm-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: #12121a;
  border-left: 1px solid #2a2a3a;
  display: flex;
  flex-direction: column;
  z-index: 100;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
}
.llm-sidebar.open { transform: translateX(0); }

.llm-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 99;
}
.llm-backdrop.visible { display: block; }

/* View switching within sidebar */
.llm-view { display: none; flex-direction: column; flex: 1; overflow: hidden; }
.llm-view.active { display: flex; }
```

- [ ] **Step 3: Add header, context bar, and message styles**

```css
/* Header */
.llm-header {
  background: #161620;
  border-bottom: 1px solid #2a2a3a;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.llm-header-icon { color: #7c6af5; font-size: 15px; }
.llm-header-title { font-size: 13px; font-weight: 700; color: #c0c0e0; flex: 1; }

.llm-icon-btn {
  background: #1e1e2a;
  border: 1px solid #2a2a3a;
  border-radius: 5px;
  min-width: 26px; height: 26px;
  padding: 0 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #666; cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}
.llm-icon-btn:hover { background: #242432; color: #aaa; }

/* Context bar */
.llm-ctx-bar {
  background: #0f0f17;
  border-bottom: 1px solid #1e1e2a;
  padding: 6px 12px;
  font-size: 9px;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  color: #7a7a9a;
  overflow: hidden;
}
.llm-ctx-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #4a9e6a;
  flex-shrink: 0;
}
.llm-ctx-dot.inactive { background: #444; }

/* Message list */
.llm-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Message bubbles */
.llm-msg { display: flex; flex-direction: column; gap: 3px; }
.llm-msg-role {
  font-size: 8px;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: 'JetBrains Mono', monospace;
}
.llm-msg-bubble {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'JetBrains Mono', monospace;
}
.llm-msg.user .llm-msg-bubble {
  background: #1e1e30;
  color: #b0b0d0;
  border: 1px solid #2a2a40;
}
.llm-msg.assistant .llm-msg-bubble {
  background: #161618;
  color: #c8c8c8;
  border: 1px solid #222226;
}
.llm-msg.error .llm-msg-bubble {
  background: #1a1010;
  color: #ff6b6b;
  border: 1px solid #3a1a1a;
}

/* Streaming cursor blink */
.llm-cursor {
  display: inline-block;
  width: 6px; height: 13px;
  background: #7c6af5;
  margin-left: 2px;
  vertical-align: middle;
  animation: llm-blink 0.8s step-end infinite;
}
@keyframes llm-blink { 50% { opacity: 0; } }
```

- [ ] **Step 4: Add input area and settings styles**

```css
/* Input area */
.llm-input-area {
  border-top: 1px solid #2a2a3a;
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  background: #0f0f17;
  flex-shrink: 0;
}
.llm-textarea {
  flex: 1;
  background: #1a1a24;
  border: 1px solid #2a2a3a;
  border-radius: 6px;
  padding: 7px 8px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #c0c0d0;
  resize: none;
  min-height: 34px;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.4;
}
.llm-textarea:focus { outline: none; border-color: #3a3a5a; }
.llm-send {
  background: #7c6af5;
  border: none;
  border-radius: 6px;
  width: 34px; height: 34px;
  font-size: 14px;
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.llm-send:hover { background: #6a5ae0; }
.llm-send:disabled { background: #2a2a3a; cursor: not-allowed; color: #555; }

/* Settings panel */
.llm-settings-body {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.llm-setting-group { display: flex; flex-direction: column; gap: 5px; }
.llm-setting-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5a5a7a;
  font-family: 'JetBrains Mono', monospace;
}
.llm-setting-static {
  background: #1a1a24;
  border: 1px solid #2a2a3a;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  color: #555;
  font-family: 'JetBrains Mono', monospace;
}
.llm-setting-input {
  background: #1a1a24;
  border: 1px solid #2a2a3a;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #c0c0d0;
  width: 100%;
}
.llm-setting-input:focus { outline: none; border-color: #3a3a5a; }
.llm-setting-hint { font-size: 9px; color: #444; font-family: 'JetBrains Mono', monospace; }
.llm-conn-status { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #666; }
.llm-conn-status.connected { color: #4a9e6a; }
.llm-conn-status.error { color: #ff6b6b; }
.llm-save-btn {
  background: #7c6af5;
  border: none;
  border-radius: 6px;
  padding: 9px 14px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
  margin-top: auto;
}
.llm-save-btn:hover { background: #6a5ae0; }
```

- [ ] **Step 5: Verify styles**

Refresh the app. The "✦ Ask LLM" button should appear purple in the topbar. Open browser devtools → inspect `#llm-sidebar` — should be `translateX(100%)` (off-screen).

- [ ] **Step 6: Commit**

```bash
git add ui/static/styles.css
git commit -m "feat: add LLM sidebar CSS — overlay, messages, settings"
```

---

## Task 3: JS — Sidebar Toggle and Settings Persistence

**Files:**
- Modify: `ui/static/app.js`

- [ ] **Step 1: Add LLM state fields**

In `app.js`, inside the `state` object (after `indicators: new Set(),`), add:

```js
  llmOpen: false,
  llmHistory: [],    // [{role, content}] persists across navigation
  llmStreaming: false,
```

- [ ] **Step 2: Add toggle, settings load/save, and test-connection functions**

Add after the `INDICATOR_DEFS` constant (before the `$` helper):

```js
// ── LLM Sidebar ────────────────────────────────────────────────

const LLM_URL_KEY = "secrs.llm_server_url";
const LLM_HISTORY_MAX = 20;

function loadLlmSettings() {
  return {
    serverUrl: localStorage.getItem(LLM_URL_KEY) || "http://localhost:8080",
  };
}

function saveLlmSettings(url) {
  localStorage.setItem(LLM_URL_KEY, url.trim());
}

async function testLlmConnection(url) {
  const res = await fetch(`${url.replace(/\/$/, "")}/v1/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.data?.[0]?.id || "unknown";
}

function openLlmSidebar() {
  state.llmOpen = true;
  $("#llm-sidebar").classList.add("open");
  $("#llm-btn").classList.add("active");
  $("#llm-backdrop").classList.add("visible");
  updateLlmContextBar();
}

function closeLlmSidebar() {
  state.llmOpen = false;
  $("#llm-sidebar").classList.remove("open");
  $("#llm-btn").classList.remove("active");
  $("#llm-backdrop").classList.remove("visible");
}

function showLlmView(view) {
  $$(".llm-view").forEach((v) => v.classList.remove("active"));
  $(`#llm-${view}-view`).classList.add("active");
}
```

- [ ] **Step 3: Add `bindLlmSidebar` function (toggle + settings only for now)**

```js
function bindLlmSidebar() {
  // Populate settings input from localStorage on load
  $("#llm-server-url").value = loadLlmSettings().serverUrl;

  // Topbar button: toggle open/close
  $("#llm-btn").addEventListener("click", () => {
    if (state.llmOpen) closeLlmSidebar();
    else openLlmSidebar();
  });

  // Close button inside sidebar
  $("#llm-close-btn").addEventListener("click", closeLlmSidebar);

  // Backdrop click closes sidebar
  $("#llm-backdrop").addEventListener("click", closeLlmSidebar);

  // ESC key closes sidebar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.llmOpen) closeLlmSidebar();
  });

  // Gear → settings view
  $("#llm-settings-btn").addEventListener("click", () => {
    $("#llm-server-url").value = loadLlmSettings().serverUrl;
    $("#llm-conn-status").textContent = "—";
    $("#llm-conn-status").className = "llm-conn-status";
    showLlmView("settings");
  });

  // Back → chat view
  $("#llm-back-btn").addEventListener("click", () => showLlmView("chat"));

  // Save & Test Connection
  $("#llm-save-btn").addEventListener("click", async () => {
    const url = $("#llm-server-url").value.trim();
    const status = $("#llm-conn-status");
    if (!url) return;
    saveLlmSettings(url);
    status.textContent = "Testing…";
    status.className = "llm-conn-status";
    try {
      const model = await testLlmConnection(url);
      status.textContent = `● Connected · ${model}`;
      status.className = "llm-conn-status connected";
    } catch (err) {
      status.textContent = `✕ Unreachable — ${err.message}`;
      status.className = "llm-conn-status error";
    }
  });
}
```

- [ ] **Step 4: Call `bindLlmSidebar()` in the init block**

In the `loadOptions().then(() => { ... })` block at the bottom of `app.js`, add `bindLlmSidebar();` after `bindIndicatorChips();`:

```js
  bindIndicatorChips();
  bindLlmSidebar();   // ← add this line
  initSearch();
```

- [ ] **Step 5: Manual verification — toggle and settings**

Start the server (`uv run main.py` or however the app is run). Verify:
- "✦ Ask LLM" button appears in topbar right
- Clicking opens the sidebar (slides in from right)
- Clicking again, pressing ESC, or clicking the backdrop closes it
- Clicking ⚙ switches to settings view; clicking ← Back returns to chat
- Entering a URL and clicking "Save & Test Connection" either shows green Connected or red Unreachable
- Server URL persists across page refresh

- [ ] **Step 6: Commit**

```bash
git add ui/static/app.js
git commit -m "feat: LLM sidebar toggle, settings panel, localStorage persistence"
```

---

## Task 4: JS — Context Assembly

**Files:**
- Modify: `ui/static/app.js`

- [ ] **Step 1: Add helper to read visible table rows**

Add after `showLlmView`:

```js
function getLlmTableRows(limit = 20) {
  const table = $("#result-table");
  if (!table || !table.rows.length) return null;
  const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
  const rows = Array.from(table.querySelectorAll("tbody tr"))
    .slice(0, limit)
    .map((tr) =>
      Object.fromEntries(
        Array.from(tr.querySelectorAll("td")).map((td, i) => [headers[i] || i, td.textContent])
      )
    );
  return rows.length ? rows : null;
}
```

- [ ] **Step 2: Add `buildLlmContext` and `buildSystemPrompt`**

```js
function buildLlmContext() {
  const route = state.route;

  if (route === "ticker") {
    const ticker = state.ticker || "—";
    const tab = state.tickerMainTab;

    if (tab === "chart") {
      const inds = [...state.indicators].join(", ") || "none";
      return {
        description: `${ticker} chart — period: ${state.chartPeriod}, interval: ${state.chartInterval}, indicators: ${inds}`,
        data: null,
      };
    }
    if (tab === "financials") {
      const view = state.tickerView || "statement";
      const period = $("#ticker-period")?.value === "true" ? "quarterly" : "annual";
      return {
        description: `${ticker} ${view.replace(/_/g, " ")} (${period})`,
        data: getLlmTableRows(20),
      };
    }
    if (tab === "info") {
      const card = $("#ticker-info-body");
      const text = card ? card.innerText.slice(0, 800).trim() : "";
      return {
        description: `${ticker} company info`,
        data: text || null,
      };
    }
  }

  if (route === "single") {
    const ticker = ($("#single-form")?.elements?.ticker?.value || "").toUpperCase();
    const view = $("#single-form")?.elements?.view?.value || "statement";
    return {
      description: `${ticker} ${view.replace(/_/g, " ")}`,
      data: getLlmTableRows(20),
    };
  }

  if (route === "multi") {
    const tickers = ($("#multi-form")?.elements?.tickers?.value || "").replace(/\n/g, ", ");
    const analysis = $("#multi-form")?.elements?.analysis?.value || "analysis";
    return {
      description: `Multi-ticker ${analysis}: ${tickers}`,
      data: getLlmTableRows(20),
    };
  }

  if (route === "screener") {
    return {
      description: "Screener results",
      data: getLlmTableRows(20),
    };
  }

  if (route === "dcf") {
    const tickers = ($("#dcf-form")?.elements?.tickers?.value || "").replace(/\n/g, ", ");
    return {
      description: `DCF valuation: ${tickers}`,
      data: getLlmTableRows(10),
    };
  }

  return { description: `${route} page`, data: null };
}

function buildSystemPrompt() {
  const ctx = buildLlmContext();
  let prompt = `You are a financial analysis assistant embedded in secrs, a SEC EDGAR filings tool.\nThe user is currently viewing: ${ctx.description}.`;
  if (ctx.data) {
    if (typeof ctx.data === "string") {
      prompt += `\n\nContext:\n${ctx.data}`;
    } else if (Array.isArray(ctx.data) && ctx.data.length) {
      prompt += `\n\nVisible data (up to ${ctx.data.length} rows):\n${JSON.stringify(ctx.data)}`;
    }
  }
  prompt += `\n\nAnswer concisely. If asked about data not shown, say so.`;
  return prompt;
}
```

- [ ] **Step 3: Add `updateLlmContextBar`**

```js
function updateLlmContextBar() {
  const ctx = buildLlmContext();
  const text = $("#llm-ctx-text");
  const dot = $("#llm-ctx-dot");
  if (!text || !dot) return;
  text.textContent = `Context: ${ctx.description}`;
  dot.classList.toggle("inactive", !ctx.description || ctx.description.includes("—"));
}
```

- [ ] **Step 4: Wire context bar updates into navigation**

In `openTickerPage()`, add a call at the end:

```js
  // existing last line: runTickerChart();
  if (state.llmOpen) updateLlmContextBar();
```

In `setTickerMainTab()`, add at the end:

```js
  if (state.llmOpen) updateLlmContextBar();
```

In `setRoute()`, add at the end (inside the function body):

```js
  if (state.llmOpen) updateLlmContextBar();
```

- [ ] **Step 5: Manual verification — context bar**

Open the sidebar. The context bar should read "Context: single page" (or whatever the current route is). Navigate to a ticker via search — context should update to "Context: AAPL chart — period: 1mo, …". Switch to Financials tab — context updates. Switch route via nav — context updates.

- [ ] **Step 6: Commit**

```bash
git add ui/static/app.js
git commit -m "feat: LLM context assembly and context bar updates"
```

---

## Task 5: JS — Streaming Chat

**Files:**
- Modify: `ui/static/app.js`

- [ ] **Step 1: Add `appendLlmMessage`**

```js
function appendLlmMessage(role, content, streaming = false) {
  const msgs = $("#llm-messages");
  const div = document.createElement("div");
  div.className = `llm-msg ${role}`;
  const roleLabel = role === "user" ? "You" : role === "error" ? "Error" : "LLM";
  const roleEl = document.createElement("span");
  roleEl.className = "llm-msg-role";
  roleEl.textContent = roleLabel;
  const bubble = document.createElement("div");
  bubble.className = "llm-msg-bubble";
  bubble.textContent = content;
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "llm-cursor";
    bubble.appendChild(cursor);
  }
  div.appendChild(roleEl);
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}
```

- [ ] **Step 2: Add `streamLlmResponse`**

```js
async function streamLlmResponse(messages) {
  const { serverUrl } = loadLlmSettings();
  const url = `${serverUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const bubble = appendLlmMessage("assistant", "", true);
  let content = "";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "local", messages, stream: true }),
    });
  } catch (err) {
    bubble.parentElement.remove();
    appendLlmMessage("error", `⚠ Could not reach LLM server. Check Settings.`);
    return "";
  }

  if (!res.ok) {
    bubble.parentElement.remove();
    appendLlmMessage("error", `⚠ LLM server returned HTTP ${res.status}. Check Settings.`);
    return "";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const obj = JSON.parse(raw);
        const token = obj.choices?.[0]?.delta?.content;
        if (token) {
          content += token;
          const cursor = bubble.querySelector(".llm-cursor");
          if (cursor) cursor.remove();
          bubble.textContent = content;
          const newCursor = document.createElement("span");
          newCursor.className = "llm-cursor";
          bubble.appendChild(newCursor);
          $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;
        }
      } catch {}
    }
  }

  // Remove cursor, finalize text
  const cursor = bubble.querySelector(".llm-cursor");
  if (cursor) cursor.remove();
  bubble.textContent = content;
  $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;
  return content;
}
```

- [ ] **Step 3: Add `sendLlmMessage`**

```js
async function sendLlmMessage() {
  const textarea = $("#llm-textarea");
  const userText = textarea.value.trim();
  if (!userText || state.llmStreaming) return;

  state.llmStreaming = true;
  textarea.value = "";
  textarea.style.height = "34px";
  $("#llm-send").disabled = true;

  // Append user message to history and UI
  state.llmHistory.push({ role: "user", content: userText });
  appendLlmMessage("user", userText);

  // Trim history to max
  if (state.llmHistory.length > LLM_HISTORY_MAX) {
    state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
  }

  const systemMsg = { role: "system", content: buildSystemPrompt() };
  const messages = [systemMsg, ...state.llmHistory];

  try {
    const reply = await streamLlmResponse(messages);
    if (reply) {
      state.llmHistory.push({ role: "assistant", content: reply });
      if (state.llmHistory.length > LLM_HISTORY_MAX) {
        state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
      }
    }
  } catch (err) {
    appendLlmMessage("error", `⚠ ${err.message}`);
  } finally {
    state.llmStreaming = false;
    $("#llm-send").disabled = false;
    textarea.focus();
  }
}
```

- [ ] **Step 4: Wire send button and textarea keyboard shortcut into `bindLlmSidebar`**

Inside `bindLlmSidebar()`, after the `$("#llm-save-btn")` listener block, add:

```js
  // Send button
  $("#llm-send").addEventListener("click", sendLlmMessage);

  // Enter sends, Shift+Enter inserts newline
  $("#llm-textarea").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendLlmMessage();
    }
  });

  // Auto-resize textarea as user types
  $("#llm-textarea").addEventListener("input", () => {
    const ta = $("#llm-textarea");
    ta.style.height = "34px";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  });
```

- [ ] **Step 5: Manual verification — streaming chat**

With a Llama.cpp server running at `http://localhost:8080`:
1. Open sidebar → Settings → enter server URL → Save & Test. Should show "● Connected · {model name}".
2. Go back to chat. Type "Hello" and press Enter.
3. Should see user bubble appear immediately, then LLM bubble starts filling in with tokens.
4. Blinking cursor visible while streaming, disappears when done.
5. Navigate to a ticker, open sidebar, ask "What is the current P/E?". System prompt should include chart context.
6. If server is offline: should show `⚠ Could not reach LLM server. Check Settings.` error bubble.

- [ ] **Step 6: Commit**

```bash
git add ui/static/app.js
git commit -m "feat: LLM streaming chat with SSE, history management, context-aware system prompt"
```

---

## Self-Review

After writing this plan, spec coverage check:

| Spec requirement | Task |
|-----------------|------|
| "Ask LLM" button in topbar right | Task 1 step 1 |
| Overlay sidebar slides from right | Task 2 steps 2–3 |
| Context bar shows current page context | Task 4 steps 3–4 |
| Settings view: server URL only, Save & Test | Task 3 steps 2–3 |
| LocalStorage persistence | Task 3 step 2 (`saveLlmSettings`) |
| Chat history persists across navigation | `state.llmHistory` in all tasks |
| Max 20 message history | `LLM_HISTORY_MAX` constant, Task 5 step 3 |
| SSE streaming with cursor | Task 5 steps 2–3 |
| Error bubble on connection failure | Task 5 step 2 |
| Context per page (chart/financials/info/single/multi) | Task 4 step 2 |
| System prompt template | Task 4 step 2 (`buildSystemPrompt`) |
| ESC + backdrop close | Task 3 step 3 |
| Enter sends, Shift+Enter newline | Task 5 step 4 |
| Test Connection pings /v1/models | Task 3 step 2 (`testLlmConnection`) |
