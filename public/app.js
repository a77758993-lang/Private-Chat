const $ = (id) => document.getElementById(id);
let currentUser = null;
let socket = null;
let reconnectTimer = null;
let messages = [];
let online = [];

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "خطایی رخ داد.");
  return data;
}
function show(id) {
  ["gate", "auth", "chat"].forEach((name) => $(name).classList.toggle("hidden", name !== id));
}
function updateCapacity(registered, capacity) {
  const count = Math.min(registered || 0, capacity || 10);
  $("capacity-count").textContent = `${count} از ${capacity || 10}`;
  $("capacity-bar").style.width = `${count / (capacity || 10) * 100}%`;
}
function activateTab(tab) {
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  $("login-panel").classList.toggle("hidden", tab !== "login");
  $("register-panel").classList.toggle("hidden", tab !== "register");
}
document.querySelectorAll(".tab").forEach((el) => el.addEventListener("click", () => activateTab(el.dataset.tab)));

async function init() {
  try {
    const status = await api("/api/status");
    updateCapacity(status.registered, status.capacity);
    if (!status.siteUnlocked) return show("gate");
    if (status.user) {
      currentUser = status.user;
      show("chat");
      connectSocket();
    } else show("auth");
  } catch { show("gate"); }
}
$("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("gate-error").textContent = "";
  try {
    await api("/api/site-unlock", { method: "POST", body: JSON.stringify({ password: $("site-password").value }) });
    const status = await api("/api/status");
    updateCapacity(status.registered, status.capacity);
    show("auth");
  } catch (error) { $("gate-error").textContent = error.message; }
});
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ username: $("login-user").value, password: $("login-pass").value }) });
    currentUser = data.user;
    show("chat"); connectSocket();
  } catch (error) { $("login-error").textContent = error.message; }
});
$("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("register-error").textContent = "";
  try {
    const data = await api("/api/register", { method: "POST", body: JSON.stringify({ username: $("register-user").value, password: $("register-pass").value }) });
    currentUser = data.user;
    show("chat"); connectSocket();
  } catch (error) {
    $("register-error").textContent = error.message;
    const status = await api("/api/status").catch(() => null);
    if (status) updateCapacity(status.registered, status.capacity);
  }
});
$("logout").addEventListener("click", async () => {
  if (socket) socket.close();
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  currentUser = null; messages = []; show("auth"); toast("از حساب خارج شدی.");
});

function connectSocket() {
  if (!currentUser) return;
  if (socket) socket.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/chat`);
  socket.addEventListener("open", () => {
    clearTimeout(reconnectTimer);
    toast("به چت‌روم وصل شدی.");
  });
  socket.addEventListener("message", (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "history") {
      messages = data.messages || [];
      renderMessages();
    } else if (data.type === "message") {
      if (!messages.some((item) => item.id === data.message.id)) messages.push(data.message);
      renderMessages();
    } else if (data.type === "presence") {
      online = data.users || [];
      renderMembers();
    } else if (data.type === "notice") toast(data.text);
  });
  socket.addEventListener("close", () => {
    if (currentUser && !reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connectSocket(); }, 2500);
  });
}
function toFaNumber(value) { return new Intl.NumberFormat("fa-IR").format(value); }
function timeLabel(timestamp) {
  return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
function renderMessages() {
  const container = $("messages");
  const now = Date.now();
  messages = messages.filter((message) => now < message.expiresAt);
  container.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<div class="empty-icon">✦</div><h3>شروع یک گفت‌وگوی تازه</h3><p>اولین پیام رو تو بفرست.</p>';
    container.appendChild(empty);
    return;
  }
  for (const message of messages) {
    const mine = message.userId === currentUser?.id;
    const row = document.createElement("div");
    row.className = `message${mine ? " mine" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = (message.username || "?").slice(0, 1).toUpperCase();
    const body = document.createElement("div");
    body.className = "message-body";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = mine ? "تو" : message.username;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;
    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = `${timeLabel(message.createdAt)} · حذف در ${toFaNumber(Math.max(0, Math.ceil((message.expiresAt - now) / 60000)))} دقیقه`;
    body.append(meta, bubble, time);
    row.append(avatar, body);
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}
function renderMembers() {
  $("online-count").textContent = toFaNumber(online.length);
  const list = $("member-list");
  list.innerHTML = "";
  online.forEach((user) => {
    const item = document.createElement("div");
    item.className = "member";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = user.username.slice(0, 1).toUpperCase();
    const text = document.createElement("div");
    text.textContent = user.username;
    const small = document.createElement("small");
    small.textContent = user.id === currentUser?.id ? "شما · آنلاین" : "آنلاین";
    text.appendChild(small);
    item.append(avatar, text);
    list.appendChild(item);
  });
}
$("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("message-input").value.trim();
  if (!text) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return toast("اتصال برقرار نیست؛ چند لحظه صبر کن.");
  socket.send(JSON.stringify({ type: "message", text }));
  $("message-input").value = "";
  $("char-count").textContent = "۰ / ۱۰۰۰";
  $("message-input").focus();
});
$("message-input").addEventListener("input", () => {
  $("char-count").textContent = `${toFaNumber($("message-input").value.length)} / ${toFaNumber(1000)}`;
});
setInterval(renderMessages, 30_000);
init();
