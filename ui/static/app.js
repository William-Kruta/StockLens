import { state } from "/modules/state.js";
import { $, $$ } from "/modules/dom.js";
import { post, setStatus } from "/modules/data.js";
import { renderTable, renderSummary, formatValue } from "/modules/table.js";
import {
  bindTickerFinancialsControls,
  runTickerFinancials,
} from "/modules/tickerFinancials.js";
import {
  bindDashboard as bindDashboardModule,
  bindMarkets as bindMarketsModule,
  runDashboard as runDashboardModule,
  runMarkets as runMarketsModule,
} from "/modules/markets.js";
import { initSearch as initSearchModule } from "/modules/search.js";
import {
  bindOptionScreener,
  renderOptionScreenerWatchlists,
} from "/modules/optionScreener.js";
import {
  runTickerOptions as runTickerOptionsModule,
  runTickerInfo as runTickerInfoModule,
  runTickerInsider as runTickerInsiderModule,
} from "/modules/tickerDetails.js";
import { escapeHtml, tickerList, uniqueTickers } from "/modules/utils.js";

// Color + group metadata for each indicator key
const INDICATOR_DEFS = {
  sma_20:  { color: "#4FC3F7", group: "overlay" },
  sma_50:  { color: "#FFB800", group: "overlay" },
  sma_200: { color: "#FF4B4B", group: "overlay" },
  ema_12:  { color: "#00E5A0", group: "overlay" },
  ema_26:  { color: "#FF8A65", group: "overlay" },
  bb:      { color: "#B388FF", group: "overlay" },
  macd:    { color: "#4FC3F7", group: "panel"   },
  rsi:     { color: "#C8FF00", group: "panel"   },
  atr:     { color: "#FFB800", group: "panel"   },
};
const COMPARE_COLORS = ["#4FC3F7", "#FFB800", "#FF4B4B", "#00E5A0", "#FF8A65", "#B388FF"];
const DASHBOARD_MARKETS = [
  { sub: "gainers", id: "dashboard-gainers" },
  { sub: "losers", id: "dashboard-losers" },
  { sub: "unusual_volume", id: "dashboard-unusual-volume" },
];

// ── LLM Sidebar ────────────────────────────────────────────────

const LLM_URL_KEY = "secrs.llm_server_url";
const LLM_HISTORY_MAX = 20;
const MARKETS_CLIENT_CACHE_TTL_MS = 60_000;

function loadLlmSettings() {
  return {
    serverUrl: localStorage.getItem(LLM_URL_KEY) || "http://localhost:8080",
  };
}

function saveLlmSettings(url) {
  localStorage.setItem(LLM_URL_KEY, url.trim().replace(/\/$/, ""));
}

const CHAT_STORAGE_KEY = "secrs.chat.conversations";
const CHAT_SETTINGS_KEY = "secrs.chat.settings";
const CHAT_MODELS = {
  claude: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

function runMarkets(sub = "most_active") {
  return runMarketsModule(sub, {
    openTickerPage,
    updateLlmContextBar,
    clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
  });
}

function runDashboard() {
  return runDashboardModule(DASHBOARD_MARKETS, {
    clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
  });
}

function bindMarkets() {
  bindMarketsModule((sub) => runMarkets(sub));
}

function bindDashboard() {
  bindDashboardModule((sub) => openDashboardMarket(sub));
}

function initSearch() {
  initSearchModule(openTickerPage);
}

function runTickerInfo() {
  return runTickerInfoModule();
}

function runTickerOptions() {
  return runTickerOptionsModule();
}

function runTickerInsider() {
  return runTickerInsiderModule();
}

function renderMarkdown(text) {
  if (!text || typeof globalThis.marked === "undefined") return text || "";
  return globalThis.marked.parse(text, { breaks: true, gfm: true });
}

async function fetchWebContext(query) {
  try {
    const res = await fetch(`/api/web-search?q=${encodeURIComponent(query)}&max=5`);
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || !results.length) return null;
    const lines = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`
    );
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `[Today's date: ${today}]\n\n[Web search results for: "${query}"]\n\n${lines.join("\n\n")}`;
  } catch {
    return null;
  }
}

function loadChatConversations() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
  } catch { return []; }
}

function saveChatConversations(convs) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(convs));
  } catch (err) {
    setStatus("Chat storage full — delete some conversations.", true);
  }
}

function loadChatSettings() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) || "{}");
  } catch { return {}; }
}

function saveChatSettings(settings) {
  const current = loadChatSettings();
  localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

function createConversation(provider = "claude") {
  const settings = loadChatSettings();
  const model = provider === "claude"
    ? (settings.claudeModel || "claude-sonnet-4-6")
    : provider === "openai"
    ? (settings.openaiModel || "gpt-4o")
    : null;
  const conv = {
    id: crypto.randomUUID(),
    title: "New conversation",
    provider,
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.chatConversations.unshift(conv);
  saveChatConversations(state.chatConversations);
  return conv;
}

function getActiveConversation() {
  return state.chatConversations.find((c) => c.id === state.chatActiveId) || null;
}

function updateConversation(id, changes) {
  const conv = state.chatConversations.find((c) => c.id === id);
  if (!conv) return;
  Object.assign(conv, changes, { updatedAt: Date.now() });
  state.chatConversations.sort((a, b) => b.updatedAt - a.updatedAt);
  saveChatConversations(state.chatConversations);
}

function deleteConversation(id) {
  state.chatConversations = state.chatConversations.filter((c) => c.id !== id);
  saveChatConversations(state.chatConversations);
  if (state.chatActiveId === id) {
    state.chatActiveId = state.chatConversations[0]?.id || null;
    renderChatMessages();
    renderChatToolbar();
  }
  renderChatSidebar();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function renderChatSidebar() {
  const list = $("#chat-conv-list");
  if (!list) return;
  if (!state.chatConversations.length) {
    list.innerHTML = '<div class="chat-conv-empty">No conversations yet.</div>';
    return;
  }
  list.innerHTML = state.chatConversations
    .map(
      (conv) => `
    <div class="chat-conv-item${conv.id === state.chatActiveId ? " active" : ""}"
         data-conv-id="${conv.id}">
      <div class="chat-conv-title">${escapeHtml(conv.title)}</div>
      <div class="chat-conv-meta">${escapeHtml(conv.provider)} · ${timeAgo(conv.updatedAt)}</div>
      <button class="chat-conv-delete" data-conv-delete="${conv.id}"
              type="button" aria-label="Delete conversation">×</button>
    </div>`
    )
    .join("");
  list.querySelectorAll("[data-conv-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-conv-delete]")) return;
      openConversation(el.dataset.convId);
    });
  });
  list.querySelectorAll("[data-conv-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.convDelete);
    });
  });
}

function appendChatMessage(role, content, streaming = false, provider = null) {
  const area = $("#chat-messages");
  if (!area) return null;
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  const roleEl = document.createElement("span");
  roleEl.className = "chat-msg-role";
  roleEl.textContent = role === "user" ? "You" : role === "error" ? "Error" : (provider || "Assistant");
  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";
  if (streaming || role !== "assistant") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "llm-cursor";
    bubble.appendChild(cursor);
  }
  div.appendChild(roleEl);
  div.appendChild(bubble);
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return bubble;
}

function renderChatMessages() {
  const area = $("#chat-messages");
  if (!area) return;
  const conv = getActiveConversation();
  const inputEl = $("#chat-input");
  const sendEl = $("#chat-send");
  if (!conv) {
    area.innerHTML = `
      <div class="chat-empty-state" id="chat-empty-state">
        <p>No conversation selected.</p>
        <button class="secondary" id="chat-empty-new" type="button">+ New conversation</button>
      </div>`;
    $("#chat-empty-new")?.addEventListener("click", () => {
      const c = createConversation(defaultChatProvider());
      openConversation(c.id);
      renderChatSidebar();
    });
    if (inputEl) inputEl.disabled = true;
    if (sendEl) sendEl.disabled = true;
    const webToggle = $("#chat-web-toggle");
    if (webToggle) webToggle.disabled = true;
    const deepToggle = $("#chat-deep-toggle");
    if (deepToggle) deepToggle.disabled = true;
    return;
  }
  area.innerHTML = "";
  const webToggle = $("#chat-web-toggle");
  if (webToggle) webToggle.disabled = false;
  const deepToggle = $("#chat-deep-toggle");
  if (deepToggle) deepToggle.disabled = false;
  conv.messages.forEach((msg) =>
    appendChatMessage(msg.role, msg.content, false, msg.provider)
  );
  area.scrollTop = area.scrollHeight;
  if (inputEl) inputEl.disabled = false;
  if (sendEl) sendEl.disabled = false;
}

function renderChatToolbar() {
  const titleEl = $("#chat-conv-title");
  const providerBtn = $("#chat-provider-btn");
  const conv = getActiveConversation();
  if (!titleEl || !providerBtn) return;
  if (!conv) {
    titleEl.textContent = "";
    providerBtn.textContent = "— ▾";
    providerBtn.disabled = true;
    return;
  }
  titleEl.textContent = conv.title;
  const modelShort = conv.model
    ? conv.model.split("-").slice(0, 3).join("-")
    : "";
  providerBtn.textContent = modelShort
    ? `${conv.provider} · ${modelShort} ▾`
    : `${conv.provider} ▾`;
  providerBtn.disabled = false;
}

function defaultChatProvider() {
  if (state.chatProviders.claude) return "claude";
  if (state.chatProviders.openai) return "openai";
  return "llama";
}

