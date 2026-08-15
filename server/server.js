/* 快动 · 全局排行榜后端（自托管）
 * 零依赖 Node 服务：node server.js
 * 接口：
 *   GET  /api/leaderboard?song=<songId>  读取某首歌前十
 *   POST /api/leaderboard               提交一条成绩
 * 数据存于本机 data/leaderboard.json，关机不丢失。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "leaderboard.json");

const MAX_SCORE = 10000000;
const TOP_N = 10;
const BODY_LIMIT = 8192;
/* 每 IP 每分钟最多提交次数（防刷） */
const RATE_LIMIT = { windowMs: 60000, max: 20 };

let store = {}; // { [songId]: [{ playerId, score, rate, date }] }
let dirty = false;
let saveTimer = null;

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
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf8");
  } catch (e) { /* 写盘失败不阻塞响应 */ }
}

function markDirty() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
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

/* 简单防刷 */
const hits = new Map();
function allowWrite(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.resetAt) {
    h = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    hits.set(ip, h);
  }
  h.count++;
  return h.count <= RATE_LIMIT.max;
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

const server = http.createServer((req, res) => {
  /* 跨域（前端在 GitHub Pages，请求到这里必须 CORS） */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try { url = new URL(req.url, "http://localhost"); } catch (e) {
    return send(res, 400, { code: 400, reason: "bad url" });
  }

  if (url.pathname !== "/api/leaderboard") {
    return send(res, 404, { code: 404, reason: "not found" });
  }

  /* 读取前十 */
  if (req.method === "GET" || req.method === "HEAD") {
    const song = (url.searchParams.get("song") || "").toString();
    if (!song) return send(res, 400, { code: 400, reason: "missing song" });
    return send(res, 200, { code: 0, scores: topScores(song) });
  }

  /* 提交成绩 */
  if (req.method === "POST") {
    const ip = clientIp(req);
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > BODY_LIMIT) req.destroy();
    });
    req.on("end", () => {
      if (!body) return send(res, 400, { code: 400, reason: "empty body" });
      let data;
      try { data = JSON.parse(body); } catch (e) {
        return send(res, 400, { code: 400, reason: "bad json" });
      }
      const songId = String(data.songId || "").toString();
      const playerId = String(data.playerId || "").toString().trim();
      const score = Number(data.score);
      const rate = Number(data.rate) || 0;

      if (!songId) return send(res, 400, { code: 400, reason: "missing songId" });
      if (!playerId) return send(res, 400, { code: 400, reason: "missing playerId" });
      if (playerId.length > 16) return send(res, 400, { code: 400, reason: "id too long" });
      if (!isFinite(score) || score <= 0 || score > MAX_SCORE) {
        return send(res, 400, { code: 400, reason: "bad score" });
      }
      if (!allowWrite(ip)) return send(res, 429, { code: 429, reason: "too frequent" });

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
    return;
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

load();
saveNow();
server.listen(PORT, () => {
  console.log("排行榜服务已启动，端口 " + PORT);
  console.log("本机测试: http://127.0.0.1:" + PORT + "/api/leaderboard?song=blaze");
});