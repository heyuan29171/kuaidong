/* 快动 · 全局排行榜后端（自托管）
 * 零依赖 Node 服务：node server.js
 * 接口：
 *   GET  /api/leaderboard?song=<songId>   读取某首歌前十
 *   GET  /api/leaderboard/status          读取排行榜启用状态（公开）
 *   POST /api/leaderboard                 提交一条成绩
 *   POST /api/leaderboard/admin           站长启用/暂停排行榜（需管理口令）
 * 数据存于本机 data/leaderboard.json；管理口令等存 data/settings.json。
 *
 * 安全设计：
 *   - 只监听 127.0.0.1（公网仅能经内网穿透访问本机）
 *   - CORS 域名白名单（浏览器跨域请求仅放行线上站点）
 *   - 请求限流（防刷）、管理接口独立更严限流
 *   - 输入白名单校验（songId / playerId 字符限制、score / rate 范围）
 *   - 安全响应头、错误不泄露内部信息
 *   - 数据原子写盘（先写临时文件再改名，防止写一半损坏）
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "leaderboard.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const MAX_SCORE = 10000000;
const TOP_N = 10;
const BODY_LIMIT = 8192;
const RATE_LIMIT = { windowMs: 60000, max: 20 };
const ADMIN_LIMIT = { windowMs: 60000, max: 5 };
/* 全局写入兜底：即使 XFF 可被伪造，也限制单位时间总写入量 */
const GLOBAL_LIMIT = { windowMs: 60000, max: 300 };
const ID_PATTERN = /^[\w-]{1,48}$/;

/* 浏览器跨域白名单（前端所在站点） */
const ALLOWED_ORIGINS = [
  "https://heyuan29171.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

let store = {}; // { [songId]: [{ playerId, score, rate, date }] }
let dirty = false;
let saveTimer = null;
let settings = { leaderboardEnabled: true, adminKey: "" };

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store = (parsed && typeof parsed === "object") ? parsed : {};
  } catch (e) {
    store = {};
  }
}

function saveNow() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { /* 写盘失败不阻塞响应 */ }
}

function markDirty() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const p = JSON.parse(raw);
    settings.leaderboardEnabled = (p && typeof p.leaderboardEnabled === "boolean") ? p.leaderboardEnabled : true;
    settings.adminKey = (p && typeof p.adminKey === "string" && p.adminKey.length >= 8) ? p.adminKey : "";
  } catch (e) {
    settings = { leaderboardEnabled: true, adminKey: "" };
  }
  if (process.env.KD_ADMIN_KEY) settings.adminKey = process.env.KD_ADMIN_KEY;
  if (!settings.adminKey) {
    settings.adminKey = crypto.randomBytes(16).toString("hex");
    saveSettingsNow();
    console.log("首次运行已生成管理员口令：" + settings.adminKey);
    console.log("（用于启用/暂停排行榜，请妥善保存；可用环境变量 KD_ADMIN_KEY 指定固定口令）");
  }
}

function saveSettingsNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SETTINGS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(settings), "utf8");
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (e) { /* 忽略 */ }
}

function topScores(songId) {
  const list = store[songId];
  if (!Array.isArray(list)) return [];
  return list
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map((s) => ({
      playerId: s.playerId,
      score: s.score,
      rate: s.rate,
      date: s.date,
    }));
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/* 简单防刷：按 IP + 窗口限流 */
const hits = new Map();
function allowWrite(ip, limit) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.resetAt) {
    h = { count: 0, resetAt: now + limit.windowMs };
    hits.set(ip, h);
  }
  h.count++;
  return h.count <= limit.max;
}