function openConversation(id) {
  state.chatActiveId = id;
  renderChatSidebar();
  renderChatMessages();
  renderChatToolbar();
  $("#chat-input")?.focus();
}

async function streamChatResponse(messages, provider, model, bubbleEl) {
  let url, bodyObj;
  const headers = { "content-type": "application/json" };

  if (provider === "llama") {
    const { serverUrl } = loadLlmSettings();
    url = `${serverUrl.replace(/\/$/, "")}/v1/chat/completions`;
    bodyObj = { model: "local", messages, stream: true };
  } else {
    url = `/api/chat/${provider}`;
    bodyObj = { messages, model, stream: true };
  }

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyObj) });
  } catch (err) {
    return { content: "", error: "Could not reach server. Check settings." };
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
    return { content: "", error: errMsg };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break outer;
      try {
        const obj = JSON.parse(raw);
        const token = obj.choices?.[0]?.delta?.content;
        if (token) {
          content += token;
          const cursor = bubbleEl.querySelector(".llm-cursor");
          if (cursor) cursor.remove();
          bubbleEl.textContent = content;
          const newCursor = document.createElement("span");
          newCursor.className = "llm-cursor";
          bubbleEl.appendChild(newCursor);
          bubbleEl.closest("#chat-messages")?.scrollTo(0, 999999);
        }
      } catch {}
    }
  }

  reader.cancel();
  const cursor = bubbleEl.querySelector(".llm-cursor");
  if (cursor) cursor.remove();
  bubbleEl.innerHTML = renderMarkdown(content);
  return { content, error: null };
}

