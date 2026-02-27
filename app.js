const STORAGE_KEY = "lmstudio-chat-state-v1";

const el = {
  conversationList: document.getElementById("conversation-list"),
  newChatBtn: document.getElementById("new-chat-btn"),
  deleteChatBtn: document.getElementById("delete-chat-btn"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  loadModelsBtn: document.getElementById("load-models-btn"),
  modelsSelect: document.getElementById("models-select"),
  systemPrompt: document.getElementById("system-prompt"),
  status: document.getElementById("status"),
  messages: document.getElementById("messages"),
  chatForm: document.getElementById("chat-form"),
  userInput: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  messageTemplate: document.getElementById("message-template"),
};

let state = loadState();
let isSending = false;
let isComposing = false;

function createConversation(title = "New Chat") {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

function defaultState() {
  const first = createConversation("Chat 1");
  return {
    settings: {
      baseUrl: "/api/v1",
      model: "",
      systemPrompt: "",
    },
    currentConversationId: first.id,
    conversations: [first],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed?.conversations?.length) return defaultState();
    if (!parsed.settings) parsed.settings = {};
    if (!parsed.settings.baseUrl) parsed.settings.baseUrl = "/api/v1";
    if (!parsed.settings.model) parsed.settings.model = "";
    if (!parsed.settings.systemPrompt) parsed.settings.systemPrompt = "";

    // Migrate old direct-LM-Studio defaults to proxy path to avoid CORS in browsers.
    const legacy = ["http://localhost:1234/v1", "http://127.0.0.1:1234/v1"];
    if (legacy.includes(parsed.settings.baseUrl.trim())) {
      parsed.settings.baseUrl = "/api/v1";
    }
    return parsed;
  } catch (err) {
    console.error(err);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentConversation() {
  return state.conversations.find((c) => c.id === state.currentConversationId) || state.conversations[0];
}

function sanitizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

function syncSettingsFromInputs() {
  state.settings.baseUrl = el.baseUrl.value.trim();
  state.settings.model = el.model.value.trim();
  state.settings.systemPrompt = el.systemPrompt.value;
  saveState();
}

function normalizeFetchError(err) {
  const msg = err?.message || "unknown";
  if (msg === "Failed to fetch") {
    return "Failed to fetch (CORS/Mixed Content/URL誤りの可能性)。`/api/v1` か `http://127.0.0.1:1234/v1` を試してください";
  }
  return msg;
}

function renderConversationList() {
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  el.conversationList.innerHTML = "";

  for (const c of sorted) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.classList.toggle("active", c.id === state.currentConversationId);
    li.textContent = c.title || "Untitled";
    li.title = "ダブルクリックで名前変更";
    el.conversationList.appendChild(li);
  }
}

function renderMessages() {
  const conv = currentConversation();
  el.messages.innerHTML = "";

  for (const m of conv.messages) {
    const node = el.messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(m.role);
    node.querySelector("header").textContent = roleLabel(m.role);
    node.querySelector(".message-body").innerHTML = renderMarkdownSafe(m.content);
    el.messages.appendChild(node);
  }

  el.messages.scrollTop = el.messages.scrollHeight;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceThinkTagsWithDetails(text) {
  const src = String(text ?? "");
  return src.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thinkBody) => {
    const safeBody = escapeHtml(thinkBody.trim()).replaceAll("\n", "<br>");
    return [
      '<details class="think-block">',
      "<summary>思考モードの内容</summary>",
      `<div class="think-content">${safeBody || "(empty)"}</div>`,
      "</details>",
    ].join("\n");
  });
}

function renderMarkdownSafe(content) {
  const text = replaceThinkTagsWithDetails(content);
  if (!window.marked || !window.DOMPurify) {
    return escapeHtml(text).replaceAll("\n", "<br>");
  }

  const html = window.marked.parse(text, {
    gfm: true,
    breaks: true,
  });
  return window.DOMPurify.sanitize(html);
}

function roleLabel(role) {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return "System";
}

function renderSettings() {
  el.baseUrl.value = state.settings.baseUrl;
  el.model.value = state.settings.model;
  el.systemPrompt.value = state.settings.systemPrompt;
}

function renderAll() {
  renderConversationList();
  renderMessages();
  renderSettings();
}

function renameConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;

  const value = prompt("会話名を入力", conv.title);
  if (value === null) return;

  const next = value.trim() || "Untitled";
  conv.title = next;
  conv.updatedAt = Date.now();
  saveState();
  renderConversationList();
}

