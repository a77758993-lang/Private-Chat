const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const SITE_PASSWORD = process.env.SITE_PASSWORD || "ChangeThisSitePassword";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const MAX_USERS = 10;
const MESSAGE_TTL = 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;

const app = express();
const server = http.createServer(app);
const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "chat.sqlite");
require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const getUserById = db.prepare("SELECT id, username FROM users WHERE id = ?");
const getUserByName = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE");
const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users");
const insertUser = db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "12kb" }));

const sessionParser = session({
  name: "privatechat.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
app.use(sessionParser);

function requireSite(req, res, next) {
  if (!req.session.siteUnlocked) return res.status(403).json({ error: "ابتدا رمز ورود سایت را وارد کن." });
  next();
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "ابتدا وارد حساب کاربری شو." });
  next();
}
function cleanUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}
function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,18}$/.test(username);
}
function validPassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 72;
}

app.get("/api/status", (req, res) => {
  const user = req.session.userId ? getUserById.get(req.session.userId) : null;
  res.json({
    siteUnlocked: Boolean(req.session.siteUnlocked),
    user: user || null,
    registered: countUsers.get().count,
    capacity: MAX_USERS
  });
});

app.post("/api/site-unlock", (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== "string" || password.length > 200) return res.status(400).json({ error: "رمز را وارد کن." });
  if (!crypto.timingSafeEqual(Buffer.from(password.padEnd(256, "\0").slice(0, 256)), Buffer.from(SITE_PASSWORD.padEnd(256, "\0").slice(0, 256)))) {
    return res.status(401).json({ error: "رمز ورود سایت اشتباه است." });
  }
  req.session.siteUnlocked = true;
  req.session.save(() => res.json({ ok: true }));
});

app.post("/api/register", requireSite, async (req, res) => {
  const username = cleanUsername(req.body && req.body.username);
  const password = req.body && req.body.password;
  if (!validUsername(username)) return res.status(400).json({ error: "نام کاربری باید ۳ تا ۱۸ حرف انگلیسی، عدد یا _ باشد." });
  if (!validPassword(password)) return res.status(400).json({ error: "رمز حساب باید حداقل ۶ کاراکتر باشد." });
  if (countUsers.get().count >= MAX_USERS) return res.status(403).json({ error: "ظرفیت ۱۰ حساب کاربری تکمیل شده است." });
  if (getUserByName.get(username)) return res.status(409).json({ error: "این نام کاربری قبلاً ثبت شده است." });

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = insertUser.run(username, hash, Date.now());
    req.session.userId = Number(result.lastInsertRowid);
    req.session.save(() => res.json({ ok: true, user: { id: Number(result.lastInsertRowid), username } }));
  } catch (error) {
    if (String(error.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "این نام کاربری قبلاً ثبت شده است." });
    console.error(error);
    res.status(500).json({ error: "ثبت‌نام انجام نشد. دوباره تلاش کن." });
  }
});

app.post("/api/login", requireSite, async (req, res) => {
  const username = cleanUsername(req.body && req.body.username);
  const password = req.body && req.body.password;
  if (typeof password !== "string" || password.length > 72) return res.status(400).json({ error: "نام کاربری یا رمز عبور اشتباه است." });
  const user = getUserByName.get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "نام کاربری یا رمز عبور اشتباه است." });
  }
  req.session.userId = user.id;
  req.session.save(() => res.json({ ok: true, user: { id: user.id, username: user.username } }));
});

app.post("/api/logout", (req, res) => {
  req.session.userId = null;
  req.session.save(() => res.json({ ok: true }));
});

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

const wss = new WebSocketServer({ noServer: true });
const sockets = new Map(); // userId -> websocket
let messages = [];

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function onlineUsers() {
  return [...sockets.values()]
    .filter((entry) => entry.ws.readyState === WebSocket.OPEN)
    .map((entry) => ({ id: entry.user.id, username: entry.user.username }));
}
function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const { ws } of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}
function broadcastPresence() {
  broadcast({ type: "presence", users: onlineUsers() });
}
function pruneMessages() {
  const cutoff = Date.now() - MESSAGE_TTL;
  const before = messages.length;
  messages = messages.filter((message) => message.createdAt > cutoff);
  if (messages.length !== before) broadcast({ type: "history", messages });
}
setInterval(pruneMessages, 15_000).unref();

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/chat")) return socket.destroy();
  const mockResponse = {
    getHeader: () => undefined,
    setHeader: () => {},
    end: () => {}
  };
  sessionParser(req, mockResponse, () => {
    if (!req.session || !req.session.siteUnlocked || !req.session.userId) return socket.destroy();
    const user = getUserById.get(req.session.userId);
    if (!user) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, user);
    });
  });
});

wss.on("connection", (ws, req, user) => {
  // One active connection per account; a new connection replaces the old one.
  const previous = sockets.get(user.id);
  if (previous && previous.ws !== ws) {
    send(previous.ws, { type: "notice", text: "حساب شما در دستگاه دیگری وارد شد." });
    previous.ws.close(4001, "replaced");
  }
  sockets.set(user.id, { ws, user });
  send(ws, { type: "history", messages: messages.filter((m) => Date.now() - m.createdAt < MESSAGE_TTL) });
  broadcastPresence();

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || data.type !== "message" || typeof data.text !== "string") return;
    const text = data.text.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return;
    const message = {
      id: crypto.randomUUID(),
      userId: user.id,
      username: user.username,
      text,
      createdAt: Date.now(),
      expiresAt: Date.now() + MESSAGE_TTL
    };
    messages.push(message);
    broadcast({ type: "message", message });
  });

  ws.on("close", () => {
    const current = sockets.get(user.id);
    if (current && current.ws === ws) {
      sockets.delete(user.id);
      broadcastPresence();
    }
  });
  ws.on("error", () => {});
});

server.listen(PORT, () => {
  console.log(`Private Chat is running on port ${PORT}`);
  console.log(`Registered accounts limit: ${MAX_USERS}`);
});