/* 全局写入兜底（防伪造 XFF 绕过 IP 限流） */
let globalHits = { count: 0, resetAt: Date.now() + GLOBAL_LIMIT.windowMs };
function allowGlobalWrite() {
  const now = Date.now();
  if (now > globalHits.resetAt) globalHits = { count: 0, resetAt: now + GLOBAL_LIMIT.windowMs };
  globalHits.count++;
  return globalHits.count <= GLOBAL_LIMIT.max;
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

/* 收集请求体（带大小上限，超限直接断开） */
function readBody(req, cb) {
  let body = "";
  let done = false;
  req.on("data", (c) => {
    if (done) return;
    body += c;
    if (body.length > BODY_LIMIT) {
      done = true;
      req.destroy();
      return;
    }
  });
  req.on("end", () => { if (!done) cb(body); });
  req.on("error", () => { done = true; });
}

const server = http.createServer((req, res) => {
  /* 安全响应头 + 跨域（白名单才放行） */
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
      return send(res, 403, { code: 403, reason: "origin not allowed" });
    }
    res.writeHead(204);
    res.end();
    return;
  }

  /* 携带 Origin 但不在白名单的请求一律拒绝（防止被其他站点盗用） */
  if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
    return send(res, 403, { code: 403, reason: "origin not allowed" });
  }

  let url;
  try { url = new URL(req.url, "http://localhost"); } catch (e) {
    return send(res, 400, { code: 400, reason: "bad url" });
  }

  /* 排行榜启用状态（公开只读） */
  if (url.pathname === "/api/leaderboard/status") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { code: 405, reason: "method not allowed" });
    }
    return send(res, 200, { code: 0, enabled: settings.leaderboardEnabled });
  }

  /* 站长启用/暂停（需管理口令） */
  if (url.pathname === "/api/leaderboard/admin") {
    if (req.method !== "POST") {
      return send(res, 405, { code: 405, reason: "method not allowed" });
    }
    const ip = clientIp(req);
    if (!allowWrite(ip, ADMIN_LIMIT) || !allowGlobalWrite()) {
      return send(res, 429, { code: 429, reason: "too frequent" });
    }
    return readBody(req, (body) => {
      if (!body) return send(res, 400, { code: 400, reason: "empty body" });
      let data;
      try { data = JSON.parse(body); } catch (e) {
        return send(res, 400, { code: 400, reason: "bad json" });
      }
      const key = String(data.key || "");
      const enabled = data.enabled === true;
      if (!key) return send(res, 400, { code: 400, reason: "missing key" });
      if (key !== settings.adminKey) return send(res, 403, { code: 403, reason: "bad key" });
      settings.leaderboardEnabled = enabled;
      saveSettingsNow();
      return send(res, 200, { code: 0, enabled: settings.leaderboardEnabled });
    });
  }

  if (url.pathname !== "/api/leaderboard") {
    return send(res, 404, { code: 404, reason: "not found" });
  }

  /* 排行榜暂停时，主接口一律拒绝 */
  if (!settings.leaderboardEnabled) {
    return send(res, 403, { code: 403, reason: "disabled" });
  }

  /* 读取前十 */
  if (req.method === "GET" || req.method === "HEAD") {
    const song = (url.searchParams.get("song") || "").toString();
    if (!song) return send(res, 400, { code: 400, reason: "missing song" });
    if (!ID_PATTERN.test(song)) return send(res, 400, { code: 400, reason: "bad song" });
    return send(res, 200, { code: 0, scores: topScores(song) });
  }

  /* 提交成绩 */
  if (req.method === "POST") {
    const ip = clientIp(req);
    if (!allowWrite(ip, RATE_LIMIT) || !allowGlobalWrite()) {
      return send(res, 429, { code: 429, reason: "too frequent" });
    }
    return readBody(req, (body) => {
      if (!body) return send(res, 400, { code: 400, reason: "empty body" });
      let data;
      try { data = JSON.parse(body); } catch (e) {
        return send(res, 400, { code: 400, reason: "bad json" });
      }
      const songId = String(data.songId || "");
      let playerId = String(data.playerId || "");
      const score = Number(data.score);
      const rate = Number(data.rate) || 0;

      if (!songId) return send(res, 400, { code: 400, reason: "missing songId" });
      if (!ID_PATTERN.test(songId)) return send(res, 400, { code: 400, reason: "bad songId" });
      playerId = playerId.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
      if (!playerId) return send(res, 400, { code: 400, reason: "missing playerId" });
      if (!isFinite(score) || score <= 0 || score > MAX_SCORE) {
        return send(res, 400, { code: 400, reason: "bad score" });
      }
      if (!isFinite(rate) || rate < 0 || rate > 100) {
        return send(res, 400, { code: 400, reason: "bad rate" });
      }

      const list = store[songId];
      const cur = Array.isArray(list) ? list.slice().sort((a, b) => b.score - a.score) : [];
      /* 防刷：只有进前十才写入 */
      if (cur.length >= TOP_N && score < cur[cur.length - 1].score) {
        return send(res, 403, { code: 403, reason: "not in top10" });
      }
      if (!Array.isArray(store[songId])) store[songId] = [];
      store[songId].push({
        playerId: playerId,
        score: score,
        rate: rate,
        date: new Date().toISOString(),
      });
      markDirty();
      return send(res, 200, { code: 0, ok: true });
    });
  }

  return send(res, 405, { code: 405, reason: "method not allowed" });
});

/* 优雅退出时立即落盘 */
function shutdown() {
  saveNow();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* 自动备份：每天首次运行时备份一份 leaderboard.json 到 data/backups/，保留最近 30 份 */
const BACKUP_DIR = path.join(DATA_DIR, "backups");
function backupNow() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    const target = path.join(BACKUP_DIR, "leaderboard-" + stamp + ".json");
    if (fs.existsSync(target)) return;
    fs.copyFileSync(DATA_FILE, target);
    console.log("已备份排行榜数据 -> data/backups/leaderboard-" + stamp + ".json");
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).sort();
    while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) {
    console.error("备份失败：" + e.message);
  }
}
backupNow();
setInterval(backupNow, 60 * 60 * 1000);

load();
saveNow();
loadSettings();
server.listen(PORT, HOST, () => {
  console.log("排行榜服务已启动：" + HOST + ":" + PORT);
  console.log("当前状态：" + (settings.leaderboardEnabled ? "排行榜已启用" : "排行榜已暂停"));
  console.log("本机测试: http://127.0.0.1:" + PORT + "/api/leaderboard?song=blaze");
});