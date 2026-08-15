/* =========================================================
 * 主控（main.js）
 * 视图切换、曲库渲染、键盘绑定、全局事件。
 * ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------- 视图切换 ---------- */
  const views = ["menu", "game", "editor", "tutorial"];

  function showView(name) {
    if (name === "game") {
      /* 进入游戏 */
    } else {
      Game.exit();
    }
    if (name !== "editor") Editor.stopPlay();
    views.forEach((v) => {
      $("view-" + v).classList.toggle("active", v === name);
    });
    document.querySelectorAll(".nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    if (name === "menu") refresh();
  }

  /* ---------- 曲库 ---------- */
  function updateStorageStatus() {
    const el = $("storage-status");
    if (!el) return;
    if (!SongLib.storageOK()) {
      el.className = "storage-status warn";
      el.textContent = "⚠ 当前浏览器禁用了本地存储，成绩无法自动保存，请使用「导出存档」手动备份";
      return;
    }
    const cnt = Object.keys(SongLib.BestStore.data).length;
    el.className = "storage-status ok";
    el.textContent = cnt ? "✓ 成绩已自动保存在本地（" + cnt + " 首）" : "✓ 成绩将自动保存在本地";
  }

  /* 曲库排序 */
  const SORT_KEY = "kd_sort";
  function getSort() {
    try { return localStorage.getItem(SORT_KEY) || "default"; } catch (e) { return "default"; }
  }
  function setSort(v) {
    try { localStorage.setItem(SORT_KEY, v); } catch (e) {}
  }
  function sortSongs(songs) {
    const key = getSort();
    const scoreOf = (s) => { const b = SongLib.BestStore.get(s.id); return b ? b.score : 0; };
    const dateOf = (s) => { const b = SongLib.BestStore.get(s.id); return b && b.date ? b.date : ""; };
    const copy = songs.slice();
    switch (key) {
      case "title": return copy.sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh"));
      case "bpm": return copy.sort((a, b) => (b.bpm || 0) - (a.bpm || 0));
      case "stars": return copy.sort((a, b) => (b.stars || 1) - (a.stars || 1));
      case "notes": return copy.sort((a, b) => (b.notes ? b.notes.length : 0) - (a.notes ? a.notes.length : 0));
      case "best": return copy.sort((a, b) => scoreOf(b) - scoreOf(a));
      case "recent": return copy.sort((a, b) => (dateOf(b) > dateOf(a) ? 1 : dateOf(b) < dateOf(a) ? -1 : 0));
      default: return copy;
    }
  }

  function refresh() {
    const list = $("song-list");
    const songs = sortSongs(SongLib.getAllSongs());
    list.innerHTML = "";
    updateStorageStatus();
    if (!songs.length) {
      list.innerHTML = '<p class="sub">曲库为空</p>';
      return;
    }
    for (const s of songs) {
      const card = document.createElement("div");
      card.className = "song-card";
      const isCustom = s.source === "custom";
      const noteCount = s.notes ? s.notes.length : 0;
      const stars = "★".repeat(Math.max(1, s.stars || 1)) + "☆".repeat(4 - Math.max(1, s.stars || 1));
      const best = SongLib.BestStore.get(s.id);
      const bestTxt = best
        ? '<div class="best">最佳 ' + best.score + " 分 · 达成 " + best.rate + "%</div>"
        : '<div class="best none">暂无成绩</div>';
      card.innerHTML =
        '<div class="tag ' + (isCustom ? "custom" : "synth") + '">' +
        (isCustom ? "自定义" : "内置合成") + "</div>" +
        '<div class="name">' + esc(s.title) + "</div>" +
        '<div class="meta">' + esc(s.artist || "") + " · " + s.bpm + " BPM · " + noteCount + " 音符 · " +
        '<span class="stars" title="' + esc(s.level || "简单") + '">' + stars + "</span>" +
        " · " + esc(s.level || "简单") +
        (s.audioId ? " · <span class='bgm-yes'>有 BGM</span>" : (s.source === "synth" ? " · 内置 BGM" : " · <span class='bgm-no'>无 BGM</span>")) +
        "</div>" +
        bestTxt +
        '<div class="ops">' +
        '<button class="btn primary" data-act="play">游玩</button>' +
        '<button class="btn" data-act="edit">编辑谱面</button>' +
        "</div>" +
        (isCustom ? '<button class="del" data-act="del" title="删除">×</button>' : "");
      card.querySelector('[data-act="play"]').addEventListener("click", () => playSong(s));
      card.querySelector('[data-act="edit"]').addEventListener("click", () => editSong(s));
      if (isCustom) {
        card.querySelector('[data-act="del"]').addEventListener("click", () => {
          if (confirm("删除《" + s.title + "》？")) {
            SongLib.CustomStore.remove(s.id);
            refresh();
          }
        });
      }
      list.appendChild(card);
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function playSong(song) {
    Game.loadSong(song);
    showView("game");
    /* 预热音频 + 预加载角色图，避免进谱面卡顿 */
    Game.warmup();
    const st = document.getElementById("bgm-status");
    if (st) st.textContent = "BGM 加载中…";
    const ok = await Game.loadAudio();
    if (!ok) {
      if (st) st.textContent = "BGM 加载失败（音频缺失或渲染失败）";
      alert("BGM 音频加载失败：谱面绑定的音频不存在或已损坏。请删除后重新导入音频再保存。");
      setTimeout(() => { showView("library"); }, 1200);
      return;
    }
    if (st) st.textContent = song.audioId || song.source === "synth" ? "BGM 就绪" : "";
    setTimeout(() => Game.start(), 400);
  }

  function editSong(song) {
    Editor.open(song);
    showView("editor");
  }

  /* ---------- 键盘 ---------- */
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const active = document.querySelector(".view.active");
    if (!active) return;
    if (active.id === "view-game" && Game.isPlaying()) {
      Game.handleKey(e);
    } else if (active.id === "view-editor") {
      if (e.code === "Space") { Editor.playToggle(); e.preventDefault(); }
    }
  });
  window.addEventListener("keyup", (e) => {
    const active = document.querySelector(".view.active");
    if (active && active.id === "view-game") Game.handleKeyUp(e);
  });

  /* ---------- 顶栏导航 ---------- */
  document.querySelectorAll(".nav button").forEach((b) => {
    b.addEventListener("click", () => showView(b.dataset.view));
  });

  /* ---------- 游戏区按钮 ---------- */
  $("btn-back-menu").addEventListener("click", () => showView("menu"));
  $("btn-game-back").addEventListener("click", () => showView("menu"));
  $("btn-retry").addEventListener("click", () => Game.start());
  $("btn-to-menu").addEventListener("click", () => showView("menu"));

  /* ---------- 判定校准 ---------- */
  const CALIB_T = 1.6;      /* 校准音符节拍间隔（秒） */
  const CALIB_TARGET = 8;   /* 采样次数 */
  const calib = { running: false, timer: null, base: 0, k: 0, runs: [], notes: [], tos: [] };

  function calibStatus(txt) {
    $("calib-status").innerHTML = txt;
  }
  function calibJudgeY() {
    return $("calib-play").querySelector(".calib-judge").offsetTop;
  }
  function calibAvg() {
    return calib.runs.length ? Math.round(calib.runs.reduce((a, b) => a + b, 0) / calib.runs.length) : 0;
  }
  function calibSign(ms) {
    return ms > 0 ? "晚了" : ms < 0 ? "早了" : "正好";
  }
  function calibFlash() {
    const f = document.createElement("div");
    f.className = "calib-flash";
    $("calib-play").appendChild(f);
    setTimeout(() => f.remove(), 600);
  }
  function startCalib() {
    if (!AudioEngine.ensureCtx()) return;
    stopCalib();
    calib.running = true;
    calib.base = AudioEngine.currentTime() + 0.8;
    calib.k = 0;
    calib.runs = [];
    $("calib-start").hidden = true;
    $("calib-reset").hidden = false;
    $("calib-apply").hidden = true;
    calibStatus("跟着节拍敲击 —— 音符在左轨按 <b>A S D F</b>，右轨按 <b>J K L ;</b>；每 4 拍会有一次重音“咚”（0/" + CALIB_TARGET + "）");
    calib.timer = setInterval(() => {
      const now = AudioEngine.currentTime();
      /* 提前一整拍创建音符，让音符从顶部清晰地下落到判定线 */
      while (calib.base + calib.k * CALIB_T < now + CALIB_T) spawnCalibNote(calib.k++);
    }, 25);
  }
  function spawnCalibNote(k) {
    const playEl = $("calib-play");
    const lane = k % 2;
    const hitAt = calib.base + k * CALIB_T;
    const now = AudioEngine.currentTime();
    /* 卡点 BGM（参考 Cytus 式“嗒嗒嗒咚”四拍循环）：
     * 每拍镲 + 鼓；每 4 拍小节的起始拍加重低频“咚”并配和弦 */
    const downbeat = k % 4 === 0;
    AudioEngine.hat(hitAt - CALIB_T / 2, 0.18);
    AudioEngine.kick(hitAt, downbeat ? 0.6 : 0.35);
    if (downbeat) {
      AudioEngine.pluck(55, hitAt, 0.5, 0.45, "sine");
      const prog = [{ r: 60, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 }];
      const ch = prog[(k / 4) % prog.length];
      AudioEngine.playPad(ch.r, hitAt, ch.t, CALIB_T * 4 * 1.05, 0.35);
    }
    const n = document.createElement("div");
    n.className = "calib-note";
    playEl.querySelector(".calib-lane-" + lane).appendChild(n);
    const obj = { lane: lane, hitAt: hitAt, el: n, judged: false };
    calib.notes.push(obj);
    const dur = Math.max(0.05, hitAt - now);
    requestAnimationFrame(() => {
      n.style.transitionDuration = dur + "s";
      n.style.top = calibJudgeY() + "px";
    });
    calib.tos.push(setTimeout(() => {
      if (!obj.judged) {
        obj.judged = true;
        n.classList.add("missed");
        calibStatus("漏了第 " + (k + 1) + " 个，继续跟着节拍敲击");
      }
    }, dur * 1000 + 260));
  }
  function measureCalib(lane) {
    if (!calib.running) return;
    const now = AudioEngine.currentTime();
    let best = null;
    for (const n of calib.notes) {
      if (!n.judged && n.lane === lane && now - n.hitAt < 0.35) {
        if (!best || n.hitAt < best.hitAt) best = n;
      }
    }
    if (!best) return;
    best.judged = true;
    const ms = Math.round((now - best.hitAt) * 1000);
    calibFlash();
    if (Math.abs(ms) > 300) {
      calibStatus("这次偏差太大（" + ms + " ms），请跟着节拍敲击");
      return;
    }
    calib.runs.push(ms);
    if (calib.runs.length >= CALIB_TARGET) finishCalib();
    else calibStatus("第 " + calib.runs.length + " 次：<b>" + ms + " ms</b>（" + calibSign(ms) + "）· 平均 <b>" + calibAvg() + " ms</b>");
  }
  function finishCalib() {
    stopCalib();
    const avg = calibAvg();
    const sug = -avg;
    calibStatus("完成！平均偏差 <b>" + avg + " ms</b>（" + calibSign(avg) + "）→ 建议校准值 <b>" + sug + " ms</b>");
    $("calib-reset").hidden = false;
    $("calib-apply").hidden = false;
    $("calib-apply").textContent = "应用建议值（" + sug + " ms）";
  }
  function stopCalib() {
    calib.running = false;
    clearInterval(calib.timer);
    calib.timer = null;
    calib.tos.forEach((t) => clearTimeout(t));
    calib.tos = [];
    calib.notes = [];
    $("calib-play").querySelectorAll(".calib-note, .calib-flash").forEach((x) => x.remove());
  }

  function openCalib() {
    stopCalib();
    $("calib-modal").classList.remove("hidden");
    updateCalibVal();
    updateSpeedVal();
  }
  function updateCalibVal() {
    $("calib-val").textContent = SongLib.Settings.calMs;
  }
  function updateSpeedVal() {
    $("speed-val").textContent = SongLib.Settings.noteSpeed.toFixed(1);
  }
  $("btn-calib").addEventListener("click", openCalib);

  /* ---------- 我的成绩 ---------- */
  function openScores() {
    const box = $("scores-list");
    const songs = SongLib.getAllSongs();
    const rows = [];
    for (const s of songs) {
      const b = SongLib.BestStore.get(s.id);
      rows.push({ title: s.title, artist: s.artist || "", b: b || null });
    }
    rows.sort((a, b2) => ((b2.b ? b2.b.score : -1) - (a.b ? a.b.score : -1)));
    box.innerHTML = "";
    if (!rows.some((r) => r.b)) {
      box.innerHTML = '<p class="sub">还没有成绩，快去玩一局吧</p>';
    } else {
      const played = rows.filter((r) => r.b);
      const head = document.createElement("div");
      head.className = "score-row";
      head.innerHTML = '<div class="score-name">共 ' + played.length + " / " + rows.length + " 首完成</div>" +
        '<div class="score-date">最佳成绩按分数排序</div>';
      box.appendChild(head);
      for (const r of rows) {
        const d = document.createElement("div");
        d.className = "score-row" + (r.b ? "" : " none");
        d.innerHTML = r.b
          ? '<div class="score-name">' + esc(r.title) + "</div>" +
            '<div class="score-val">' + r.b.score + " 分 · " + r.b.rate + "%</div>" +
            '<div class="score-date">连击 ' + r.b.maxCombo + "</div>"
          : '<div class="score-name">' + esc(r.title) + "</div>" +
            '<div class="score-val">未游玩</div>';
        box.appendChild(d);
      }
    }
    $("scores-modal").classList.remove("hidden");
  }
  $("btn-scores").addEventListener("click", openScores);
  $("btn-scores-close").addEventListener("click", () => $("scores-modal").classList.add("hidden"));

  $("calib-close").addEventListener("click", () => { stopCalib(); $("calib-modal").classList.add("hidden"); });
  $("calib-plus").addEventListener("click", () => {
    SongLib.Settings.setCal(SongLib.Settings.calMs + 5);
    updateCalibVal();
  });
  $("calib-minus").addEventListener("click", () => {
    SongLib.Settings.setCal(SongLib.Settings.calMs - 5);
    updateCalibVal();
  });
  $("speed-plus").addEventListener("click", () => {
    SongLib.Settings.setSpeed(SongLib.Settings.noteSpeed + 0.1);
    updateSpeedVal();
  });
  $("speed-minus").addEventListener("click", () => {
    SongLib.Settings.setSpeed(SongLib.Settings.noteSpeed - 0.1);
    updateSpeedVal();
  });
  $("calib-start").addEventListener("click", startCalib);
  $("calib-reset").addEventListener("click", startCalib);
  $("calib-apply").addEventListener("click", () => {
    SongLib.Settings.setCal(Math.round(-calibAvg()));
    updateCalibVal();
    calibStatus("已应用建议值，下一次游玩生效（当前 " + SongLib.Settings.calMs + " ms）");
    $("calib-apply").hidden = true;
  });
  window.addEventListener("keydown", (e) => {
    if (!calib.running || e.repeat) return;
    const lane = ["KeyA", "KeyS", "KeyD", "KeyF"].includes(e.code) ? 0
      : (["KeyJ", "KeyK", "KeyL", "Semicolon"].includes(e.code) ? 1 : -1);
    if (lane >= 0) measureCalib(lane);
  });

  /* ---------- 曲库导入音频 ---------- */
  $("btn-import-audio").addEventListener("click", () => $("audio-file").click());
  $("audio-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    Editor.loadAudio(f);
    showView("editor");
    e.target.value = "";
  });

  /* ---------- 存档导出 / 导入 ---------- */
  $("btn-backup").addEventListener("click", () => {
    try {
      const blob = new Blob([SongLib.backup()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kuaidong-save.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { alert("导出失败：" + err.message); }
  });
  $("btn-restore").addEventListener("click", () => $("backup-file").click());
  $("backup-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        SongLib.restore(reader.result);
        refresh();
        alert("存档已导入");
      } catch (err) { alert("导入失败：" + err.message); }
    };
    reader.readAsText(f);
    e.target.value = "";
  });

  /* ---------- 保存到本地文件夹（File System Access API） ---------- */
  $("btn-dir").addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      alert("当前浏览器不支持文件夹保存，请改用「导出存档 / 导入存档」");
      return;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: "readwrite" });
      SongLib.setDirHandle(h);
      /* 尝试从文件夹里的存档恢复（若文件里有成绩） */
      let restored = false;
      const txt = await SongLib.loadFromFile();
      if (txt) {
        try { SongLib.restore(txt); restored = true; } catch (e) {}
      }
      /* 写入最新存档 */
      const ok = await SongLib.saveToFile();
      refresh();
      alert(ok
        ? (restored ? "已恢复成绩并存回文件" : "已关联文件夹，之后成绩会自动保存到其中")
        : "写入失败");
    } catch (e) {
      if (e && e.name === "AbortError") return; /* 用户取消 */
      alert("授权或保存失败：" + (e && e.message ? e.message : e));
    }
  });

  /* ---------- 编辑器按钮 ---------- */
  $("btn-editor-back").addEventListener("click", () => showView("menu"));
  $("btn-play").addEventListener("click", () => Editor.playToggle());
  $("btn-clear").addEventListener("click", () => Editor.clear());
  $("btn-save").addEventListener("click", () => Editor.save());
  $("btn-export").addEventListener("click", () => Editor.exportJSON());
  $("btn-ed-audio").addEventListener("click", () => $("ed-audio-file").click());
  $("btn-autogen").addEventListener("click", () => Editor.autoGen());
  $("ed-audio-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    Editor.loadAudio(f);
    e.target.value = "";
  });

  ["ed-bpm", "ed-offset", "ed-snap"].forEach((id) => {
    $(id).addEventListener("input", () => Editor.redraw());
  });

  /* 窗口变化时重绘编辑器 */
  window.addEventListener("resize", () => Editor.redraw());

  /* 首次启动：确保音频上下文可被用户手势解锁 */
  document.addEventListener("pointerdown", () => AudioEngine.ensureCtx(), { once: true });

  window.Main = { refresh, showView };

  /* 曲库排序下拉 */
  $("sort-select").value = getSort();
  $("sort-select").addEventListener("change", (e) => { setSort(e.target.value); refresh(); });

  /* 存档从文件夹自动恢复后，刷新界面显示成绩 */
  window.addEventListener("kd-restored", refresh);

  refresh();
  Editor.redraw();
})();