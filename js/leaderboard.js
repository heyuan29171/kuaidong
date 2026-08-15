/* =========================================================
 * 全局排行榜（leaderboard.js）
 * 用 GitHub 仓库 leaderboard/<songId>.json 保存每首歌前十，
 * 通过 GitHub Contents API 读写，无需自建服务器。
 *
 * 使用前需：
 *   1. 在本仓库创建 leaderboard/ 目录（放一个占位文件即可）
 *   2. 在 GitHub 生成 fine-grained token，仅授予本仓库的
 *      Contents 读写权限（GitHub 只支持仓库级限制，不支持路径级）
 *   3. 把 TOKEN 填到下面
 * 详见 README「全局排行榜」一节。
 * ========================================================= */
(function () {
  "use strict";

  const TOKEN = "";   // ← 在此填入 fine-grained token（留空则排行榜功能禁用）
  const OWNER = "heyuan29171";
  const REPO = "kuaidong";
  const BRANCH = "main";
  const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;
  const RAW = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/leaderboard";

  function pathOf(songId) { return "leaderboard/" + encodeURIComponent(songId) + ".json"; }

  function b64(str) {
    if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(str)));
    return str;
  }

  async function getSha(path) {
    try {
      const res = await fetch(API + "/contents/" + path, {
        headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {},
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j.sha || null;
    } catch (e) { return null; }
  }

  /* 读取某首歌的前十（公开读取） */
  async function fetchTop(songId) {
    try {
      const res = await fetch(RAW + "/" + encodeURIComponent(songId) + ".json", { cache: "no-store" });
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j.scores) ? j.scores : [];
    } catch (e) { return []; }
  }

  /* 提交一条成绩并写回前十（并发冲突自动重试） */
  async function submit(entry) {
    if (!TOKEN) return { ok: false, reason: "not-configured" };
    const path = pathOf(entry.songId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const list = await fetchTop(entry.songId);
      list.push({
        playerId: entry.playerId,
        score: entry.score,
        rate: entry.rate,
        date: new Date().toISOString(),
      });
      list.sort(function (a, b) { return b.score - a.score; });
      const top = list.slice(0, 10);
      const body = {
        message: "成绩提交 " + entry.playerId + " " + entry.score,
        content: b64(JSON.stringify({ scores: top }, null, 1)),
      };
      const sha = await getSha(path);
      if (sha) body.sha = sha;
      const res = await fetch(API + "/contents/" + path, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + TOKEN,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 409) continue; /* 多人同时提交冲突，重试 */
      return { ok: res.ok, status: res.status, top: top };
    }
    return { ok: false, reason: "conflict" };
  }

  /* 结算后调用：是否进前十，进则弹窗让玩家输 ID 上榜 */
  async function maybeSubmit(song, result) {
    if (!TOKEN || !song || !result || result.score <= 0) return;
    try {
      const top = await fetchTop(song.id);
      const threshold = top.length < 10 ? 0 : top[top.length - 1].score;
      if (top.length < 10 || result.score >= threshold) {
        if (window.Main && Main.showRankSubmit) Main.showRankSubmit(song, result);
      }
    } catch (e) {}
  }

  window.Leaderboard = {
    fetchTop: fetchTop,
    submit: submit,
    maybeSubmit: maybeSubmit,
    isConfigured: function () { return !!TOKEN; },
  };
})();