async function sendDeepResearch() {
  const input = $("#chat-input");
  const text = input?.value.trim();
  const conv = getActiveConversation();
  if (!text || !conv || state.chatStreaming) return;

  const { provider, model } = conv;
  const llamaUrl = provider === "llama" ? (loadLlmSettings().serverUrl || "http://localhost:8080") : undefined;

  state.chatStreaming = true;
  input.value = "";
  input.style.height = "38px";
  $("#chat-send")?.setAttribute("disabled", "");

  const isFirstAssistant = !conv.messages.some((m) => m.role === "assistant");
  conv.messages.push({ role: "user", content: text, timestamp: Date.now() });
  updateConversation(conv.id, {});
  appendChatMessage("user", text);

  // Build research progress card
  const area = $("#chat-messages");
  const progressMsgDiv = document.createElement("div");
  progressMsgDiv.className = "chat-msg assistant";
  const progressRoleEl = document.createElement("span");
  progressRoleEl.className = "chat-msg-role";
  progressRoleEl.textContent = provider || "Assistant";
  const progressCard = document.createElement("div");
  progressCard.className = "research-progress";
  progressCard.innerHTML = `<div class="research-header">🔬 Deep Research</div><div class="research-phase">Planning…</div>`;
  progressMsgDiv.appendChild(progressRoleEl);
  progressMsgDiv.appendChild(progressCard);
  area.appendChild(progressMsgDiv);
  area.scrollTop = area.scrollHeight;

  const apiMessages = conv.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  let content = "";
  let isClarification = false;
  let queries = [];
  const queryStatus = {};
  let answerBubble = null; // created via appendChatMessage when synthesizing starts

  function redrawProgress() {
    let html = `<div class="research-header">🔬 Deep Research</div>`;
    const phaseText = progressCard.dataset.phase || "Planning…";
    html += `<div class="research-phase">${phaseText}</div>`;
    if (queries.length) {
      html += `<ul class="research-query-list">`;
      for (const q of queries) {
        const s = queryStatus[q] || "pending";
        const icon = s === "done" ? "✓" : s === "active" ? "⟳" : "○";
        const cls = s === "done" ? "done" : s === "active" ? "active" : "";
        html += `<li class="research-query-item"><em class="research-q-icon ${cls}">${icon}</em><span>${q}</span></li>`;
      }
      html += `</ul>`;
    }
    progressCard.innerHTML = html;
  }

  function setPhase(text) {
    progressCard.dataset.phase = text;
    redrawProgress();
  }

  try {
    const res = await fetch("/api/chat/deep-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, provider, model, ...(llamaUrl && { llamaUrl }) }),
    });
    if (!res.ok) {
      progressMsgDiv.remove();
      appendChatMessage("error", `⚠ HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break outer;
        try {
          const evt = JSON.parse(raw);
          switch (evt.type) {
            case "status":
              setPhase(evt.text);
              break;
            case "plan":
              queries = evt.queries;
              for (const q of queries) queryStatus[q] = "pending";
              setPhase("Searching the web…");
              break;
            case "searching":
              queryStatus[evt.query] = "active";
              redrawProgress();
              break;
            case "search_done":
              queryStatus[evt.query] = "done";
              redrawProgress();
              break;
            case "synthesizing":
              setPhase("Synthesizing…");
              // Use the same appendChatMessage pattern as normal streaming
              answerBubble = appendChatMessage("assistant", "", true, provider);
              break;
            case "token":
              if (answerBubble) {
                content += evt.content;
                const cursor = answerBubble.querySelector(".llm-cursor");
                if (cursor) cursor.remove();
                answerBubble.textContent = content;
                const newCursor = document.createElement("span");
                newCursor.className = "llm-cursor";
                answerBubble.appendChild(newCursor);
                area.scrollTop = area.scrollHeight;
              }
              break;
            case "clarification":
              isClarification = true;
              content = evt.text;
              progressMsgDiv.remove();
              appendChatMessage("assistant", evt.text, false, provider);
              break;
            case "error":
              progressMsgDiv.remove();
              if (answerBubble) answerBubble.closest(".chat-msg")?.remove();
              appendChatMessage("error", `⚠ ${evt.text}`);
              break;
          }
        } catch {}
      }
    }
    reader.cancel();
    if (answerBubble) {
      answerBubble.querySelector(".llm-cursor")?.remove();
      if (content) {
        answerBubble.innerHTML = renderMarkdown(content);
      } else {
        answerBubble.textContent = "(No response)";
      }
    }

    if (content && !isClarification) {
      conv.messages.push({ role: "assistant", content, provider, model, timestamp: Date.now() });
      updateConversation(conv.id, {});
      if (isFirstAssistant) generateChatTitle(conv.id, text, provider, model);
    } else if (isClarification) {
      conv.messages.push({ role: "assistant", content, provider, model, timestamp: Date.now() });
      updateConversation(conv.id, {});
    }
  } catch (err) {
    appendChatMessage("error", `⚠ ${err.message}`);
  } finally {
    state.chatStreaming = false;
    $("#chat-send")?.removeAttribute("disabled");
    const wt = $("#chat-web-toggle");
    if (wt) wt.disabled = false;
    const dt2 = $("#chat-deep-toggle");
    if (dt2) dt2.disabled = false;
  }
}

async function sendChatMessage() {
  if (state.chatDeepResearch) return sendDeepResearch();

  const input = $("#chat-input");
  const text = input?.value.trim();
  const conv = getActiveConversation();
  if (!text || !conv || state.chatStreaming) return;

  state.chatStreaming = true;
  input.value = "";
  input.style.height = "38px";
  $("#chat-send")?.setAttribute("disabled", "");

  const isFirstAssistant = !conv.messages.some((m) => m.role === "assistant");
  const userMsg = { role: "user", content: text, timestamp: Date.now() };
  conv.messages.push(userMsg);
  updateConversation(conv.id, {});
  const userBubble = appendChatMessage("user", text);

  const { provider, model } = conv;
  const bubble = appendChatMessage("assistant", "", true, provider);
  const apiMessages = conv.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  if (state.chatWebSearch) {
    const webCtx = await fetchWebContext(text);
    if (webCtx && apiMessages.length) {
      apiMessages[apiMessages.length - 1] = { role: "user", content: `${webCtx}\n\n---\n\n${text}` };
      userBubble?.closest(".chat-msg")?.classList.add("web-search");
    }
  }

  try {
    const { content, error } = await streamChatResponse(apiMessages, provider, model, bubble);

    if (error) {
      bubble.closest(".chat-msg")?.remove();
      appendChatMessage("error", `⚠ ${error}`);
    } else if (content) {
      const assistantMsg = { role: "assistant", content, provider, model, timestamp: Date.now() };
      conv.messages.push(assistantMsg);
      updateConversation(conv.id, {});
      if (isFirstAssistant) generateChatTitle(conv.id, text, provider, model);
    }
  } finally {
    state.chatStreaming = false;
    const sendBtn = $("#chat-send");
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

async function generateChatTitle(convId, firstMessage, provider, model) {
  const messages = [
    {
      role: "system",
      content:
        "You generate conversation titles. Reply with ONLY the title — 5 words or fewer, no punctuation at the end.",
    },
    { role: "user", content: firstMessage },
  ];
  const dummyBubble = document.createElement("div");
  try {
    const { content } = await streamChatResponse(messages, provider, model, dummyBubble);
    const title = content.trim().slice(0, 60);
    if (title) {
      updateConversation(convId, { title });
      renderChatSidebar();
      if (state.chatActiveId === convId) renderChatToolbar();
    }
  } catch {}
}

function renderChatProviderDropdown() {
  const dropdown = $("#chat-provider-dropdown");
  const conv = getActiveConversation();
  if (!dropdown || !conv) return;

  const providers = [
    {
      key: "llama",
      label: "Llama.cpp",
      models: null,
      available: !!loadLlmSettings().serverUrl,
    },
    {
      key: "claude",
      label: "Claude",
      models: CHAT_MODELS.claude,
      available: state.chatProviders.claude,
    },
    {
      key: "openai",
      label: "OpenAI",
      models: CHAT_MODELS.openai,
      available: state.chatProviders.openai,
    },
  ];

  dropdown.innerHTML = providers
    .map(
      (p) => `
    <div class="chat-provider-option${!p.available ? " disabled" : ""}${conv.provider === p.key ? " active" : ""}"
         data-provider="${p.key}"
         ${!p.available ? 'title="Not configured"' : ""}>
      <span class="chat-provider-name">${p.label}</span>
      ${
        p.models
          ? `<select class="chat-model-select" data-provider-model="${p.key}"
               ${!p.available ? "disabled" : ""}>
               ${p.models
                 .map(
                   (m) =>
                     `<option value="${m}"${conv.provider === p.key && conv.model === m ? " selected" : ""}>${m}</option>`
                 )
                 .join("")}
             </select>`
          : ""
      }
    </div>`
    )
    .join("");

  dropdown.querySelectorAll(".chat-provider-option:not(.disabled)").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return;
      const modelSel = el.querySelector("[data-provider-model]");
      switchChatProvider(el.dataset.provider, modelSel?.value || null);
    });
  });

  dropdown.querySelectorAll("[data-provider-model]").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      switchChatProvider(sel.dataset.providerModel, sel.value);
    });
  });
}

function switchChatProvider(provider, model) {
  const conv = getActiveConversation();
  if (!conv) return;
  updateConversation(conv.id, { provider, model });
  closeChatProviderDropdown();
  renderChatToolbar();
}

function openChatProviderDropdown() {
  renderChatProviderDropdown();
  $("#chat-provider-dropdown")?.classList.remove("hidden");
}

function closeChatProviderDropdown() {
  $("#chat-provider-dropdown")?.classList.add("hidden");
}

function bindChat() {
  function newConv() {
    const conv = createConversation(defaultChatProvider());
    openConversation(conv.id);
    renderChatSidebar();
  }

  $("#chat-new-btn")?.addEventListener("click", newConv);
  $("#chat-send")?.addEventListener("click", sendChatMessage);

  $("#chat-web-toggle")?.addEventListener("click", () => {
    state.chatWebSearch = !state.chatWebSearch;
    const btn = $("#chat-web-toggle");
    btn.classList.toggle("active", state.chatWebSearch);
    btn.setAttribute("aria-pressed", String(state.chatWebSearch));
  });

  $("#chat-deep-toggle")?.addEventListener("click", () => {
    state.chatDeepResearch = !state.chatDeepResearch;
    const btn = $("#chat-deep-toggle");
    btn.classList.toggle("active", state.chatDeepResearch);
    btn.setAttribute("aria-pressed", String(state.chatDeepResearch));
    const input = $("#chat-input");
    if (input) {
      input.placeholder = state.chatDeepResearch
        ? "Ask a research question… (Enter to send)"
        : "Ask anything… (Enter to send)";
    }
  });

  $("#chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  $("#chat-input")?.addEventListener("input", () => {
    const ta = $("#chat-input");
    ta.style.height = "38px";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  });

  $("#chat-provider-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const dropdown = $("#chat-provider-dropdown");
    if (dropdown?.classList.contains("hidden")) {
      openChatProviderDropdown();
    } else {
      closeChatProviderDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".chat-provider-wrap")) closeChatProviderDropdown();
  });

  $("#chat-settings-btn")?.addEventListener("click", () => {
    state.chatSettingsOpen = !state.chatSettingsOpen;
    const panel = $("#chat-settings-panel");
    panel?.classList.toggle("hidden", !state.chatSettingsOpen);
    panel?.setAttribute("aria-expanded", String(state.chatSettingsOpen));
    $("#chat-settings-btn")?.setAttribute("aria-expanded", String(state.chatSettingsOpen));
    if (state.chatSettingsOpen) {
      const s = loadChatSettings();
      const llamaUrl = $("#chat-llama-url");
      const claudeModel = $("#chat-claude-model");
      const openaiModel = $("#chat-openai-model");
      if (llamaUrl) llamaUrl.value = loadLlmSettings().serverUrl;
      if (claudeModel) claudeModel.value = s.claudeModel || "claude-sonnet-4-6";
      if (openaiModel) openaiModel.value = s.openaiModel || "gpt-4o";
    }
  });

  $("#chat-settings-save")?.addEventListener("click", () => {
    const url = $("#chat-llama-url")?.value.trim();
    if (url) saveLlmSettings(url);
    saveChatSettings({
      claudeModel: $("#chat-claude-model")?.value || "claude-sonnet-4-6",
      openaiModel: $("#chat-openai-model")?.value || "gpt-4o",
    });
    state.chatProviders.llama = !!loadLlmSettings().serverUrl;
    state.chatSettingsOpen = false;
    const panel = $("#chat-settings-panel");
    panel?.classList.add("hidden");
    $("#chat-settings-btn")?.setAttribute("aria-expanded", "false");
  });
}

async function initChat() {
  if (state.chatStreaming) return;
  state.chatConversations = loadChatConversations();
  try {
    const data = await fetch("/api/chat/providers").then((r) => r.json());
    state.chatProviders = {
      llama: !!loadLlmSettings().serverUrl,
      claude: !!data.claude,
      openai: !!data.openai,
    };
  } catch {
    state.chatProviders = {
      llama: !!loadLlmSettings().serverUrl,
      claude: false,
      openai: false,
    };
  }
  renderChatSidebar();
  if (state.chatConversations.length) {
    openConversation(state.chatConversations[0].id);
  } else {
    renderChatMessages();
    renderChatToolbar();
  }
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

function buildLlmContext() {
  const route = state.route;

  if (route === "ticker") {
    const ticker = state.ticker || "—";
    const tab = state.tickerMainTab;

    if (tab === "chart") {
      const inds = [...state.indicators].join(", ") || "none";
      const comparisons = state.compareTickers.map((item) => item.ticker).join(", ") || "none";
      return {
        description: `${ticker} chart — period: ${state.chartPeriod}, interval: ${state.chartInterval}, indicators: ${inds}, comparisons: ${comparisons}`,
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

  if (route === "markets") {
    return {
      description: `Markets — ${state.marketsSub.replace(/_/g, " ")}`,
      data: getLlmTableRows(20),
    };
  }

  if (route === "dashboard") {
    return {
      description: "Dashboard — market pulse",
      data: null,
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
  let prompt = `You are a financial analysis assistant embedded in StockLens, a SEC EDGAR filings tool.\nThe user is currently viewing: ${ctx.description}.`;
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

function updateLlmContextBar() {
  const ctx = buildLlmContext();
  const text = $("#llm-ctx-text");
  const dot = $("#llm-ctx-dot");
  if (!text || !dot) return;
  text.textContent = `Context: ${ctx.description}`;
  dot.classList.toggle("inactive", !ctx.description || ctx.description.includes("—"));
}

async function loadMarketStatus() {
  try {
    const res = await fetch("/api/market-status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.marketStatus = await res.json();
    renderMarketStatus();
  } catch {
    const status = $("#market-status");
    status.classList.remove("open");
    status.classList.add("closed");
    $("#market-status-label").textContent = "Market Status";
    $("#market-status-time").textContent = "Unavailable";
  }
}

function renderMarketStatus() {
  const data = state.marketStatus;
  if (!data) return;
  const status = $("#market-status");
  const label = $("#market-status-label");
  const time = $("#market-status-time");
  const targetMs = Date.parse(data.target);
  const remainingMs = Math.max(0, targetMs - Date.now());

  status.classList.toggle("open", Boolean(data.is_open));
  status.classList.toggle("closed", !data.is_open);
  label.textContent = data.label;
  time.textContent = `${formatCountdown(remainingMs)} until ${data.target_label}`;

  if (remainingMs === 0) {
    loadMarketStatus();
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `${days}d ${restHours}h ${minutes}m`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initMarketStatus() {
  loadMarketStatus();
  state.marketStatusTimer = setInterval(renderMarketStatus, 1000);
  setInterval(loadMarketStatus, 5 * 60 * 1000);
}

function routeFromPath() {
  const path = location.pathname;
  if (path.startsWith("/ticker/")) return "ticker";
  const route = path.replace("/", "") || "dashboard";
  return ["dashboard", "chat", "markets", "multi", "watchlist", "screener", "option-screener", "dcf"].includes(route) ? route : "dashboard";
}

function tickerFromPath() {
  const m = location.pathname.match(/^\/ticker\/([^/]+)/);
  return m ? m[1].toUpperCase() : null;
}

function setRoute(route, replace = false) {
  state.route = route;
  $$(".page").forEach((page) => page.classList.remove("active"));
  $(`#${route}-page`).classList.add("active");
  $("#page-back-row")?.classList.toggle("hidden", route !== "ticker");
  $$(".nav a").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
  $$(".nav-group").forEach((group) => {
    const parent = group.querySelector(".nav-parent");
    if (!parent) return;
    const routes = Array.from(group.querySelectorAll("[data-route]")).map((link) => link.dataset.route);
    parent.classList.toggle("active", routes.includes(route));
  });
  if (!replace && route !== "ticker") history.pushState({}, "", `/${route}`);
  if (route !== "ticker") state.tickerBackPath = null;
  $(".results").classList.toggle("hidden", route === "dashboard" || route === "option-screener");
  if (state.llmOpen) updateLlmContextBar();
}

// ── Ticker landing page ────────────────────────────────────
function openTickerPage(ticker, name) {
  state.tickerBackPath = `${location.pathname}${location.search}`;
  state.ticker = ticker;
  state.tickerName = name || ticker;
  state.tickerMainTab = "chart";
  state.tickerView = "income_statement";
  state.tickerFinancialsData = null;
  state.tickerFinancialsAsPercent = false;
  state.compareTickers = [];

  $("#ticker-eyebrow").textContent = ticker;
  $("#ticker-heading").textContent = name || ticker;
  renderTickerWatchlistMenu();

  setTickerMainTab("chart");
  history.pushState({ tickerBackPath: state.tickerBackPath }, "", `/ticker/${ticker}`);
  setRoute("ticker", true);
  runTickerChart();
}

function goBackFromTicker() {
  if (state.tickerBackPath) {
    history.back();
    return;
  }
  setRoute("markets");
  runMarkets(state.marketsSub || "most_active");
}

function setTickerMainTab(tab) {
  state.tickerMainTab = tab;
  $$(".ticker-main-tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mainTab === tab)
  );
  $$(".ticker-view").forEach((view) => view.classList.remove("active"));
  $(`#ticker-${tab}-view`).classList.add("active");

  // Show results table only for financials tab
  $(".results").classList.toggle("hidden", tab !== "financials");
  if (state.llmOpen) updateLlmContextBar();
}

// Chart tab
async function runTickerChart() {
  const ticker = state.ticker;
  if (!ticker) return;
  const period     = state.chartPeriod   || "1mo";
  const interval   = state.chartInterval || "1d";
  const comparing  = state.compareTickers.length > 0;
  const needsInds  = !comparing && state.indicators.size > 0;

  const wrap = $("#ticker-chart-wrap");
  wrap.innerHTML = `<div class="chart-loading">Loading…</div>`;
  // Remove any previous subchart panels
  $$(".subchart-wrap").forEach((el) => el.remove());
  renderCompareTiles();

  try {
    const rows = await fetchCandleRows(ticker, period, interval, needsInds);

    if (comparing) {
      const compareSeries = await Promise.all(
        state.compareTickers.map(async (item) => ({
          ...item,
          rows: await fetchCandleRows(item.ticker, period, interval, false),
        }))
      );
      renderCompareChart(rows, wrap, compareSeries);
      return;
    }

    const activeOverlays = [...state.indicators].filter(
      (k) => INDICATOR_DEFS[k]?.group === "overlay"
    );
    const activePanels = [...state.indicators].filter(
      (k) => INDICATOR_DEFS[k]?.group === "panel"
    );

    renderCandleChart(rows, wrap, activeOverlays);

    // Append subchart panels after the main chart wrap
    const chartView = $("#ticker-chart-view");
    activePanels.forEach((key) => {
      const panel = document.createElement("div");
      panel.className = "subchart-wrap";
      const lbl = document.createElement("div");
      lbl.className = "subchart-label";
      lbl.textContent = key.toUpperCase();
      panel.appendChild(lbl);
      chartView.appendChild(panel);
      renderSubchart(rows, panel, key);
    });
  } catch (err) {
    wrap.innerHTML = `<div class="chart-empty">${escapeHtml(err.message)}</div>`;
  }
}

async function fetchCandleRows(ticker, period, interval, indicators) {
  const res = await fetch("/api/candles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker, period, interval, indicators }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.rows || [];
}

function normalizedPerformanceRows(rows) {
  const base = rows.find((row) => Number(row.close) > 0);
  if (!base) return [];
  const baseClose = Number(base.close);
  return rows.map((row) => ({
    date: String(row.date).slice(0, 10),
    value: Number(row.close) > 0 ? ((Number(row.close) / baseClose) - 1) * 100 : null,
  }));
}

function renderCompareChart(mainRows, container, compareSeries) {
  container.innerHTML = "";
  if (!mainRows.length) {
    container.innerHTML = '<div class="chart-empty">No data available.</div>';
    return;
  }

  const W = container.clientWidth || 760;
  const H = 320;
  const pL = 62, pR = 78, pT = 18, pB = 36;
  const innerH = H - pT - pB;
  const NS = "http://www.w3.org/2000/svg";

  const main = {
    ticker: state.ticker,
    name: state.ticker,
    color: "#C8FF00",
    points: normalizedPerformanceRows(mainRows),
  };
  const others = compareSeries.map((series) => {
    const byDate = new Map(normalizedPerformanceRows(series.rows).map((point) => [point.date, point.value]));
    return {
      ticker: series.ticker,
      name: series.name || series.ticker,
      color: series.color,
      points: main.points.map((point) => ({
        date: point.date,
        value: byDate.has(point.date) ? byDate.get(point.date) : null,
      })),
    };
  });
  const seriesList = [main, ...others];
  const n = main.points.length;
  const values = seriesList.flatMap((series) =>
    series.points.map((point) => point.value).filter((value) => value != null && Number.isFinite(value))
  );
  if (!values.length) {
    container.innerHTML = '<div class="chart-empty">No comparison data available.</div>';
    return;
  }

  let minV = Math.min(...values, 0);
  let maxV = Math.max(...values, 0);
  const pad = Math.max((maxV - minV) * 0.12, 1);
  minV -= pad;
  maxV += pad;
  const range = maxV - minV || 1;
  const xPos = (i) => pL + (i / Math.max(n - 1, 1)) * (W - pL - pR);
  const yPos = (value) => pT + innerH - ((value - minV) / range) * innerH;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  [0, 0.5, 1].forEach((t) => {
    const value = minV + t * range;
    const y = yPos(value);
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", pL); line.setAttribute("x2", W - pR);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#1F1F1F"); line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", pL - 5); label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#3A3734");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = `${value.toFixed(1)}%`;
    svg.appendChild(label);
  });

  const zeroY = yPos(0);
  const zero = document.createElementNS(NS, "line");
  zero.setAttribute("x1", pL); zero.setAttribute("x2", W - pR);
  zero.setAttribute("y1", zeroY); zero.setAttribute("y2", zeroY);
  zero.setAttribute("stroke", "#303030"); zero.setAttribute("stroke-width", "1");
  zero.setAttribute("stroke-dasharray", "4 3");
  svg.appendChild(zero);

  function drawSeries(series, width = 1.6) {
    let d = "";
    let drawing = false;
    series.points.forEach((point, i) => {
      if (point.value == null || !Number.isFinite(point.value)) {
        drawing = false;
        return;
      }
      d += `${drawing ? "L" : "M"}${xPos(i)},${yPos(point.value)}`;
      drawing = true;
    });
    if (!d) return;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", series.color);
    path.setAttribute("stroke-width", width);
    svg.appendChild(path);
  }

  seriesList.forEach((series, index) => drawSeries(series, index === 0 ? 1.8 : 1.4));

  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", xPos(i));
    lbl.setAttribute("y", H - pB + 16);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("fill", "#3A3734");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono, monospace");
    lbl.textContent = main.points[i]?.date || "";
    svg.appendChild(lbl);
  });

  seriesList.forEach((series, index) => {
    const y = 18 + index * 18;
    const swatch = document.createElementNS(NS, "rect");
    swatch.setAttribute("x", W - pR + 14); swatch.setAttribute("y", y - 8);
    swatch.setAttribute("width", 8); swatch.setAttribute("height", 8);
    swatch.setAttribute("fill", series.color);
    svg.appendChild(swatch);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", W - pR + 28); label.setAttribute("y", y);
    label.setAttribute("fill", "#888480");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = series.ticker;
    svg.appendChild(label);
  });

  const crossV = document.createElementNS(NS, "line");
  crossV.setAttribute("y1", pT); crossV.setAttribute("y2", H - pB);
  crossV.setAttribute("stroke", "#303030"); crossV.setAttribute("stroke-width", "1");
  crossV.setAttribute("stroke-dasharray", "3 3");
  crossV.style.display = "none";
  svg.appendChild(crossV);

  const tooltip = document.createElementNS(NS, "g");
  tooltip.style.display = "none";
  const tooltipBg = document.createElementNS(NS, "rect");
  tooltipBg.setAttribute("fill", "#181818");
  tooltipBg.setAttribute("stroke", "#303030");
  tooltipBg.setAttribute("stroke-width", "1");
  tooltip.appendChild(tooltipBg);
  const tooltipTxt = document.createElementNS(NS, "text");
  tooltipTxt.setAttribute("font-size", "10");
  tooltipTxt.setAttribute("font-family", "JetBrains Mono, monospace");
  tooltipTxt.setAttribute("fill", "#EDEAE2");
  tooltip.appendChild(tooltipTxt);
  svg.appendChild(tooltip);

  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * (W / rect.width);
    const rawI = ((mx - pL) / (W - pL - pR)) * (n - 1);
    const i = Math.max(0, Math.min(n - 1, Math.round(rawI)));
    const x = xPos(i);
    crossV.setAttribute("x1", x); crossV.setAttribute("x2", x);
    crossV.style.display = "";

    const rows = [`${main.points[i]?.date || ""}`];
    seriesList.forEach((series) => {
      const value = series.points[i]?.value;
      rows.push(`${series.ticker}: ${value == null ? "n/a" : `${value.toFixed(2)}%`}`);
    });
    tooltipTxt.innerHTML = "";
    rows.forEach((text, rowIndex) => {
      const tspan = document.createElementNS(NS, "tspan");
      tspan.setAttribute("x", 0);
      tspan.setAttribute("dy", rowIndex === 0 ? "0" : "13");
      tspan.textContent = text;
      tooltipTxt.appendChild(tspan);
    });
    const tw = Math.max(...rows.map((row) => row.length)) * 6.4 + 14;
    const th = rows.length * 13 + 8;
    const tx = Math.min(x + 8, W - pR - tw - 4);
    tooltipBg.setAttribute("x", tx); tooltipBg.setAttribute("y", pT);
    tooltipBg.setAttribute("width", tw); tooltipBg.setAttribute("height", th);
    tooltipTxt.setAttribute("x", tx + 7); tooltipTxt.setAttribute("y", pT + 13);
    tooltip.querySelectorAll("tspan").forEach((tspan) => tspan.setAttribute("x", tx + 7));
    tooltip.style.display = "";
  });

  svg.addEventListener("mouseleave", () => {
    crossV.style.display = "none";
    tooltip.style.display = "none";
  });

  container.appendChild(svg);
}

