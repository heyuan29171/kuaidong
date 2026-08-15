/* =========================================================
 * 双轨下落游戏核心（game.js）
 * 玩法：音符从轨道顶部下落，落入判定线中央的靶心圆圈即最佳时机。
 * 左轨：F / ←；右轨：J / →。普通音符敲击；长按音符按住不放；
 * 双押音符需两轨同时按下（有提示）。玩家敲击即演奏旋律。
 * ========================================================= */
(function () {
  "use strict";

  const APPROACH = 1.3;          // 音符提前多少秒开始下落（默认流速）
  let approach = APPROACH;     // 实际流速（可被设置覆盖）
  const JUDGE_LINE_RATIO = 0.78; // 判定线在轨道中的纵向比例
  const WINDOW = { perfect: 0.055, good: 0.13, miss: 0.16 };

  const $ = (id) => document.getElementById(id);
  const el = {
    notes: [$("notes-0"), $("notes-1")],
    pop: $("judge-pop"),
    hudScore: $("hud-score"),
    hudCombo: $("hud-combo"),
    avatarCombo: $("avatar-combo"),
    hudProgress: $("hud-progress"),
    songTitle: $("game-song-title"),
    songMeta: $("game-song-meta"),
    stateTip: $("game-state-tip"),
    result: $("result-panel"),
    res: {
      title: $("result-title"), score: $("res-score"), maxcombo: $("res-maxcombo"),
      perfect: $("res-perfect"), good: $("res-good"), miss: $("res-miss"),
      rate: $("res-rate"), record: $("res-record"), save: $("res-save"),
    },
  };

  /* ---------- 打歌助手角色 ---------- */
  function setAvatar(state) {
    const img = document.getElementById("avatar-img");
    const msg = document.getElementById("avatar-msg");
    if (!img) return;
    /* 切换图片 */
    const src = state === "perfect" ? "img/lycaon-happy.svg"
              : state === "good"    ? "img/lycaon-excite.svg"
              : state === "miss"    ? "img/lycaon-sad.svg"
              : "img/lycaon-idle.svg";
    img.src = src;
    /* 触发动画类 */
    img.classList.remove("jump", "nod", "dodge");
    if (state === "perfect") img.classList.add("jump");
    else if (state === "good") img.classList.add("nod");
    else if (state === "miss") img.classList.add("dodge");
    /* 气泡 */
    const txt = state === "perfect" ? "PERFECT" : state === "good" ? "GOOD" : "MISS";
    msg.textContent = txt;
    msg.className = "avatar-msg show " + state;
    clearTimeout(avatarTimer);
    avatarTimer = setTimeout(() => {
      img.src = "img/lycaon-idle.svg";
      img.classList.remove("jump", "nod", "dodge");
      msg.classList.remove("show");
    }, 700);
  }

  let state = "idle"; // idle | playing | finished
  let song = null;
  let audioBuf = null;
  let notes = [];          // [{time,lane,midi,dur,el,judged,result,holding,holdEl}]
  let baseTime = 0;
  let offset = 0;
  let songOffset = 0;
  let timer = null;
  let raf = null;
  let bgmSrc = null;
  let beatIndex = 0;
  let nextBeatTime = 0;
  let currentRoot = 60;       // 当前 BGM 和弦根音（判定音效/无固定音高音符跟随）
  let lastNoteTime = 0;
  let pxPerSec = 100;
  let held = [false, false];      // 当前按键按住状态
  let doubleTimes = {};           // time -> true（双押时刻）
  let barLines = [];              // 每小节辅助下落线
  let avatarTimer = null;
  let stats = { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0 };

  function judgeYpx() {
    const area = document.querySelector(".play-area");
    return area ? area.clientHeight * JUDGE_LINE_RATIO : 300;
  }

  function loadSong(songObj) {
    song = songObj;
    audioBuf = song.audioBuf || null;
    el.songTitle.textContent = song.title;
    el.songMeta.textContent =
      (song.artist || "") + " · " + song.bpm + " BPM · " + (song.level || "简单");
    el.stateTip.textContent = "按 A S D F / J K L ; 敲击到达判定线的音符，即将开始";
  }

  /* 加载 BGM 音频（上传曲=原曲音频；内置曲=本地渲染的固定旋律音频）；返回是否成功 */
  async function loadAudio() {
    audioBuf = null;
    if (!song) return true;
    try {
      if (song.audioId) {
        const ab = await SongLib.getAudio(song.audioId);
        if (!ab) { console.warn("BGM 音频缺失：", song.audioId); return false; }
        audioBuf = await AudioEngine.decodeFile(ab);
      } else if (song.source === "synth") {
        audioBuf = await SongLib.ensureBuiltinAudio(song);
        if (!audioBuf) { console.warn("内置曲 BGM 渲染失败"); return false; }
      } else {
        return true; /* 无 BGM 的自定义曲，只保留音符音效 */
      }
      if (state === "playing" && !bgmSrc && audioBuf) {
        bgmSrc = AudioEngine.playBuffer(audioBuf, AudioEngine.currentTime() + 0.05, false);
      }
      return !!audioBuf;
    } catch (e) { console.warn("BGM 加载失败：", e); return false; }
  }

  function start() {
    if (!song) return;
    const ctx = AudioEngine.ensureCtx();
    if (!ctx) return;
    state = "playing";
    songOffset = song.offset || 0;
    const calMs = (window.SongLib && window.SongLib.Settings) ? window.SongLib.Settings.calMs : 0;
    offset = songOffset + calMs / 1000;   /* 判定时间轴 = 歌曲偏移 + 玩家校准偏移 */
    approach = (window.SongLib && window.SongLib.Settings) ? (window.SongLib.Settings.noteSpeed || APPROACH) : APPROACH;
    pxPerSec = judgeYpx() / approach;
    notes = song.notes.slice().sort((a, b) => a.time - b.time || a.lane - b.lane).map((n) => ({
      time: n.time, lane: n.lane, midi: n.midi, dur: n.dur || 0,
      el: null, judged: false, result: null, holding: false,
    }));
    lastNoteTime = notes.length ? notes[notes.length - 1].time : 0;
    baseTime = ctx.currentTime + 0.2;
    beatIndex = 0;
    nextBeatTime = baseTime + songOffset; /* BGM 与鼓点只随歌曲偏移，不被校准影响 */
    held = [false, false];
    doubleTimes = {};

    /* 每小节辅助下落线（4 拍一条，节拍起点落在判定线） */
    document.querySelectorAll(".beat-line").forEach((x) => x.remove());
    const barDur0 = 4 * (60 / song.bpm);
    barLines = [];
    for (let t = 0; t <= lastNoteTime + barDur0; t += barDur0) {
      barLines.push({ time: +t.toFixed(3), el: null });
    }
    /* 双押检测：按时间分组（O(n)） */
    const byTime = {};
    for (let i = 0; i < notes.length; i++) {
      const t = notes[i].time;
      (byTime[+t.toFixed(3)] = byTime[+t.toFixed(3)] || []).push(notes[i].lane);
    }
    doubleTimes = {};
    for (const t in byTime) {
      const lanes = byTime[t];
      if (lanes.includes(0) && lanes.includes(1)) doubleTimes[+t] = true;
    }
    stats = { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0 };
    updateHud();
    el.res.record.textContent = "";
    $("result-panel").classList.add("hidden");
    el.pop.innerHTML = "";
    el.notes[0].innerHTML = "";
    el.notes[1].innerHTML = "";

    if (audioBuf) bgmSrc = AudioEngine.playBuffer(audioBuf, baseTime + songOffset, false);

    const spb = 60 / song.bpm;
    const prog = (song.prog && song.prog.length) ? song.prog : [{ r: 60, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 }];
    timer = setInterval(() => {
      const now = AudioEngine.currentTime();
      while (nextBeatTime < now + 0.12) {
        /* 每小节更新和弦根音（供判定音效/无固定音高音符跟随），不产生任何 BGM 声音 */
        if (beatIndex % 4 === 0) {
          const bar = Math.floor(beatIndex / 4);
          const ch = prog[bar % prog.length];
          currentRoot = ch.r;
        }
        beatIndex++;
        nextBeatTime += spb;
      }
    }, 25);

    raf = requestAnimationFrame(tick);
  }

  function elapsed() {
    return AudioEngine.currentTime() - baseTime - offset;
  }

  function tick() {
    if (state !== "playing") return;
    const now = elapsed();
    const jy = judgeYpx();

    /* 每小节辅助线下落 */
    for (const b of barLines) {
      if (!b.el && now >= b.time - approach) {
        const d = document.createElement("div");
        d.className = "beat-line";
        document.querySelector(".play-area").appendChild(d);
        b.el = d;
      }
      if (!b.el) continue;
      const p = Math.max(0, Math.min(1.05, (now - (b.time - approach)) / approach));
      b.el.style.top = p * jy + "px";
      if (p > 1) { b.el.remove(); b.el = null; }
    }

    for (const n of notes) {
      if (!n.el && now >= n.time - approach) spawnNoteEl(n);
      if (!n.el) continue;

      if (n.holding) {
        /* 长按：底部亮头钉在判定线上，条向上缩短 */
        const end = n.time + n.dur;
        if (now >= end) {
          completeHold(n);
        } else {
          const remain = Math.max(0, 1 - (now - n.time) / n.dur);
          const h = Math.max(10, pxPerSec * n.dur * remain);
          n.el.style.top = (jy - h) + "px";
          n.el.style.height = h + "px";
        }
      } else {
        const p = Math.max(0, Math.min(1.05, (now - (n.time - approach)) / approach));
        /* 底部亮头在下：元素顶端 = 头位置 - 条长 */
        n.el.style.top = (p * jy - pxPerSec * n.dur) + "px";
      }

      /* 自动漏判 */
      if (!n.judged && now - n.time > WINDOW.miss) {
        judgeNote(n, "miss");
      }
    }

    for (const n of notes) {
      if (n.el && n.judged && !n.holding && (now - n.time > 0.5)) {
        n.el.remove();
        n.el = null;
      }
    }

    if (lastNoteTime > 0) {
      const pct = Math.min(100, Math.round((now / lastNoteTime) * 100));
      el.hudProgress.textContent = pct + "%";
    }

    if (lastNoteTime > 0 && now > lastNoteTime + 1.2) {
      finish();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function spawnNoteEl(n) {
    const d = document.createElement("div");
    d.className = "note" + (n.dur > 0 ? " hold" : "");
    d.style.top = "0px";
    if (n.dur > 0) {
      /* 条从底部亮头向上延伸，头初始在轨道顶部 */
      d.style.height = pxPerSec * n.dur + "px";
      d.style.top = (-pxPerSec * n.dur) + "px";
    } else {
      d.textContent = "·";
    }
    /* 双押音符套金边 */
    if (doubleTimes[n.time]) d.classList.add("double");
    el.notes[n.lane].appendChild(d);
    n.el = d;
  }

  function judge(lane) {
    if (state !== "playing") return;
    held[lane] = true;
    const now = elapsed();
    let best = null;
    for (const n of notes) {
      if (n.lane !== lane || n.judged) continue;
      const dt = now - n.time;
      if (Math.abs(dt) > WINDOW.miss) continue;
      if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { n, dt };
    }
    if (!best) return;
    const dt = best.dt;
    const result = Math.abs(dt) <= WINDOW.perfect ? "perfect" : "good";
    judgeNote(best.n, result);
    AudioEngine.playNote(best.n, AudioEngine.currentTime(), song.volume, currentRoot);
  }

  /* 松开按键：长按提前松手记漏接，但结尾附近（0.2s 内）松手视为完成 */
  function release(lane) {
    if (state !== "playing") return;
    held[lane] = false;
    const now = elapsed();
    for (const n of notes) {
      if (n.lane === lane && n.judged && n.holding) {
        const remain = (n.time + n.dur) - now;
        if (remain > 0.2) judgeNote(n, "miss");
        else completeHold(n);
      }
    }
  }

  function judgeNote(n, result) {
    n.judged = true;
    n.result = result;
    if (result === "perfect") {
      stats.perfect++;
      stats.score += 100;
      stats.combo++;
      AudioEngine.sfxHit("perfect", currentRoot);
    } else if (result === "good") {
      stats.good++;
      stats.score += 50;
      stats.combo++;
      AudioEngine.sfxHit("good", currentRoot);
    } else {
      stats.miss++;
      stats.combo = 0;
      AudioEngine.sfxMiss(currentRoot);
    }
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    if (n.dur > 0 && result !== "miss") {
      n.holding = true; /* 长按开始保持 */
    }
    if (n.el) {
      n.el.classList.add(result === "miss" ? "missed" : "hit");
    }
    setAvatar(result);
    showPop(result);
    updateHud();
  }

  function completeHold(n) {
    n.holding = false;
    if (n.el) {
      n.el.classList.add("hold-done");
      setTimeout(() => {
        if (n.el) { n.el.remove(); n.el = null; }
      }, 120);
    }
  }

  function showPop(result) {
    const t = result === "perfect" ? "PERFECT" : result === "good" ? "GOOD" : "MISS";
    const d = document.createElement("div");
    d.className = "pop " + result;
    d.textContent = t;
    el.pop.appendChild(d);
    setTimeout(() => d.remove(), 400);
  }

  function updateHud() {
    el.hudScore.textContent = stats.score;
    el.hudCombo.textContent = stats.combo;
    if (el.avatarCombo) {
      el.avatarCombo.textContent = stats.combo;
      el.avatarCombo.classList.remove("pop");
      void el.avatarCombo.offsetWidth;
      if (stats.combo > 0) el.avatarCombo.classList.add("pop");
    }
  }

  function finish() {
    try {
      state = "finished";
      clearInterval(timer);
      timer = null;
      cancelAnimationFrame(raf);
      raf = null;
      document.querySelectorAll(".beat-line").forEach((x) => x.remove());
      barLines = [];
      if (bgmSrc) { try { bgmSrc.stop(); } catch (e) {} bgmSrc = null; }
      AudioEngine.silence();
      const total = stats.perfect + stats.good + stats.miss;
      const rate = total ? Math.round(((stats.perfect + stats.good) / total) * 100) : 0;
      el.res.title.textContent = song.title;
      el.res.score.textContent = stats.score;
      el.res.maxcombo.textContent = stats.maxCombo;
      el.res.perfect.textContent = stats.perfect;
      el.res.good.textContent = stats.good;
      el.res.miss.textContent = stats.miss;
      el.res.rate.textContent = rate + "%";
      el.res.record.textContent = "";
      el.result.classList.remove("hidden");
      el.stateTip.textContent = "完成！";

      /* 记录最佳成绩（不阻塞结算显示） */
      const r = SongLib.BestStore.update(song.id, {
        score: stats.score, maxCombo: stats.maxCombo, rate, date: new Date().toISOString(),
      });
      if (el.res.record) el.res.record.textContent = r.isNew ? "★ 新纪录！" : "";
      if (el.res.save) {
        el.res.save.textContent = "正在保存成绩…";
        SongLib.syncToFile().then((ok) => {
          const sv = document.getElementById("res-save");
          if (sv) sv.textContent = ok ? "✓ 成绩已保存到本地" : "已存入浏览器缓存（可点曲库「保存到本地文件夹」存到磁盘）";
        }).catch(() => {});
      }
    } catch (e) { /* 任何异常都不影响结算界面显示 */ }
  }

  function exit() {
    if (state === "playing" || state === "finished") {
      clearInterval(timer);
      timer = null;
      cancelAnimationFrame(raf);
      raf = null;
      document.querySelectorAll(".beat-line").forEach((x) => x.remove());
      barLines = [];
      if (bgmSrc) { try { bgmSrc.stop(); } catch (e) {} bgmSrc = null; }
      AudioEngine.silence();
      state = "idle";
      el.notes[0].innerHTML = "";
      el.notes[1].innerHTML = "";
      el.pop.innerHTML = "";
      $("result-panel").classList.add("hidden");
    }
  }

  /* 键位：左轨 A S D F，右轨 J K L ;（分号） */
  function keyToLane(key) {
    const k = String(key).toLowerCase();
    if (k === "a" || k === "s" || k === "d" || k === "f") return 0;
    if (k === "j" || k === "k" || k === "l" || k === ";") return 1;
    return -1;
  }

  /* 预热：预加载角色图 + 音频上下文，减少进谱面首帧卡顿 */
  function warmup() {
    ["lycaon-idle", "lycaon-happy", "lycaon-excite", "lycaon-sad"].forEach((n) => {
      const im = new Image();
      im.src = "img/" + n + ".svg";
    });
    AudioEngine.ensureCtx();
  }

  window.Game = {
    loadSong,
    loadAudio,
    start,
    exit,
    warmup,
    isPlaying() { return state === "playing"; },
    currentSong() { return song; },
    handleKey(e) {
      const lane = keyToLane(e.key);
      if (lane >= 0 && state === "playing") { judge(lane); e.preventDefault(); }
    },
    handleKeyUp(e) {
      const lane = keyToLane(e.key);
      if (lane >= 0) release(lane);
    },
    finish,
  };
})();