/* =========================================================
 * 全局排行榜代理接口（Cloudflare Pages Functions）
 * 路由：GET  /api/leaderboard?song=<songId>   读取某首歌前十
 *       POST /api/leaderboard                 提交一条成绩
 * 数据存于 Cloudflare KV（无 GitHub token、无任何密钥）。
 * 浏览器端只调用本接口，不接触任何凭据。
 * 绑定要求：Pages 项目 → Settings → Bindings → KV namespace，
 *           变量名必须是 LB
 * ========================================================= */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readTop(env, songId) {
  try {
    const raw = await env.LB.get(songId);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j.scores) ? j.scores : [];
  } catch (e) {
    return [];
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const songId = url.searchParams.get("song");
  if (!songId) return json({ ok: false, reason: "missing-song" }, 400);
  const scores = await readTop(context.env, songId);
  return json({ ok: true, scores: scores });
}

export async function onRequestPost(context) {
  const env = context.env;
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

  const list = await readTop(env, songId);
  list.push({
    playerId: playerId,
    score: Math.round(score),
    rate: rate,
    date: new Date().toISOString(),
  });
  list.sort(function (a, b) { return b.score - a.score; });
  const top = list.slice(0, 10);
  await env.LB.put(songId, JSON.stringify({ scores: top }, null, 1));
  return json({ ok: true, top: top });
}