function renderCandleChart(rows, container, activeOverlays = []) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="chart-empty">No data available.</div>';
    return;
  }

  const W = container.clientWidth || 760;
  const H = 300;
  const pL = 62, pR = 18, pT = 16, pB = 36, volH = 44;
  const priceH = H - pT - pB - volH - 6;
  const n = rows.length;

  const closes  = rows.map((r) => Number(r.close));
  const volumes = rows.map((r) => Number(r.volume));

  // Expand price range to include any active overlay values so lines stay in-bounds
  const OVERLAY_COLS = { sma_20: 1, sma_50: 1, sma_200: 1, ema_12: 1, ema_26: 1,
                         bb_upper: 1, bb_middle: 1, bb_lower: 1 };
  let allPrices = [...closes];
  if (activeOverlays.length) {
    const cols = activeOverlays.includes("bb")
      ? activeOverlays.filter((k) => k !== "bb").concat(["bb_upper", "bb_lower"])
      : activeOverlays;
    cols.forEach((col) => {
      if (rows[0]?.[col] !== undefined) {
        rows.forEach((r) => {
          const v = Number(r[col]);
          if (!isNaN(v) && v > 0) allPrices.push(v);
        });
      }
    });
  }
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
  const rangeP = maxP - minP || 1;
  const maxV = Math.max(...volumes) || 1;

  const xPos  = (i) => pL + (i / Math.max(n - 1, 1)) * (W - pL - pR);
  const yPrice = (p) => pT + priceH - ((p - minP) / rangeP) * priceH;
  const yVolBase = H - pB;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  // Defs: area gradient
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `
    <linearGradient id="cag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#C8FF00" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#C8FF00" stop-opacity="0.01"/>
    </linearGradient>`;
  svg.appendChild(defs);

  // Horizontal gridlines (3 levels)
  [0, 0.5, 1].forEach((t) => {
    const price = minP + t * rangeP;
    const y = yPrice(price);
    const g = document.createElementNS(NS, "line");
    g.setAttribute("x1", pL); g.setAttribute("x2", W - pR);
    g.setAttribute("y1", y);  g.setAttribute("y2", y);
    g.setAttribute("stroke", "#1F1F1F"); g.setAttribute("stroke-width", "1");
    svg.appendChild(g);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", pL - 5); label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#3A3734");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = price.toFixed(2);
    svg.appendChild(label);
  });

  // Volume bars
  const barW = Math.max(1, (W - pL - pR) / n - 1);
  rows.forEach((r, i) => {
    const bh = (Number(r.volume) / maxV) * volH;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", xPos(i) - barW / 2);
    rect.setAttribute("y", yVolBase - bh);
    rect.setAttribute("width", barW);
    rect.setAttribute("height", bh);
    rect.setAttribute("fill", "#252525");
    svg.appendChild(rect);
  });

  // Area fill
  const pts = rows.map((r, i) => `${xPos(i)},${yPrice(Number(r.close))}`);
  const lineD = "M" + pts.join("L");
  const area = document.createElementNS(NS, "path");
  area.setAttribute("d", `${lineD}L${xPos(n - 1)},${pT + priceH}L${pL},${pT + priceH}Z`);
  area.setAttribute("fill", "url(#cag)");
  svg.appendChild(area);

  // ── Overlay lines ──────────────────────────────────────────
  function makePath(col, color, width = 1.2, dash = "") {
    const pts = rows
      .map((r, i) => {
        const v = Number(r[col]);
        return !isNaN(v) && v > 0 ? `${xPos(i)},${yPrice(v)}` : null;
      })
      .filter(Boolean);
    if (pts.length < 2) return;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.join("L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width);
    if (dash) p.setAttribute("stroke-dasharray", dash);
    svg.appendChild(p);
  }

  if (activeOverlays.includes("bb") && rows[0]?.bb_upper !== undefined) {
    // BB fill between upper and lower
    const upperPts = rows.map((r, i) => `${xPos(i)},${yPrice(Number(r.bb_upper))}`);
    const lowerPts = [...rows].reverse().map((r, i) =>
      `${xPos(n - 1 - i)},${yPrice(Number(r.bb_lower))}`
    );
    const fill = document.createElementNS(NS, "path");
    fill.setAttribute("d", "M" + upperPts.join("L") + "L" + lowerPts.join("L") + "Z");
    fill.setAttribute("fill", "rgba(179,136,255,0.07)");
    fill.setAttribute("stroke", "none");
    svg.appendChild(fill);
    makePath("bb_upper",  "#B388FF", 1.0, "4 3");
    makePath("bb_lower",  "#B388FF", 1.0, "4 3");
    makePath("bb_middle", "#B388FF", 0.8);
  }

  const SIMPLE_OVERLAYS = [
    ["sma_20",  "#4FC3F7"],
    ["sma_50",  "#FFB800"],
    ["sma_200", "#FF4B4B"],
    ["ema_12",  "#00E5A0"],
    ["ema_26",  "#FF8A65"],
  ];
  SIMPLE_OVERLAYS.forEach(([col, color]) => {
    if (activeOverlays.includes(col)) makePath(col, color);
  });

  // Price line
  const line = document.createElementNS(NS, "path");
  line.setAttribute("d", lineD);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#C8FF00");
  line.setAttribute("stroke-width", "1.5");
  svg.appendChild(line);

  // Date labels: first, mid, last
  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", xPos(i));
    lbl.setAttribute("y", H - pB + 14);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("fill", "#3A3734");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono, monospace");
    lbl.textContent = String(rows[i].date).slice(0, 10);
    svg.appendChild(lbl);
  });

  // Current price tag
  const lastClose = closes[n - 1];
  const tagY = yPrice(lastClose);
  const tag = document.createElementNS(NS, "rect");
  tag.setAttribute("x", W - pR - 58); tag.setAttribute("y", tagY - 9);
  tag.setAttribute("width", 56); tag.setAttribute("height", 17);
  tag.setAttribute("fill", "#C8FF00");
  svg.appendChild(tag);
  const tagTxt = document.createElementNS(NS, "text");
  tagTxt.setAttribute("x", W - pR - 30); tagTxt.setAttribute("y", tagY + 4);
  tagTxt.setAttribute("text-anchor", "middle");
  tagTxt.setAttribute("fill", "#000");
  tagTxt.setAttribute("font-size", "10");
  tagTxt.setAttribute("font-family", "Syne, sans-serif");
  tagTxt.setAttribute("font-weight", "700");
  tagTxt.textContent = lastClose.toFixed(2);
  svg.appendChild(tagTxt);

  // Hover crosshair + tooltip
  const crossV = document.createElementNS(NS, "line");
  crossV.setAttribute("y1", pT); crossV.setAttribute("y2", H - pB);
  crossV.setAttribute("stroke", "#303030"); crossV.setAttribute("stroke-width", "1");
  crossV.setAttribute("stroke-dasharray", "3 3");
  crossV.style.display = "none";
  svg.appendChild(crossV);

  const tooltip = document.createElementNS(NS, "g");
  tooltip.style.display = "none";
  const tooltipBg = document.createElementNS(NS, "rect");
  tooltipBg.setAttribute("rx", "0");
  tooltipBg.setAttribute("fill", "#181818");
  tooltipBg.setAttribute("stroke", "#303030");
  tooltipBg.setAttribute("stroke-width", "1");
  const tooltipTxt = document.createElementNS(NS, "text");
  tooltipTxt.setAttribute("font-size", "11");
  tooltipTxt.setAttribute("font-family", "JetBrains Mono, monospace");
  tooltipTxt.setAttribute("fill", "#EDEAE2");
  tooltip.appendChild(tooltipBg);
  tooltip.appendChild(tooltipTxt);
  svg.appendChild(tooltip);

  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const rawI = ((mx - pL) / (W - pL - pR)) * (n - 1);
    const i = Math.max(0, Math.min(n - 1, Math.round(rawI)));
    const x = xPos(i);
    const row = rows[i];
    const price = Number(row.close);

    crossV.setAttribute("x1", x); crossV.setAttribute("x2", x);
    crossV.style.display = "";

    const txt = `${String(row.date).slice(0, 10)}  ${price.toFixed(2)}`;
    tooltipTxt.textContent = txt;
    const tw = txt.length * 7 + 12;
    const th = 20;
    const tx = Math.min(x + 8, W - pR - tw - 4);
    tooltipBg.setAttribute("x", tx); tooltipBg.setAttribute("y", pT);
    tooltipBg.setAttribute("width", tw); tooltipBg.setAttribute("height", th);
    tooltipTxt.setAttribute("x", tx + 6); tooltipTxt.setAttribute("y", pT + 13);
    tooltip.style.display = "";
  });

  svg.addEventListener("mouseleave", () => {
    crossV.style.display = "none";
    tooltip.style.display = "none";
  });

  container.appendChild(svg);
}

