const STORAGE_KEY = "lmstudio-chat-state-v1";

const el = {
  conversationList: document.getElementById("conversation-list"),
  newChatBtn: document.getElementById("new-chat-btn"),
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  loadModelsBtn: document.getElementById("load-models-btn"),
  modelsSelect: document.getElementById("models-select"),
  systemPrompt: document.getElementById("system-prompt"),
  status: document.getElementById("status"),
  messages: document.getElementById("messages"),
  chatForm: document.getElementById("chat-form"),
  imageInput: document.getElementById("image-input"),
  attachImageBtn: document.getElementById("attach-image-btn"),
  composerImages: document.getElementById("composer-images"),
  visionHint: document.getElementById("vision-hint"),
  userInput: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  messageTemplate: document.getElementById("message-template"),
};

let state = loadState();
let isSending = false;
let isComposing = false;
let composerImages = [];
let modelCapabilities = {};

const VISION_MODEL_PATTERNS = [
  /\bllava\b/i,
  /\bvision\b/i,
  /\b(?:qwen|qwq)[\w.-]*-vl\b/i,
  /\bminicpm[\w.-]*-v\b/i,
  /\bphi[\w.-]*vision\b/i,
  /\binternvl\b/i,
  /\bpixtral\b/i,
  /\bmolmo\b/i,
  /\bidefics\b/i,
  /\bglm-4v\b/i,
  /\bllama-3\.2[\w.-]*vision\b/i,
  /\bgemma-3\b/i,
];

function createConversation(title = "New Chat") {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    lastResponseId: null,
    lastModel: "",
    lastSystemPrompt: "",
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
    const legacy = [
      "http://localhost:1234/v1",
      "http://127.0.0.1:1234/v1",
      "http://localhost:1234/api/v1",
      "http://127.0.0.1:1234/api/v1",
    ];
    if (legacy.includes(parsed.settings.baseUrl.trim())) {
      parsed.settings.baseUrl = "/api/v1";
    }
    parsed.conversations = parsed.conversations.map((conv) => ({
      ...conv,
      messages: Array.isArray(conv.messages) ? conv.messages.map(normalizeStoredMessage) : [],
      lastResponseId: typeof conv.lastResponseId === "string" ? conv.lastResponseId : null,
      lastModel: typeof conv.lastModel === "string" ? conv.lastModel : "",
      lastSystemPrompt: typeof conv.lastSystemPrompt === "string" ? conv.lastSystemPrompt : "",
    }));
    return parsed;
  } catch (err) {
    console.error(err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error(err);
    setStatus("履歴保存に失敗しました。画像が大きすぎる可能性があります", true);
    return false;
  }
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
  updateVisionUi();
}

function normalizeFetchError(err) {
  const msg = err?.message || "unknown";
  if (msg === "Failed to fetch") {
    return "Failed to fetch (CORS/Mixed Content/URL誤りの可能性)。`/api/v1` か `http://127.0.0.1:1234/api/v1` を試してください";
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
    li.title = "ダブルクリックで名前変更";

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = c.title || "Untitled";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "chat-delete-btn";
    del.dataset.id = c.id;
    del.textContent = "🗑";
    del.title = "この会話を削除";
    del.ariaLabel = "この会話を削除";
    if (state.conversations.length === 1) del.disabled = true;

    li.appendChild(title);
    li.appendChild(del);
    el.conversationList.appendChild(li);
  }
}

function deleteConversation(id) {
  if (state.conversations.length === 1) {
    setStatus("最後の会話は削除できません", true);
    return;
  }

  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (!state.conversations.some((c) => c.id === state.currentConversationId)) {
    state.currentConversationId = state.conversations[0].id;
  }
  saveState();
  renderAll();
  setStatus("会話を削除しました");
}

