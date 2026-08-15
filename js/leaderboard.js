/* =========================================================
 * 全局排行榜（leaderboard.js）
 * 读写走 uniCloud 阿里云版 云函数 URL化接口（api.next.bspapp.com），
 * 数据存于 uniCloud 云数据库，无需任何 token / 密钥。
 * ========================================================= */
(function () {
  "use strict";

  const API_BASE = "https://api.next.bspapp.com/leaderboard";

  /* 读取某首歌的前十 */
  async function fetchTop(songId) {
    try {
      const res = await fetch(API_BASE + "?song=" + encodeURIComponent(songId), { cache: "no-store" });
      if (!res.ok) return [];
      const j = await res.json();
      return j && j.code === 0 && Array.isArray(j.scores) ? j.scores : [];
    } catch (e) { return []; }
  }

  /* 提交一条成绩（云函数负责进前十校验与写入） */
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
      if (j && j.code === 0) return { ok: true, top: null };
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