// ── Subchart panels (MACD / RSI / ATR) ────────────────────
function renderSubchart(rows, container, type) {
  const NS = "http://www.w3.org/2000/svg";
  const W = container.clientWidth || 760;
  const H = 90;
  const pL = 62, pR = 18, pT = 8, pB = 18;
  const innerH = H - pT - pB;
  const n = rows.length;
  const xPos = (i) => pL + (i / Math.max(n - 1, 1)) * (W - pL - pR);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  function yScale(val, minV, maxV) {
    const r = maxV - minV || 1;
    return pT + innerH - ((val - minV) / r) * innerH;
  }

  function hline(y, color = "#1F1F1F", dash = "") {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", pL); l.setAttribute("x2", W - pR);
    l.setAttribute("y1", y);  l.setAttribute("y2", y);
    l.setAttribute("stroke", color); l.setAttribute("stroke-width", "1");
    if (dash) l.setAttribute("stroke-dasharray", dash);
    svg.appendChild(l);
  }

  function pathFrom(vals, minV, maxV, color, width = 1.2) {
    const pts = vals.map((v, i) =>
      v != null && !isNaN(v) ? `${xPos(i)},${yScale(v, minV, maxV)}` : null
    ).filter(Boolean);
    if (pts.length < 2) return;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.join("L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width);
    svg.appendChild(p);
  }

  function axisLabel(text, y) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", pL - 5); t.setAttribute("y", y + 4);
    t.setAttribute("text-anchor", "end");
    t.setAttribute("fill", "#3A3734");
    t.setAttribute("font-size", "9");
    t.setAttribute("font-family", "JetBrains Mono, monospace");
    t.textContent = text;
    svg.appendChild(t);
  }

  // Right-side value tag — mirrors the main chart's current-price pip
  function valueTag(val, y, color) {
    const text = typeof val === "number" ? val.toFixed(Math.abs(val) < 10 ? 3 : 2) : String(val);
    const tw = Math.max(38, text.length * 6.2 + 8);
    const th = 14;
    const tx = W - pR - tw + 2;
    // Dashed reference line to the tag
    const ref = document.createElementNS(NS, "line");
    ref.setAttribute("x1", pL); ref.setAttribute("x2", tx);
    ref.setAttribute("y1", y);  ref.setAttribute("y2", y);
    ref.setAttribute("stroke", color);
    ref.setAttribute("stroke-width", "0.5");
    ref.setAttribute("stroke-dasharray", "3 3");
    ref.setAttribute("opacity", "0.5");
    svg.appendChild(ref);
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", tx);        bg.setAttribute("y", y - th / 2);
    bg.setAttribute("width", tw);    bg.setAttribute("height", th);
    bg.setAttribute("fill", color);
    svg.appendChild(bg);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", tx + tw / 2); t.setAttribute("y", y + 4);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#000");
    t.setAttribute("font-size", "9");
    t.setAttribute("font-family", "JetBrains Mono, monospace");
    t.setAttribute("font-weight", "700");
    t.textContent = text;
    svg.appendChild(t);
  }

  function lastValid(vals) {
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i] != null && !isNaN(vals[i])) return vals[i];
    }
    return null;
  }

  if (type === "macd") {
    const macd  = rows.map((r) => r.macd       != null ? Number(r.macd)       : null);
    const sig   = rows.map((r) => r.macd_signal != null ? Number(r.macd_signal) : null);
    const hist  = rows.map((r) => r.macd_histogram != null ? Number(r.macd_histogram) : null);
    const allV  = [...macd, ...sig, ...hist].filter((v) => v != null);
    const minV  = Math.min(...allV), maxV = Math.max(...allV);
    const zeroY = yScale(0, minV, maxV);

    hline(zeroY, "#252525");
    axisLabel("0", zeroY);

    // Histogram bars
    const barW = Math.max(1, (W - pL - pR) / n - 1);
    hist.forEach((v, i) => {
      if (v == null) return;
      const y1 = yScale(v, minV, maxV);
      const y2 = zeroY;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", xPos(i) - barW / 2);
      rect.setAttribute("y", Math.min(y1, y2));
      rect.setAttribute("width", barW);
      rect.setAttribute("height", Math.abs(y2 - y1) || 1);
      rect.setAttribute("fill", v >= 0 ? "rgba(0,229,160,0.45)" : "rgba(255,75,75,0.45)");
      svg.appendChild(rect);
    });

    pathFrom(sig,  minV, maxV, "#FF8A65", 1.2);
    pathFrom(macd, minV, maxV, "#4FC3F7", 1.4);

    const lastMacd = lastValid(macd);
    const lastSig  = lastValid(sig);
    if (lastSig  != null) valueTag(lastSig,  yScale(lastSig,  minV, maxV), "#FF8A65");
    if (lastMacd != null) valueTag(lastMacd, yScale(lastMacd, minV, maxV), "#4FC3F7");

  } else if (type === "rsi") {
    const rsi = rows.map((r) => r.rsi != null ? Number(r.rsi) : null);
    const minV = 0, maxV = 100;

    hline(yScale(70, minV, maxV), "#252525", "3 3");
    hline(yScale(50, minV, maxV), "#1F1F1F");
    hline(yScale(30, minV, maxV), "#252525", "3 3");
    axisLabel("70", yScale(70, minV, maxV));
    axisLabel("30", yScale(30, minV, maxV));

    // Color RSI line by zone
    let segStart = null, segColor = null;
    function flushSeg(endI) {
      if (segStart == null) return;
      const pts = [];
      for (let k = segStart; k <= endI; k++) {
        if (rsi[k] == null) continue;
        pts.push(`${xPos(k)},${yScale(rsi[k], minV, maxV)}`);
      }
      if (pts.length < 2) return;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", "M" + pts.join("L"));
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", segColor);
      p.setAttribute("stroke-width", "1.4");
      svg.appendChild(p);
    }
    rsi.forEach((v, i) => {
      const c = v >= 70 ? "#FF4B4B" : v <= 30 ? "#00E5A0" : "#C8FF00";
      if (c !== segColor) { flushSeg(i - 1); segStart = i; segColor = c; }
    });
    flushSeg(n - 1);

    const lastRsi = lastValid(rsi);
    if (lastRsi != null) {
      const rsiColor = lastRsi >= 70 ? "#FF4B4B" : lastRsi <= 30 ? "#00E5A0" : "#C8FF00";
      valueTag(lastRsi, yScale(lastRsi, minV, maxV), rsiColor);
    }

  } else if (type === "atr") {
    const atr = rows.map((r) => r.atr != null ? Number(r.atr) : null);
    const allV = atr.filter((v) => v != null);
    const minV = 0, maxV = Math.max(...allV) || 1;

    hline(yScale(maxV, minV, maxV), "#1F1F1F");
    axisLabel(maxV.toFixed(2), yScale(maxV, minV, maxV));

    pathFrom(atr, minV, maxV, "#FFB800", 1.4);

    const lastAtr = lastValid(atr);
    if (lastAtr != null) valueTag(lastAtr, yScale(lastAtr, minV, maxV), "#FFB800");
  }

  container.appendChild(svg);
}