function renderMessages() {
  const conv = currentConversation();
  el.messages.innerHTML = "";

  for (const m of conv.messages) {
    const node = el.messageTemplate.content.firstElementChild.cloneNode(true);
    const body = node.querySelector(".message-body");
    const media = node.querySelector(".message-media");
    node.classList.add(m.role);
    node.querySelector("header").textContent = roleLabel(m.role);
    const textContent = getMessageText(m);
    const images = getMessageImages(m);

    body.innerHTML = textContent ? renderMarkdownSafe(textContent) : "";
    body.hidden = !textContent;
    renderMessageImages(media, images);
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
  updateVisionUi();
}

function renderAll() {
  renderConversationList();
  renderMessages();
  renderSettings();
  renderComposerImages();
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
    const shortTitle = getMessageText({ content }).slice(0, 28) || `画像 ${getMessageImages({ content }).length} 枚`;
    conv.title = shortTitle || conv.title;
  }

  saveState();
  renderAll();
}

async function sendMessage(payload) {
  if (isSending) return;
  isSending = true;
  el.sendBtn.disabled = true;
  setStatus("送信中...");

  try {
    syncSettingsFromInputs();
    addMessage("user", buildUserMessageContent(payload.text, payload.images));

    const baseUrl = sanitizeBaseUrl(state.settings.baseUrl.trim());
    if (!baseUrl) throw new Error("Base URL を入力してください");

    const model = state.settings.model.trim();
    if (!model) throw new Error("Model を入力してください");

    const conv = currentConversation();
    const systemPrompt = state.settings.systemPrompt.trim();
    const body = {
      model,
      input: buildNativeInput(payload.text, payload.images),
      store: true,
      temperature: 0.7,
    };
    const canContinue =
      conv.lastResponseId && conv.lastModel === model && conv.lastSystemPrompt === systemPrompt;
    if (systemPrompt) body.system_prompt = systemPrompt;
    if (canContinue) {
      body.previous_response_id = conv.lastResponseId;
    }

    const res = await fetch(`${baseUrl}/chat`, {
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
    const reply = extractAssistantText(data?.output);
    if (!reply) throw new Error("レスポンスの形式が想定と異なります");

    addMessage("assistant", reply);
    conv.lastResponseId = typeof data?.response_id === "string" ? data.response_id : conv.lastResponseId;
    conv.lastModel = model;
    conv.lastSystemPrompt = systemPrompt;
    saveState();
    setStatus("送信完了");
  } catch (err) {
    console.error(err);
    const conv = currentConversation();
    conv.lastResponseId = null;
    const msg = normalizeFetchError(err);
    setStatus(msg, true);
    addMessage("system", `Error: ${msg}`);
  } finally {
    isSending = false;
    el.sendBtn.disabled = false;
  }
}

function normalizeStoredMessage(message) {
  if (!message || typeof message !== "object") return { role: "system", content: "" };
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  if (!Array.isArray(message.content)) return { role: message.role, content: "" };

  const content = message.content
    .map((part) => {
      if (part?.type === "text") return { type: "text", text: String(part.text || "") };
      if (part?.type === "image_url") {
        const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        if (!url) return null;
        return { type: "image_url", image_url: { url } };
      }
      return null;
    })
    .filter(Boolean);

  return { role: message.role, content };
}

function buildUserMessageContent(text, images) {
  const parts = [];
  const trimmed = text.trim();
  if (trimmed) parts.push({ type: "text", text: trimmed });
  for (const image of images) {
    parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}

function getMessageText(message) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function getMessageImages(message) {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((part) => part?.type === "image_url")
    .map((part) => {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      return url ? { url } : null;
    })
    .filter(Boolean);
}

function buildNativeInput(text, images) {
  const trimmed = text.trim();
  if (images.length === 0) {
    return trimmed;
  }
  const items = [];
  if (trimmed) items.push({ type: "text", content: trimmed });
  for (const image of images) {
    items.push({ type: "image", data_url: image.dataUrl });
  }
  return items;
}

function extractAssistantText(output) {
  if (!Array.isArray(output)) return "";
  return output
    .filter((item) => item?.type === "message" || item?.type === "reasoning")
    .map((item) => {
      if (item.type === "reasoning") return `<think>${item.content || ""}</think>`;
      return item.content || "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function renderMessageImages(container, images) {
  container.innerHTML = "";
  container.hidden = images.length === 0;
  for (const image of images) {
    const img = document.createElement("img");
    img.src = image.url;
    img.alt = "Attached image";
    img.loading = "lazy";
    container.appendChild(img);
  }
}

function renderComposerImages() {
  el.composerImages.innerHTML = "";
  el.composerImages.hidden = composerImages.length === 0;

  for (const image of composerImages) {
    const item = document.createElement("div");
    item.className = "composer-image";

    const preview = document.createElement("img");
    preview.src = image.dataUrl;
    preview.alt = image.name;

    const meta = document.createElement("div");
    meta.className = "composer-image-meta";
    meta.textContent = image.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "composer-image-remove";
    remove.textContent = "削除";
    remove.dataset.id = image.id;

    item.appendChild(preview);
    item.appendChild(meta);
    item.appendChild(remove);
    el.composerImages.appendChild(item);
  }
}

function clearComposer() {
  composerImages = [];
  el.userInput.value = "";
  el.imageInput.value = "";
  renderComposerImages();
}

function modelSupportsImages(modelId) {
  const value = String(modelId || "").trim();
  if (!value) return false;
  if (value in modelCapabilities) return Boolean(modelCapabilities[value]?.vision);
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(value));
}

function updateVisionUi() {
  const supported = modelSupportsImages(el.model.value);
  el.attachImageBtn.disabled = !supported;
  if (supported) {
    el.visionHint.textContent = "画像入力対応モデルとして扱います";
  } else {
    el.visionHint.textContent = "画像入力は視覚対応モデル名を入力すると有効になります";
  }
}

async function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: reader.result,
      });
    reader.onerror = () => reject(new Error(`${file.name} の読み込みに失敗しました`));
    reader.readAsDataURL(file);
  });
}

