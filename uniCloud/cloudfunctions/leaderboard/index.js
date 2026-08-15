/* 全局排行榜云函数（uniCloud 阿里云版）
 * URL化后通过 HTTP 访问：
 *   GET  https://api.next.bspapp.com/leaderboard?song=<songId>   读取前十
 *   POST https://api.next.bspapp.com/leaderboard                 提交一条成绩
 */
const db = uniCloud.database();
const COLLECTION = "leaderboard";

const MAX_SCORE = 10000000;

function strip(doc) {
  return {
    playerId: doc.playerId,
    score: doc.score,
    rate: doc.rate,
    date: doc.date,
  };
}

exports.main = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();

  /* 读取前十 */
  if (method === "GET" || method === "HEAD") {
    const qp = event.queryStringParameters || {};
    const song = (qp.song || "").toString();
    if (!song) return { code: 400, reason: "missing song" };
    try {
      const res = await db
        .collection(COLLECTION)
        .where({ songId: song })
        .orderBy("score", "desc")
        .limit(10)
        .get();
      return { code: 0, scores: (res.data || []).map(strip) };
    } catch (e) {
      return { code: 500, reason: "db error" };
    }
  }

  /* 提交成绩 */
  if (method === "POST") {
    let body;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
    } catch (e) {
      return { code: 400, reason: "bad json" };
    }
    const songId = (body.songId || "").toString();
    const playerId = (body.playerId || "").toString().trim();
    const score = Number(body.score);
    const rate = Number(body.rate) || 0;

    if (!songId) return { code: 400, reason: "missing songId" };
    if (!playerId) return { code: 400, reason: "missing playerId" };
    if (playerId.length > 16) return { code: 400, reason: "id too long" };
    if (!isFinite(score) || score <= 0 || score > MAX_SCORE) return { code: 400, reason: "bad score" };

    try {
      const cur = await db
        .collection(COLLECTION)
        .where({ songId: songId })
        .orderBy("score", "desc")
        .limit(10)
        .get();
      const top = cur.data || [];
      /* 防刷：只有进前十才写入 */
      if (top.length >= 10 && score < top[top.length - 1].score) {
        return { code: 403, reason: "not in top10" };
      }
      const addRes = await db.collection(COLLECTION).add({
        songId: songId,
        playerId: playerId,
        score: score,
        rate: rate,
        date: new Date().toISOString(),
      });
      return { code: 0, ok: true, id: addRes.id };
    } catch (e) {
      return { code: 500, reason: "db error" };
    }
  }

  return { code: 405, reason: "method not allowed" };
};