// ── Indicator chip wiring ──────────────────────────────────
function bindIndicatorChips() {
  $$(".ind-chip").forEach((chip) => {
    const key   = chip.dataset.indicator;
    const color = chip.dataset.color;
    chip.style.setProperty("--ind-color", color);
    chip.addEventListener("click", () => {
      if (state.indicators.has(key)) {
        state.indicators.delete(key);
        chip.classList.remove("active");
      } else {
        state.indicators.add(key);
        chip.classList.add("active");
      }
      runTickerChart();
    });
  });
}

function clearIndicators() {
  state.indicators.clear();
  $$(".ind-chip").forEach((chip) => chip.classList.remove("active"));
}

function renderCompareTiles() {
  const bar = $("#compare-tile-bar");
  const indicatorBar = $("#indicator-bar");
  if (!bar || !indicatorBar) return;
  const comparing = state.compareTickers.length > 0;
  bar.classList.toggle("hidden", !comparing);
  indicatorBar.classList.toggle("hidden", comparing);

  bar.innerHTML = state.compareTickers.map((item) => `
    <div class="compare-tile" style="--compare-color: ${item.color}">
      <span>${escapeHtml(item.ticker)}</span>
      <button type="button" data-compare-remove="${escapeHtml(item.ticker)}" aria-label="Remove ${escapeHtml(item.ticker)}">×</button>
    </div>
  `).join("");
  $$("[data-compare-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeCompareTicker(btn.dataset.compareRemove);
    });
  });
}

function addCompareTicker(ticker, name) {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol || symbol === state.ticker) return;
  if (state.compareTickers.some((item) => item.ticker === symbol)) return;
  const color = COMPARE_COLORS[state.compareTickers.length % COMPARE_COLORS.length];
  state.compareTickers.push({ ticker: symbol, name: name || symbol, color });
  clearIndicators();
  closeCompareModal();
  renderCompareTiles();
  runTickerChart();
}

function removeCompareTicker(ticker) {
  state.compareTickers = state.compareTickers.filter((item) => item.ticker !== ticker);
  renderCompareTiles();
  runTickerChart();
}

function openCompareModal() {
  $("#compare-modal").classList.remove("hidden");
  $("#compare-search-input").value = "";
  $("#compare-search-dropdown").innerHTML = "";
  $("#compare-search-dropdown").classList.remove("open");
  $("#compare-search-input").focus();
}

function closeCompareModal() {
  $("#compare-modal").classList.add("hidden");
}