async function addComposerImages(files) {
  if (!modelSupportsImages(el.model.value)) {
    setStatus("現在のモデルは画像入力非対応として扱っています", true);
    return;
  }

  const nextImages = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      setStatus(`${file.name} は画像ファイルではありません`, true);
      continue;
    }
    nextImages.push(await readImageFile(file));
  }

  composerImages = [...composerImages, ...nextImages];
  renderComposerImages();
  setStatus(nextImages.length ? `${nextImages.length} 枚の画像を追加しました` : el.status.textContent, false);
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
    const models = Array.isArray(data?.models) ? data.models.filter((model) => model.type === "llm") : [];
    modelCapabilities = {};

    el.modelsSelect.innerHTML = '<option value="">モデルを選択（任意）</option>';
    for (const m of models) {
      const opt = document.createElement("option");
      const modelId = m.key || m.id;
      const vision = m.capabilities?.vision;
      modelCapabilities[modelId] = {
        vision: Boolean(vision),
      };
      opt.value = modelId;
      opt.textContent = `${m.display_name || modelId}${vision ? " [vision]" : ""}`;
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
    clearComposer();
    renderAll();
  });

  el.conversationList.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".chat-delete-btn");
    if (deleteBtn) {
      e.stopPropagation();
      deleteConversation(deleteBtn.dataset.id);
      return;
    }

    const li = e.target.closest("li");
    if (!li) return;
    state.currentConversationId = li.dataset.id;
    saveState();
    clearComposer();
    renderAll();
  });

  el.conversationList.addEventListener("dblclick", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    renameConversation(li.dataset.id);
  });

  el.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = el.userInput.value;
    const images = [...composerImages];
    if (!text.trim() && images.length === 0) return;
    clearComposer();
    await sendMessage({ text, images });
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

  el.attachImageBtn.addEventListener("click", () => {
    if (el.attachImageBtn.disabled) return;
    el.imageInput.click();
  });

  el.imageInput.addEventListener("change", async () => {
    try {
      await addComposerImages(Array.from(el.imageInput.files || []));
    } catch (err) {
      console.error(err);
      setStatus(normalizeFetchError(err), true);
    } finally {
      el.imageInput.value = "";
    }
  });

  el.composerImages.addEventListener("click", (e) => {
    const button = e.target.closest(".composer-image-remove");
    if (!button) return;
    composerImages = composerImages.filter((image) => image.id !== button.dataset.id);
    renderComposerImages();
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
    updateVisionUi();
  });
}

bindEvents();
renderAll();
setStatus("Ready");
