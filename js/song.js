/* =========================================================
 * 曲库与谱面数据（song.js）
 * 内置曲使用 Web Audio 实时合成，无需任何音频文件。
 * 自定义曲（本地导入音频 + 编辑器编排）持久化在 localStorage。
 *
 * 音符字段：
 *   time  秒
 *   lane  0 左轨 / 1 右轨
 *   midi  旋律音高（可选，无则按轨道音色默认音高）
 *   dur   长按时长（秒），>0 表示长按音符
 * ========================================================= */
(function () {
  "use strict";

  const CUSTOM_KEY = "kuaidong_custom_songs";
  const BEST_KEY = "kuaidong_best";

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* ---------- 完整版和弦进行（BGM 与谱面共用，8 小节完整编曲） ---------- */
  const PROG_TWINKLE = [{ r: 60, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 },
                        { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 60, t: 4 }, { r: 55, t: 4 }]; // C G Am F G Am C G
  const PROG_CLOUD   = [{ r: 57, t: 3 }, { r: 50, t: 3 }, { r: 55, t: 4 }, { r: 60, t: 4 },
                        { r: 57, t: 3 }, { r: 50, t: 3 }, { r: 52, t: 4 }, { r: 57, t: 4 }]; // Am Dm G C Am Dm E Am
  const PROG_STAR    = [{ r: 60, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 }, { r: 55, t: 4 },
                        { r: 60, t: 4 }, { r: 53, t: 4 }, { r: 55, t: 4 }, { r: 60, t: 4 }]; // C Am F G C F G C
  const PROG_RAIN    = [{ r: 57, t: 3 }, { r: 52, t: 3 }, { r: 53, t: 4 }, { r: 55, t: 4 },
                        { r: 57, t: 3 }, { r: 53, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 4 }]; // Am Em F G Am F G Am
  const PROG_STORM   = [{ r: 50, t: 3 }, { r: 46, t: 4 }, { r: 53, t: 4 }, { r: 48, t: 4 },
                        { r: 50, t: 3 }, { r: 46, t: 4 }, { r: 48, t: 4 }, { r: 50, t: 4 }]; // Dm Bb F C Dm Bb C Dm
  const PROG_BLAZE   = [{ r: 50, t: 3 }, { r: 46, t: 4 }, { r: 45, t: 4 }, { r: 48, t: 4 },
                        { r: 50, t: 3 }, { r: 46, t: 4 }, { r: 43, t: 3 }, { r: 45, t: 4 }]; // Dm Bb F C Dm Bb Gm A
  const PROG_SHADOW  = [{ r: 52, t: 3 }, { r: 50, t: 3 }, { r: 48, t: 4 }, { r: 45, t: 4 },
                        { r: 52, t: 3 }, { r: 48, t: 4 }, { r: 45, t: 4 }, { r: 50, t: 3 }]; // Em Dm C A Em C A Dm

  /* ---------- 内置曲 1：小星星（童谣，C 大调） ---------- */
  /* beats >= 2 的音自动变成长按音符 */
  const TWINKLE = [
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
  ];

  /* ---------- 内置曲 2：云端漫步（原创，小调琶音，含双押与长按） ---------- */
  /* 数组元素 [midi, beats] 普通音；对象 {notes:[[midi,lane],...], beats} 表示双押/同按 */
  const CLOUD = [
    /* 第 1 小节 */
    [48,1], [72,0.5],[76,0.5], [48,1],[79,0.5],[76,0.5],
    {notes:[[48,0],[72,1]], beats:1}, {notes:[[79,1],[84,1]], beats:1},
    [48,1], [76,0.5],[72,0.5], [48,1],[67,0.5],[64,0.5],
    /* 第 2 小节 */
    [55,1], [72,0.5],[76,0.5], [55,1],[79,0.5],[76,0.5],
    {notes:[[55,0],[76,1]], beats:1}, [84,0.5],[79,0.5],
    [55,1], [76,0.5],[72,0.5], [55,1],[67,0.5],[64,0.5],
    /* 第 3 小节（含双轨长按） */
    [53,1], [72,0.5],[76,0.5], [53,1],[79,0.5],[76,0.5],
    {notes:[[53,0],[84,1]], beats:2},
    [53,1], [76,0.5],[72,0.5], [53,1],[67,0.5],[64,0.5],
    /* 第 4 小节 */
    [50,1], [72,0.5],[76,0.5], [50,1],[79,0.5],[76,0.5],
    {notes:[[50,0],[72,1]], beats:1}, [79,0.5],[76,0.5],
    [50,1], [76,0.5],[72,0.5], [50,1],[67,0.5],[64,0.5],
  ];

  function buildNotes(seq, bpm) {
    const spb = 60 / bpm;
    let t = 0;
    const notes = [];
    for (const item of seq) {
      if (Array.isArray(item)) {
        const [midi, beats, lane0] = item;
        notes.push({
          time: +t.toFixed(3),
          lane: lane0 != null ? lane0 : (midi >= 69 ? 1 : 0),
          midi: midi,
          dur: beats >= 2 ? +(beats * spb).toFixed(3) : 0,
        });
        t += beats * spb;
      } else {
        for (const [midi, lane] of item.notes) {
          notes.push({
            time: +t.toFixed(3),
            lane: lane,
            midi: midi,
            dur: item.beats >= 2 ? +(item.beats * spb).toFixed(3) : 0,
          });
        }
        t += item.beats * spb;
      }
    }
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    return notes;
  }

  /* ---------- 内置曲 3：星海航行（大调琶音，4/4） ---------- */
  function buildStarSeq() {
    const prog = PROG_STAR;
    const seq = [];
    for (let i = 0; i < 24; i++) {
      const ch = prog[i % prog.length];
      const r = ch.r, t3 = ch.t;
      const pats = [
        [r, r + 7, r + 12, t3 + 12],
        [r + 12, t3 + 12, r + 12, r + 7],
        [r, r + 7, r + 12, t3 + 12],
        [r + 12, r + 7, r + 12, r],
      ];
      const pat = pats[i % 4];
      /* 每 8 小节小节头加双押（低音 + 高音） */
      if (i > 0 && i % 8 === 0) {
        seq.push({ notes: [[r - 12, 0], [r + 12, 1]], beats: 1 });
      }
      for (let k = 0; k < 4; k++) {
        const m = pat[k];
        const lane = k % 2 === 0 ? 1 : 0;
        /* 每 4 小节的最后一个音变长按 */
        if (k === 3 && i % 4 === 3) {
          seq.push({ notes: [[m, lane]], beats: 2 });
        } else {
          seq.push([m, 1, lane]);
        }
      }
    }
    return seq;
  }

  /* ---------- 内置曲 4：雨夜霓虹（小调琶音，舒缓 4/4） ---------- */
  function buildRainSeq() {
    const prog = PROG_RAIN;
    const seq = [];
    for (let i = 0; i < 32; i++) {
      const ch = prog[i % prog.length];
      const r = ch.r, t3 = ch.t;
      const pats = [
        [r, r + 7, r + t3, r + 7],
        [r + 12, r + t3 + 12, r + 12, r + 7],
        [r, r + 7, r + t3, r + 12],
        [r + 12, r + 7, r + t3 + 12, r + 7],
      ];
      const pat = pats[i % 4];
      if (i > 0 && i % 8 === 0) {
        seq.push({ notes: [[r - 12, 0], [r + 12, 1]], beats: 1 });
      }
      for (let k = 0; k < 4; k++) {
        const m = pat[k];
        const lane = k % 2 === 0 ? 1 : 0;
        if (k === 3 && i % 4 === 2) {
          seq.push({ notes: [[m, lane]], beats: 2 });
        } else {
          seq.push([m, 1, lane]);
        }
      }
    }
    return seq;
  }

  /* ---------- 内置曲 5：疾速风暴（D 小调，150BPM 快节奏，16 分跑动） ---------- */
  function buildStormSeq() {
    const prog = PROG_STORM;
    const seq = [];
    for (let i = 0; i < 32; i++) {
      const ch = prog[i % prog.length];
      const r = ch.r, t3 = ch.t;
      /* 每 4 小节小节头加双押（低音 + 高音） */
      if (i > 0 && i % 4 === 0) {
        seq.push({ notes: [[r - 12, 0], [r + 12, 1]], beats: 1 });
      }
      if (i % 2 === 1) {
        /* 16 分音符小调音阶跑动（前 2 拍） + 琶音（后 2 拍） */
        const run = [r, r + 2, r + 3, r + 5, r + 7, r + 8, r + 10, r + 12];
        for (let k = 0; k < 8; k++) {
          seq.push([run[k], 0.25, k % 2 === 0 ? 1 : 0]);
        }
        const pat = [r + 12, r + 7, r + t3 + 12, r + 12];
        for (let k = 0; k < 4; k++) {
          seq.push([pat[k], 0.5, k % 2 === 0 ? 1 : 0]);
        }
      } else {
        /* 8 分音符琶音（快速交替） */
        const pat = [r, r + 7, r + t3, r + 12, r + 7, r + t3 + 12, r + 12, r + 7];
        for (let k = 0; k < 8; k++) {
          seq.push([pat[k], 0.5, k % 2 === 0 ? 1 : 0]);
        }
      }
    }
    return seq;
  }

  /* ---------- 内置曲 6：烈焰霓虹（D 小调，155BPM 高速电子，16 分跑动+双押+长按） ---------- */
  function buildBlazeSeq() {
    const prog = PROG_BLAZE;
    const seq = [];
    for (let i = 0; i < 40; i++) {
      const ch = prog[i % prog.length];
      const r = ch.r, t3 = ch.t;
      if (i % 2 === 1) {
        /* 16 分小调音阶急速跑动（2 拍）+ 双轨长按（2 拍） */
        const run = [r, r + 2, r + 3, r + 5, r + 7, r + 8, r + 10, r + 12];
        for (let k = 0; k < 8; k++) seq.push([run[k], 0.25, k % 2 === 0 ? 1 : 0]);
        seq.push({ notes: [[r + 12, 0], [r + 12, 1]], beats: 2 });
      } else {
        /* 8 分快速琶音（4 拍），第 3 拍换成双押 */
        const pat = [r + 12, r + 7, r + t3 + 12, r + 12, r + 7, r + t3 + 12, r + 12, r + 7];
        for (let k = 0; k < 8; k++) {
          if (k === 4) seq.push({ notes: [[pat[k], 0], [pat[k], 1]], beats: 0.5 });
          else seq.push([pat[k], 0.5, k % 2 === 0 ? 0 : 1]);
        }
      }
    }
    return seq;
  }

  /* ---------- 内置曲 7：暗影冲击（E 小调，160BPM 重击电子，切分+双押+长按） ---------- */
  function buildShadowSeq() {
    const prog = PROG_SHADOW;
    const seq = [];
    for (let i = 0; i < 36; i++) {
      const ch = prog[i % prog.length];
      const r = ch.r, t3 = ch.t;
      if (i % 3 === 2) {
        /* 16 分低音重击（2 拍）+ 双轨长按（2 拍） */
        const run = [r, r + 12, r + 7, r + 12, r, r + 12, r + 7, r + 12];
        for (let k = 0; k < 8; k++) seq.push([run[k], 0.25, k % 2 === 0 ? 0 : 1]);
        seq.push({ notes: [[r + 12, 0], [r + 12, 1]], beats: 2 });
      } else if (i % 3 === 1) {
        /* 16 分音阶上行爆发（2 拍）+ 单轨长按（2 拍） */
        const run = [r, r + 2, r + 3, r + 5, r + 7, r + 8, r + 10, r + 12];
        for (let k = 0; k < 8; k++) seq.push([run[k], 0.25, k % 2 === 0 ? 1 : 0]);
        seq.push({ notes: [[r + 12, 1]], beats: 2 });
      } else {
        /* 8 分切分琶音（4 拍），第 3 拍换成双押 */
        const pat = [r + 7, r + 12, r + t3 + 12, r + 12, r + 7, r + t3 + 12, r + 12, r + 7];
        for (let k = 0; k < 8; k++) {
          if (k === 4) seq.push({ notes: [[pat[k], 0], [pat[k], 1]], beats: 0.5 });
          else seq.push([pat[k], 0.5, k % 2 === 0 ? 0 : 1]);
        }
      }
    }
    return seq;
  }

  /* ---------- 难度分级：按音符密度 NPS（含长按时长加成） ---------- */
  function calcDifficulty(song) {
    const notes = song.notes || [];
    if (!notes.length) return { level: "简单", stars: 1 };
    const holdBonus = notes.reduce((s, n) => s + (n.dur || 0), 0);
    const playLen = Math.max(1, (notes[notes.length - 1].time || 1) + 1 + holdBonus * 0.4);
    const nps = notes.length / playLen;
    if (nps >= 4.0) return { level: "极难", stars: 4 };
    if (nps >= 2.3) return { level: "困难", stars: 3 };
    if (nps >= 1.7) return { level: "普通", stars: 2 };
    return { level: "简单", stars: 1 };
  }

  /* ---------- RKS 实力评分（参考 Phigros：定数 × 达成率系数） ---------- */
  const LEVEL_CONST = { "简单": 5, "普通": 8, "困难": 11, "极难": 14 };
  function levelConstant(level) { return LEVEL_CONST[level] || 7; }
  function rksOf(level, rate) {
    const c = levelConstant(level);
    const acc = Math.max(0, Math.min(100, Number(rate) || 0)) / 100;
    return Math.round(c * acc * acc * 100) / 100;
  }
  /* 总 RKS = 历史最佳 N 首的 RKS 平均（含自制曲；删除自制曲后其记录一并移除） */
  function totalRks(count) {
    const N = count || 10;
    const list = [];
    for (const id in BestStore.data) {
      const s = getSong(id);
      const b = BestStore.data[id];
      if (!s || !b || !(b.rate > 0)) continue;
      list.push(rksOf(s.level, b.rate));
    }
    list.sort((a, b) => b - a);
    const top = list.slice(0, N);
    if (!top.length) return 0;
    return Math.round((top.reduce((s, x) => s + x, 0) / top.length) * 100) / 100;
  }

  function builtinTwinkle(bpm) {
    const song = {
      id: "twinkle",
      title: "小星星",
      artist: "内置合成",
      genre: "童谣",
      bpm: 120,
      offset: 0.6,
      volume: 0.3,
      source: "synth",
      prog: PROG_TWINKLE,
      notes: buildNotes(TWINKLE, bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinCloud(bpm) {
    const song = {
      id: "cloud",
      title: "云端漫步",
      artist: "内置合成",
      genre: "原创",
      bpm: 96,
      offset: 0.8,
      volume: 0.3,
      source: "synth",
      prog: PROG_CLOUD,
      notes: buildNotes(CLOUD, bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinStar(bpm) {
    const song = {
      id: "star",
      title: "星海航行",
      artist: "内置合成",
      genre: "原创新曲",
      bpm: 120,
      offset: 0.8,
      volume: 0.3,
      source: "synth",
      prog: PROG_STAR,
      notes: buildNotes(buildStarSeq(), bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinRain(bpm) {
    const song = {
      id: "rain",
      title: "雨夜霓虹",
      artist: "内置合成",
      genre: "原创新曲",
      bpm: 100,
      offset: 0.8,
      volume: 0.3,
      source: "synth",
      prog: PROG_RAIN,
      notes: buildNotes(buildRainSeq(), bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinStorm(bpm) {
    const song = {
      id: "storm",
      title: "疾速风暴",
      artist: "内置合成",
      genre: "原创新曲",
      bpm: 150,
      offset: 0.8,
      volume: 0.3,
      source: "synth",
      prog: PROG_STORM,
      notes: buildNotes(buildStormSeq(), bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinBlaze(bpm) {
    const song = {
      id: "blaze",
      title: "烈焰霓虹",
      artist: "内置合成",
      genre: "高速电子",
      bpm: 155,
      offset: 0.6,
      volume: 0.3,
      source: "synth",
      prog: PROG_BLAZE,
      notes: buildNotes(buildBlazeSeq(), bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  function builtinShadow(bpm) {
    const song = {
      id: "shadow",
      title: "暗影冲击",
      artist: "内置合成",
      genre: "重击电子",
      bpm: 160,
      offset: 0.6,
      volume: 0.3,
      source: "synth",
      prog: PROG_SHADOW,
      notes: buildNotes(buildShadowSeq(), bpm),
    };
    Object.assign(song, calcDifficulty(song));
    return song;
  }

  const BUILTIN = [builtinTwinkle(120), builtinCloud(96), builtinStar(120), builtinRain(100), builtinStorm(150), builtinBlaze(155), builtinShadow(160)];

  /* ---------- 自定义曲持久化 ---------- */
  function loadJSON(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      if (s == null || s === "") return fallback;
      const v = JSON.parse(s);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  const CustomStore = {
    list: loadJSON(CUSTOM_KEY, []),
    add(song) {
      song.id = "c_" + Date.now().toString(36);
      song.source = "custom";
      song.volume = song.volume || 0.3;
      Object.assign(song, calcDifficulty(song));
      this.list.push(song);
      saveJSON(CUSTOM_KEY, this.list);
      dbPut("custom", this.list);
      return song;
    },
    remove(id) {
      this.list = this.list.filter((s) => s.id !== id);
      saveJSON(CUSTOM_KEY, this.list);
      dbPut("custom", this.list);
      /* 同步删除该曲的成绩 / RKS 记录，避免残留 */
      if (BestStore.data[id]) {
        delete BestStore.data[id];
        saveJSON(BEST_KEY, BestStore.data);
        dbPut("best", BestStore.data);
        syncToFile();
      }
    },
  };

  /* ---------- 最佳成绩 ---------- */
  const BestStore = {
    data: loadJSON(BEST_KEY, {}),
    get(id) { return this.data[id] || null; },
    update(id, stats) {
      const prev = this.data[id] || { score: 0, maxCombo: 0, rate: 0 };
      const isNew = stats.score > prev.score;
      if (isNew || stats.score === prev.score) {
        this.data[id] = {
          score: stats.score,
          maxCombo: stats.maxCombo,
          rate: stats.rate,
          date: stats.date || new Date().toISOString(),
        };
        saveJSON(BEST_KEY, this.data);
        dbPut("best", this.data);
        syncToFile();
      }
      return { prev, isNew };
    },
  };

  /* ---------- 全局设置（判定校准偏移，毫秒） ---------- */
  const Settings = {
    key: "kd_settings",
    data: (function () { try { return JSON.parse(localStorage.getItem("kd_settings") || "{}"); } catch (e) { return {}; } })(),
    get calMs() { return typeof this.data.calMs === "number" ? this.data.calMs : 0; },
    setCal(ms) {
      this.data.calMs = Math.max(-200, Math.min(200, Math.round(ms)));
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return this.data.calMs;
    },
    /* 音符流速：音符从顶部落到判定线的用时（秒），越小越快 */
    get noteSpeed() { return typeof this.data.noteSpeed === "number" ? this.data.noteSpeed : 1.3; },
    setSpeed(v) {
      this.data.noteSpeed = Math.min(2.5, Math.max(0.5, Math.round(v * 10) / 10));
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return this.data.noteSpeed;
    },
  };

  /* ---------- 存储可用性检测 ---------- */
  function storageOK() {
    try {
      const k = "kd_probe";
      localStorage.setItem(k, "1");
      const v = localStorage.getItem(k);
      localStorage.removeItem(k);
      return v === "1";
    } catch (e) { return false; }
  }

  function getAllSongs() {
    return BUILTIN.concat(CustomStore.list);
  }

  function getSong(id) {
    return getAllSongs().find((s) => s.id === id) || null;
  }

  /* ---------- 存档备份 / 恢复（成绩 + 自定义曲 + 设置） ---------- */
  function backup() {
    return JSON.stringify({
      v: 1,
      best: BestStore.data,
      custom: CustomStore.list,
      settings: Settings.data,
    }, null, 2);
  }
  function restore(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (!d || typeof d !== "object") throw new Error("格式不正确");
    if (d.best) { BestStore.data = d.best; saveJSON(BEST_KEY, d.best); }
    if (d.custom) { CustomStore.list = d.custom; saveJSON(CUSTOM_KEY, d.custom); }
    if (d.settings) { Settings.data = d.settings; try { localStorage.setItem(Settings.key, JSON.stringify(d.settings)); } catch (e) {} }
    return true;
  }

  /* 清空玩家记录：删除成绩、自编曲、设置、自制曲音频与文件夹授权（best、custom、audio 前缀、dirHandle）；
     游戏资源（内置曲音频缓存 builtin_audio 前缀）一律不动，避免清数据导致游戏无声 */
  function clearAll() {
    try { localStorage.removeItem(BEST_KEY); } catch (e) {}
    try { localStorage.removeItem(CUSTOM_KEY); } catch (e) {}
    try { localStorage.removeItem(Settings.key); } catch (e) {}
    BestStore.data = {};
    CustomStore.list = [];
    Settings.data = {};
    dirHandle = null;
    return new Promise((resolve) => {
      (async () => {
        try {
          const db = await openDB();
          if (db) {
            const tx = db.transaction(DB_STORE, "readwrite");
            const st = tx.objectStore(DB_STORE);
            const keys = await new Promise((res) => {
              const rq = st.getAllKeys();
              rq.onsuccess = () => res(rq.result || []);
              rq.onerror = () => res([]);
            });
            for (const k of keys) {
              if (typeof k === "string" && (k === "best" || k === "custom" || k === "dirHandle" || k.indexOf("audio_") === 0)) {
                try { st.delete(k); } catch (e) {}
              }
            }
          }
        } catch (e) {}
        resolve();
      })();
    });
  }

  /* 后台预渲染所有内置曲音频（缓存缺失时用于恢复声音） */
  async function preRenderBuiltin() {
    for (const s of BUILTIN) {
      try { await ensureBuiltinAudio(s); } catch (e) {}
    }
  }

  /* ---------- 文件夹持久化（File System Access API + IndexedDB 句柄） ---------- */
  let dirHandle = null;
  const DB_NAME = "kuaidong_db";
  const DB_STORE = "kv";
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbPromise;
  }
  async function dbPut(key, val) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((res) => {
      try {
        const tx = db.transaction(DB_STORE, "readwrite");
        const st = tx.objectStore(DB_STORE);
        st.put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
        tx.onabort = () => res(false);
      } catch (e) { res(false); }
    });
  }
  async function dbGet(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((res) => {
      try {
        const rq = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  function setDirHandle(h) {
    dirHandle = h;
    if (h) dbPut("dirHandle", h);
  }
  async function saveToFile() {
    if (!dirHandle) return false;
    try {
      const fh = await dirHandle.getFileHandle("kuaidong-save.json", { create: true });
      const w = await fh.createWritable();
      await w.write(backup());
      await w.close();
      return true;
    } catch (e) { return false; }
  }
  async function loadFromFile() {
    if (!dirHandle) return null;
    try {
      const fh = await dirHandle.getFileHandle("kuaidong-save.json");
      const f = await fh.getFile();
      return await f.text();
    } catch (e) { return null; }
  }
  function syncToFile() { return saveToFile(); }

  /* ---------- BGM 音频持久化（存 IndexedDB，key 为 audio_<id>） ---------- */
  function saveAudio(id, arrayBuffer) { return dbPut("audio_" + id, arrayBuffer); }
  async function getAudio(id) { return dbGet("audio_" + id); }

  /* 内置曲：把旋律+伴奏离线渲染成固定音频并存本地（渲染一次，之后直接播放） */
  async function ensureBuiltinAudio(song) {
    const key = "builtin_audio_v3_" + song.id;
    let buf = await dbGet(key);
    if (!buf) {
      try {
        buf = await window.AudioEngine.renderSong(song.notes, song.bpm, song.prog);
        if (buf) await dbPut(key, buf);
      } catch (e) { buf = null; }
    }
    return buf;
  }

  /* 页面加载：优先从 IndexedDB 恢复数据（file:// 下比 localStorage 稳定） */
  (async function restoreFromIDB() {
    try {
      let changed = false;
      const d = await dbGet("best");
      if (d && typeof d === "object" && Object.keys(d).length) {
        BestStore.data = d;
        saveJSON(BEST_KEY, d);
        changed = true;
      }
      const c = await dbGet("custom");
      if (Array.isArray(c) && c.length) {
        CustomStore.list = c;
        saveJSON(CUSTOM_KEY, c);
        changed = true;
      }
      if (changed) window.dispatchEvent(new Event("kd-restored"));
    } catch (e) {}
  })();

  /* 页面加载：若本地存储为空，尝试从文件夹存档自动恢复 */
  (async function autoRestore() {
    try {
      const h = await dbGet("dirHandle");
      if (h) {
        dirHandle = h;
        if (!Object.keys(BestStore.data).length) {
          const txt = await loadFromFile();
          if (txt) {
            try { restore(txt); } catch (e) {}
            window.dispatchEvent(new Event("kd-restored"));
          }
        }
      }
    } catch (e) {}
  })();

  function exportJSON(song) {
    const data = {
      title: song.title,
      artist: song.artist || "",
      bpm: song.bpm,
      offset: song.offset,
      volume: song.volume,
      notes: song.notes.map((n) => ({
        t: n.time, lane: n.lane,
        m: n.midi != null ? n.midi : 72,
        d: n.dur ? +n.dur.toFixed(3) : 0,
      })),
    };
    return JSON.stringify(data, null, 2);
  }

  window.SongLib = {
    midiToFreq,
    getAllSongs,
    getSong,
    BUILTIN,
    CustomStore,
    BestStore,
    Settings,
    calcDifficulty,
    levelConstant,
    rksOf,
    totalRks,
    exportJSON,
    backup,
    restore,
    clearAll,
    storageOK,
    setDirHandle,
    saveToFile,
    loadFromFile,
    syncToFile,
    saveAudio,
    getAudio,
    ensureBuiltinAudio,
    preRenderBuiltin,
  };
})();