function bindCompareControls() {
  $("#chart-compare-btn").addEventListener("click", openCompareModal);
  $("#compare-modal-close").addEventListener("click", closeCompareModal);
  $("#compare-modal").addEventListener("click", (event) => {
    if (event.target.id === "compare-modal") closeCompareModal();
  });

  const input = $("#compare-search-input");
  const dropdown = $("#compare-search-dropdown");
  let debounceTimer = null;

  function renderResults(results) {
    dropdown.innerHTML = "";
    if (!results.length) {
      dropdown.innerHTML = `<li class="search-empty">No matches</li>`;
      dropdown.classList.add("open");
      return;
    }
    results
      .filter((item) => item.ticker !== state.ticker)
      .filter((item) => !state.compareTickers.some((compare) => compare.ticker === item.ticker))
      .forEach((item) => {
        const li = document.createElement("li");
        li.className = "search-item";
        li.innerHTML = `
          <span class="search-item-ticker">${escapeHtml(item.ticker)}</span>
          <span class="search-item-name">${escapeHtml(item.name || "")}</span>
        `;
        li.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addCompareTicker(item.ticker, item.name);
        });
        dropdown.appendChild(li);
      });
    dropdown.classList.toggle("open", dropdown.children.length > 0);
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < 1) {
      dropdown.classList.remove("open");
      dropdown.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        renderResults(await res.json());
      } catch {
        dropdown.innerHTML = `<li class="search-empty">Search failed</li>`;
        dropdown.classList.add("open");
      }
    }, 150);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCompareModal();
    if (event.key === "Enter") {
      event.preventDefault();
      const first = dropdown.querySelector(".search-item");
      if (!first) return;
      addCompareTicker(
        first.querySelector(".search-item-ticker").textContent,
        first.querySelector(".search-item-name").textContent
      );
    }
  });
}

function bindTickerPage() {
  $("#ticker-watchlist-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTickerWatchlistMenu();
  });
  document.addEventListener("click", (event) => {
    const picker = $("#ticker-watchlist-picker");
    if (picker && !picker.contains(event.target)) closeTickerWatchlistMenu();
  });
  // Main tab switching
  $$(".ticker-main-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.mainTab;
      setTickerMainTab(tab);
      if (tab === "chart") runTickerChart();
      if (tab === "financials") runTickerFinancials();
      if (tab === "options") runTickerOptions();
      if (tab === "info") runTickerInfo();
      if (tab === "insider") runTickerInsider();
    });
  });

  // Chart range buttons
  $$(".chart-range").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".chart-range").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartPeriod   = btn.dataset.period;
      state.chartInterval = btn.dataset.interval;
      runTickerChart();
    });
  });

  $("#ticker-options-fetch-dte")?.addEventListener("change", () => {
    if (state.route === "ticker" && state.tickerMainTab === "options") runTickerOptions();
  });

  bindTickerFinancialsControls();
}

function formValue(form, name) {
  const field = form.elements[name];
  if (!field) return null;
  if (field.type === "checkbox") return field.checked;
  return field.value;
}

function addFilter(metric = "pe_ratio", op = "<", value = 30) {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.innerHTML = `
    <select data-filter="metric">${state.metrics.map((m) => `<option value="${m}">${m}</option>`).join("")}</select>
    <select data-filter="op">
      ${["<", "<=", ">", ">=", "==", "!="].map((item) => `<option value="${item}">${item}</option>`).join("")}
    </select>
    <input data-filter="value" type="number" step="0.01" />
    <button type="button" aria-label="Remove filter">×</button>
  `;
  row.querySelector('[data-filter="metric"]').value = metric;
  row.querySelector('[data-filter="op"]').value = op;
  row.querySelector('[data-filter="value"]').value = value;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("#filter-list").appendChild(row);
}

function collectFilters() {
  return $$(".filter-row").map((row) => ({
    metric: row.querySelector('[data-filter="metric"]').value,
    op: row.querySelector('[data-filter="op"]').value,
    value: row.querySelector('[data-filter="value"]').value,
    enabled: true,
  }));
}

function selectedOptions(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function loadWatchlists() {
  try {
    state.watchlists = JSON.parse(localStorage.getItem("secrs.watchlists") || "[]");
  } catch {
    state.watchlists = [];
  }
  renderTickerWatchlistMenu();
  renderOptionScreenerWatchlists();
}

function saveWatchlists() {
  localStorage.setItem("secrs.watchlists", JSON.stringify(state.watchlists));
  renderTickerWatchlistMenu();
  renderOptionScreenerWatchlists();
}

function renderWatchlists() {
  const target = $("#watchlists");
  if (!target) return;
  target.innerHTML = "";

  if (state.watchlists.length === 0) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent = "No watchlists yet.";
    target.appendChild(empty);
    return;
  }

  state.watchlists.forEach((watchlist) => {
    const item = document.createElement("article");
    item.className = "watchlist-item";
    const expanded = state.expandedWatchlists.has(watchlist.id);
    const tickers = expanded ? watchlist.tickers : watchlist.tickers.slice(0, 80);
    const hiddenCount = Math.max(watchlist.tickers.length - tickers.length, 0);
    const toggleLabel = expanded ? "Condense" : "Expand";
    item.innerHTML = `
      <div>
        <p class="eyebrow">${watchlist.tickers.length} tickers</p>
        <h2>${escapeHtml(watchlist.name)}</h2>
        <p class="watchlist-tickers ${expanded ? "expanded" : "condensed"}">
          ${escapeHtml(tickers.join(", "))}
          ${hiddenCount ? `<span> + ${hiddenCount} more</span>` : ""}
        </p>
      </div>
      <div class="watchlist-actions">
        <button class="secondary" type="button" data-action="toggle">${toggleLabel}</button>
        <button type="button" data-action="multi">Multi</button>
        <button type="button" data-action="screener">Screener</button>
        <button type="button" data-action="dcf">DCF</button>
        <button class="secondary" type="button" data-action="edit">Edit</button>
        <button class="danger" type="button" data-action="delete">Delete</button>
      </div>
    `;
    item.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleWatchlist(watchlist.id));
    item.querySelector('[data-action="multi"]').addEventListener("click", () => applyWatchlist(watchlist, "multi"));
    item.querySelector('[data-action="screener"]').addEventListener("click", () => applyWatchlist(watchlist, "screener"));
    item.querySelector('[data-action="dcf"]').addEventListener("click", () => applyWatchlist(watchlist, "dcf"));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => editWatchlist(watchlist.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteWatchlist(watchlist.id));
    target.appendChild(item);
  });
}

function renderTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  if (!menu) return;

  const ticker = state.ticker;
  if (!ticker) {
    menu.innerHTML = `<div class="ticker-watchlist-empty">Select a ticker first.</div>`;
    return;
  }

  if (state.watchlists.length === 0) {
    menu.innerHTML = `<div class="ticker-watchlist-empty">No watchlists yet.</div>`;
    return;
  }

  menu.innerHTML = "";
  state.watchlists.forEach((watchlist) => {
    const exists = Array.isArray(watchlist.tickers) && watchlist.tickers.includes(ticker);
    const item = document.createElement("button");
    item.className = "ticker-watchlist-item";
    item.type = "button";
    item.disabled = exists;
    item.innerHTML = `
      <span class="ticker-watchlist-name">${escapeHtml(watchlist.name)}</span>
      <span class="ticker-watchlist-check">${exists ? "✓" : ""}</span>
    `;
    if (!exists) {
      item.addEventListener("click", () => {
        addTickerToWatchlist(watchlist.id, ticker);
        closeTickerWatchlistMenu();
      });
    }
    menu.appendChild(item);
  });
}

function addTickerToWatchlist(id, ticker) {
  const watchlist = state.watchlists.find((item) => item.id === id);
  if (!watchlist) return;
  const current = Array.isArray(watchlist.tickers) ? watchlist.tickers : [];
  const cleaned = uniqueTickers([...current, ticker]);
  if (cleaned.length === current.length) return;
  watchlist.tickers = cleaned;
  saveWatchlists();
  renderWatchlists();
  setStatus(`${ticker} added to ${watchlist.name}.`, false);
}

function openTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  const btn = $("#ticker-watchlist-btn");
  if (!menu || !btn) return;
  renderTickerWatchlistMenu();
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
}

function closeTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  const btn = $("#ticker-watchlist-btn");
  if (!menu || !btn) return;
  menu.classList.add("hidden");
  btn.setAttribute("aria-expanded", "false");
}

function toggleTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  if (!menu) return;
  if (menu.classList.contains("hidden")) openTickerWatchlistMenu();
  else closeTickerWatchlistMenu();
}

function toggleWatchlist(id) {
  if (state.expandedWatchlists.has(id)) {
    state.expandedWatchlists.delete(id);
  } else {
    state.expandedWatchlists.add(id);
  }
  renderWatchlists();
}

function upsertWatchlist(name, tickers) {
  const cleaned = uniqueTickers(tickers);
  if (!name.trim()) throw new Error("Enter a watchlist name.");
  if (cleaned.length === 0) throw new Error("Enter at least one ticker.");

  if (state.editingWatchlist) {
    const existing = state.watchlists.find((item) => item.id === state.editingWatchlist);
    if (existing) {
      existing.name = name.trim();
      existing.tickers = cleaned;
    }
  } else {
    state.watchlists.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      name: name.trim(),
      tickers: cleaned,
    });
  }
  state.editingWatchlist = null;
  saveWatchlists();
  renderWatchlists();
}