function addMessage(role, content) {
  const conv = currentConversation();
  conv.messages.push({ role, content });
  conv.updatedAt = Date.now();

  if (role === "user" && conv.messages.length <= 2 && conv.title.startsWith("Chat")) {
    const shortTitle = content.slice(0, 28);
    conv.title = shortTitle || conv.title;
  }

  saveState();
  renderAll();
}

function buildApiMessages(conv) {
  const messages = [];
  const systemPrompt = state.settings.systemPrompt.trim();
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  for (const m of conv.messages) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }

  return messages;
}

async function sendMessage(text) {
  if (isSending) return;
  isSending = true;
  el.sendBtn.disabled = true;
  setStatus("送信中...");

  try {
    syncSettingsFromInputs();
    addMessage("user", text);

    const baseUrl = sanitizeBaseUrl(state.settings.baseUrl.trim());
    if (!baseUrl) throw new Error("Base URL を入力してください");

    const model = state.settings.model.trim();
    if (!model) throw new Error("Model を入力してください");

    const conv = currentConversation();
    const body = {
      model,
      messages: buildApiMessages(conv),
      temperature: 0.7,
      stream: false,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const textErr = await res.text();
      throw new Error(`API Error ${res.status}: ${textErr.slice(0, 240)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("レスポンスの形式が想定と異なります");

    addMessage("assistant", reply);
    setStatus("送信完了");
  } catch (err) {
    console.error(err);
    const msg = normalizeFetchError(err);
    setStatus(msg, true);
    addMessage("system", `Error: ${msg}`);
  } finally {
    isSending = false;
    el.sendBtn.disabled = false;
  }
}

async function loadModels() {
  syncSettingsFromInputs();
  setStatus("モデル一覧を取得中...");
  const baseUrl = sanitizeBaseUrl(state.settings.baseUrl.trim());
  if (!baseUrl) {
    setStatus("Base URL を入力してください", true);
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data : [];

    el.modelsSelect.innerHTML = '<option value="">モデルを選択（任意）</option>';
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.id;
      el.modelsSelect.appendChild(opt);
    }

    if (models.length === 0) {
      setStatus("モデルが見つかりませんでした", true);
    } else {
      setStatus(`${models.length}件のモデルを取得 (${baseUrl}/models)`);
    }
  } catch (err) {
    console.error(err);
    setStatus(`モデル取得失敗: ${normalizeFetchError(err)} (URL: ${baseUrl}/models)`, true);
  }
}

function bindEvents() {
  el.newChatBtn.addEventListener("click", () => {
    const next = createConversation(`Chat ${state.conversations.length + 1}`);
    state.conversations.push(next);
    state.currentConversationId = next.id;
    saveState();
    renderAll();
  });

  el.deleteChatBtn.addEventListener("click", () => {
    if (state.conversations.length === 1) {
      setStatus("最後の会話は削除できません", true);
      return;
    }

    state.conversations = state.conversations.filter((c) => c.id !== state.currentConversationId);
    state.currentConversationId = state.conversations[0].id;
    saveState();
    renderAll();
    setStatus("会話を削除しました");
  });

  el.clearAllBtn.addEventListener("click", () => {
    const ok = confirm("すべての履歴を削除します。よろしいですか？");
    if (!ok) return;
    state = defaultState();
    saveState();
    renderAll();
    setStatus("履歴を初期化しました");
  });

  el.conversationList.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    state.currentConversationId = li.dataset.id;
    saveState();
    renderAll();
  });

  el.conversationList.addEventListener("dblclick", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    renameConversation(li.dataset.id);
  });

  el.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = el.userInput.value.trim();
    if (!text) return;
    el.userInput.value = "";
    await sendMessage(text);
  });

  el.userInput.addEventListener("keydown", (e) => {
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.chatForm.requestSubmit();
    }
  });

  el.userInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  el.userInput.addEventListener("compositionend", () => {
    isComposing = false;
  });

  for (const input of [el.baseUrl, el.model, el.systemPrompt]) {
    input.addEventListener("change", syncSettingsFromInputs);
    input.addEventListener("input", syncSettingsFromInputs);
  }

  el.loadModelsBtn.addEventListener("click", loadModels);

  el.modelsSelect.addEventListener("change", () => {
    if (!el.modelsSelect.value) return;
    el.model.value = el.modelsSelect.value;
    state.settings.model = el.modelsSelect.value;
    saveState();
  });
}

bindEvents();
renderAll();
setStatus("Ready");
