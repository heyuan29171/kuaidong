/* =========================================================
 * 全局排行榜代理接口（Cloudflare Pages Functions）
 * 路由：GET  /api/leaderboard?song=<songId>   读取某首歌前十
 *       POST /api/leaderboard                 提交一条成绩
 * 服务端持有 GitHub fine-grained token（环境变量 GH_TOKEN），
 * 浏览器端永远接触不到 token。
 * ========================================================= */
const OWNER = "heyuan29171";
const REPO = "kuaidong";
const BRANCH = "main";
const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;
const RAW = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/leaderboard";

function pathOf(songId) {
  return "leaderboard/" + encodeURIComponent(songId) + ".json";
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function readTop(songId) {
  try {
    const res = await fetch(RAW + "/" + encodeURIComponent(songId) + ".json");
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.scores) ? j.scores : [];
  } catch (e) {
    return [];
  }
}

async function getSha(path, token) {
  try {
    const res = await fetch(API + "/contents/" + path, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.sha || null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const songId = url.searchParams.get("song");
  if (!songId) return json({ ok: false, reason: "missing-song" }, 400);
  const scores = await readTop(songId);
  return json({ ok: true, scores: scores });
}

export async function onRequestPost(context) {
  const env = context.env;
  const TOKEN = env.GH_TOKEN;
  if (!TOKEN) return json({ ok: false, reason: "not-configured" }, 500);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ ok: false, reason: "bad-json" }, 400);
  }
  const songId = body && body.songId;
  const playerId = body && typeof body.playerId === "string" ? body.playerId.trim() : "";
  const score = body && typeof body.score === "number" ? body.score : NaN;
  const rate = body && typeof body.rate === "number" ? body.rate : null;
  if (!songId || !playerId || !isFinite(score)) {
    return json({ ok: false, reason: "bad-body" }, 400);
  }
  if (playerId.length > 16 || score > 10000000) {
    return json({ ok: false, reason: "bad-body" }, 400);
  }

  const path = pathOf(songId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const list = await readTop(songId);
    list.push({
      playerId: playerId,
      score: Math.round(score),
      rate: rate,
      date: new Date().toISOString(),
    });
    list.sort(function (a, b) { return b.score - a.score; });
    const top = list.slice(0, 10);
    const payload = {
      message: "成绩提交 " + playerId + " " + Math.round(score),
      content: b64(JSON.stringify({ scores: top }, null, 1)),
    };
    const sha = await getSha(path, TOKEN);
    if (sha) payload.sha = sha;
    const res = await fetch(API + "/contents/" + path, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + TOKEN,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 409) continue;
    return json({ ok: res.ok, status: res.status, top: top });
  }
  return json({ ok: false, reason: "conflict" }, 409);
}