function editWatchlist(id) {
  const watchlist = state.watchlists.find((item) => item.id === id);
  if (!watchlist) return;
  state.editingWatchlist = id;
  const form = $("#watchlist-form");
  form.elements.name.value = watchlist.name;
  form.elements.manual_tickers.value = watchlist.tickers.join(", ");
  setRoute("watchlist");
}

function deleteWatchlist(id) {
  state.watchlists = state.watchlists.filter((item) => item.id !== id);
  if (state.editingWatchlist === id) state.editingWatchlist = null;
  saveWatchlists();
  renderWatchlists();
}

function applyWatchlist(watchlist, route) {
  const tickers = watchlist.tickers.join(", ");
  if (route === "multi") $("#multi-form").elements.tickers.value = tickers;
  if (route === "screener") $("#screener-form").elements.tickers.value = tickers;
  if (route === "dcf") {
    $("#dcf-form").elements.tickers.value = tickers;
    $("#dcf-form").elements.compare.checked = watchlist.tickers.length > 1;
  }
  setRoute(route);
}

async function loadOptions() {
  const response = await fetch("/api/options");
  const options = await response.json();
  state.metrics = options.metrics;
  const include = $("#include-metrics");
  include.innerHTML = state.metrics.map((metric) => `<option value="${metric}">${metric}</option>`).join("");
  options.default_filters.forEach((item) => addFilter(item.metric, item.op, item.value));
}

function bindForms() {
  $("#multi-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/multi", {
        tickers: tickerList(formValue(form, "tickers")),
        analysis: formValue(form, "analysis"),
        quarterly: formValue(form, "quarterly") === "true",
      });
      $("#result-title").textContent = data.title;
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#screener-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/screener", {
        tickers: tickerList(formValue(form, "tickers")),
        quarterly: formValue(form, "quarterly") === "true",
        max_workers: formValue(form, "max_workers"),
        filters: collectFilters(),
        include_metrics: selectedOptions($("#include-metrics")),
      });
      $("#result-title").textContent = data.title;
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#dcf-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/dcf", {
        tickers: tickerList(formValue(form, "tickers")),
        forecast_years: formValue(form, "forecast_years"),
        discount_rate: formValue(form, "discount_rate"),
        terminal_growth_rate: formValue(form, "terminal_growth_rate"),
        growth_rate: formValue(form, "growth_rate"),
        max_growth_rate: formValue(form, "max_growth_rate"),
        auto: formValue(form, "auto"),
        compare: formValue(form, "compare"),
        max_workers: formValue(form, "max_workers"),
      });
      $("#result-title").textContent = data.title;
      renderSummary(data.summary);
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#watchlist-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      upsertWatchlist(formValue(form, "name"), formValue(form, "manual_tickers"));
      form.elements.name.value = "";
      form.elements.manual_tickers.value = "";
      setStatus("Watchlist saved.", false);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#csv-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.csv_file.files[0];
    if (!file) {
      setStatus("Choose a CSV file.", true);
      return;
    }
    try {
      const content = await file.text();
      const data = await post("/api/watchlist/csv", {
        content,
        ticker_column: formValue(form, "ticker_column"),
      });
      $("#watchlist-form").elements.name.value = file.name.replace(/\.csv$/i, "");
      $("#watchlist-form").elements.manual_tickers.value = data.tickers.join(", ");
      $("#result-title").textContent = "CSV Import";
      renderTable({
        columns: ["ticker"],
        rows: data.tickers.map((ticker) => ({ ticker })),
        height: data.tickers.length,
        width: 1,
      });
      setStatus(`Imported ${data.count} tickers from ${data.ticker_column}. Save the watchlist when ready.`, false);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#add-filter").addEventListener("click", () => addFilter("pe_ratio", "<", 30));
  $("#new-watchlist").addEventListener("click", () => {
    state.editingWatchlist = null;
    $("#watchlist-form").elements.name.value = "";
    $("#watchlist-form").elements.manual_tickers.value = "";
  });
  $$("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const example = button.dataset.example;
      if (example === "multi") $("#multi-form").requestSubmit();
      if (example === "dcf") {
        $("#dcf-form").elements.tickers.value = "AAPL, MSFT, GOOGL";
        $("#dcf-form").elements.compare.checked = true;
        $("#dcf-form").requestSubmit();
      }
    });
  });
}

function openDashboardMarket(sub) {
  setRoute("markets");
  runMarkets(sub);
}

function bindNavigation() {
  $$("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setRoute(link.dataset.route);
      if (link.dataset.route === "dashboard") runDashboard();
      if (link.dataset.route === "markets") runMarkets(state.marketsSub || "most_active");
      if (link.dataset.route === "chat") initChat();
    });
  });
  $("#page-back-btn").addEventListener("click", goBackFromTicker);
}

function appendLlmMessage(role, content, streaming = false) {
  const msgs = $("#llm-messages");
  const div = document.createElement("div");
  div.className = `llm-msg ${role}`;
  const roleEl = document.createElement("span");
  roleEl.className = "llm-msg-role";
  roleEl.textContent = role === "user" ? "You" : role === "error" ? "Error" : "LLM";
  const bubble = document.createElement("div");
  bubble.className = "llm-msg-bubble";
  if (streaming || role !== "assistant") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
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
    res.body.cancel();
    bubble.parentElement.remove();
    appendLlmMessage("error", `⚠ LLM server returned HTTP ${res.status}. Check Settings.`);
    return "";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break outer;
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

  reader.cancel();
  const cursor = bubble.querySelector(".llm-cursor");
  if (cursor) cursor.remove();
  bubble.innerHTML = renderMarkdown(content);
  $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;
  return content;
}

async function sendLlmMessage() {
  const textarea = $("#llm-textarea");
  const userText = textarea.value.trim();
  if (!userText || state.llmStreaming) return;

  state.llmStreaming = true;
  textarea.value = "";
  textarea.style.height = "34px";
  $("#llm-send").disabled = true;

  state.llmHistory.push({ role: "user", content: userText });
  const userBubble = appendLlmMessage("user", userText);

  if (state.llmHistory.length > LLM_HISTORY_MAX) {
    state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
  }

  const systemMsg = { role: "system", content: buildSystemPrompt() };
  let apiHistory = state.llmHistory;
  if (state.llmWebSearch) {
    const webCtx = await fetchWebContext(userText);
    if (webCtx) {
      apiHistory = [...state.llmHistory.slice(0, -1), { role: "user", content: `${webCtx}\n\n---\n\n${userText}` }];
      userBubble?.closest(".llm-msg")?.classList.add("web-search");
    }
  }
  const messages = [systemMsg, ...apiHistory];

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

  // Send button
  $("#llm-send").addEventListener("click", sendLlmMessage);

  // Web search toggle
  $("#llm-web-toggle")?.addEventListener("click", () => {
    state.llmWebSearch = !state.llmWebSearch;
    const btn = $("#llm-web-toggle");
    btn.classList.toggle("active", state.llmWebSearch);
    btn.setAttribute("aria-pressed", String(state.llmWebSearch));
  });

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

  // Restore saved sidebar width
  const savedWidth = localStorage.getItem("llm-sidebar-width");
  if (savedWidth) $("#llm-sidebar").style.width = savedWidth + "px";

  // Drag-to-resize handle
  const handle = $("#llm-resize-handle");
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const sidebar = $("#llm-sidebar");
    const onMove = (ev) => {
      const w = Math.min(700, Math.max(220, window.innerWidth - ev.clientX));
      sidebar.style.width = w + "px";
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      localStorage.setItem("llm-sidebar-width", parseInt($("#llm-sidebar").style.width));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

loadOptions().then(() => {
  loadWatchlists();
  bindNavigation();
  bindForms();
  bindOptionScreener();
  bindDashboard();
  bindMarkets();
  bindTickerPage();
  bindIndicatorChips();
  bindCompareControls();
  bindLlmSidebar();
  bindChat();
  initSearch();
  initMarketStatus();
  renderWatchlists();

  const route = routeFromPath();
  if (route === "ticker") {
    const ticker = tickerFromPath();
    if (ticker) {
      state.ticker = ticker;
      state.tickerName = ticker;
      $("#ticker-eyebrow").textContent = ticker;
      $("#ticker-heading").textContent = ticker;
      renderTickerWatchlistMenu();
      setTickerMainTab("chart");
      setRoute("ticker", true);
      runTickerChart();
    } else {
      setRoute("dashboard", true);
      runDashboard();
    }
  } else {
    setRoute(route, true);
    if (route === "dashboard") runDashboard();
    if (route === "markets") runMarkets("most_active");
    if (route === "chat") initChat();
  }

  window.addEventListener("popstate", (event) => {
    const r = routeFromPath();
    if (r === "ticker") {
      const ticker = tickerFromPath();
      if (ticker) {
        state.tickerBackPath = event.state?.tickerBackPath || null;
        state.ticker = ticker;
        $("#ticker-eyebrow").textContent = ticker;
        $("#ticker-heading").textContent = ticker;
        renderTickerWatchlistMenu();
        setTickerMainTab(state.tickerMainTab || "chart");
        setRoute("ticker", true);
        if (state.tickerMainTab === "financials") runTickerFinancials();
        else if (state.tickerMainTab === "options") runTickerOptions();
        else if (state.tickerMainTab === "info") runTickerInfo();
        else if (state.tickerMainTab === "insider") runTickerInsider();
        else runTickerChart();
      }
    } else {
      setRoute(r, true);
      if (r === "dashboard") runDashboard();
      if (r === "markets") runMarkets(state.marketsSub || "most_active");
      if (r === "chat") initChat();
    }
  });
});
