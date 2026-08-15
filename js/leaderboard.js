/* =========================================================
 * 全局排行榜（leaderboard.js）
 * 读写全部走 Cloudflare Pages Functions 代理（/api/leaderboard），
 * 数据存于 Cloudflare KV，无任何 token / 密钥，浏览器端不接触凭据。
 * ========================================================= */
(function () {
  "use strict";

  const API_BASE = "/api/leaderboard";

  /* 读取某首歌的前十 */
  async function fetchTop(songId) {
    try {
      const res = await fetch(API_BASE + "?song=" + encodeURIComponent(songId), { cache: "no-store" });
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j.scores) ? j.scores : [];
    } catch (e) { return []; }
  }

  /* 提交一条成绩（服务端负责读-改-写与冲突重试） */
  async function submit(entry) {
    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: entry.songId,
          playerId: entry.playerId,
          score: entry.score,
          rate: entry.rate,
        }),
      });
      let j = null;
      try { j = await res.json(); } catch (e) {}
      if (j && j.ok) return { ok: true, top: j.top };
      return { ok: false, status: res.status, reason: (j && j.reason) || "network" };
    } catch (e) {
      return { ok: false, reason: "network" };
    }
  }

  /* 结算后调用：是否进前十，进则弹窗让玩家输 ID 上榜 */
  async function maybeSubmit(song, result) {
    if (!song || !result || result.score <= 0) return;
    try {
      const top = await fetchTop(song.id);
      const threshold = top.length < 10 ? 0 : top[top.length - 1].score;
      if (top.length < 10 || result.score >= threshold) {
        if (window.Main && window.Main.showRankSubmit) window.Main.showRankSubmit(song, result);
      }
    } catch (e) {}
  }

  window.Leaderboard = {
    fetchTop: fetchTop,
    submit: submit,
    maybeSubmit: maybeSubmit,
    isConfigured: function () { return true; },
  };
})();