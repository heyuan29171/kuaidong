/* =========================================================
 * Web Audio 引擎（audio.js）
 * 负责：音频上下文管理、旋律/鼓点实时合成、本地音频解码播放。
 * 所有发声均用 Web Audio 精确时间调度，与谱面时间对齐。
 * ========================================================= */
(function () {
  "use strict";

  let ctx = null;
  let master = null;
  const bgmSources = new Set();   // 正在播放的 BGM source（统一管理，避免残留叠加）

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1.0;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* 拨弦音色：可指定波形，指数包络；方波自动低通柔和并减响 */
  function pluck(freq, t, vol, dur, type) {
    const c = ensureCtx();
    if (!c) return;
    vol = vol == null ? 0.5 : vol;
    dur = dur == null ? 0.3 : dur;
    type = type || "triangle";
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (type === "square") {
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      o.connect(lp);
      lp.connect(g);
    } else {
      o.connect(g);
    }
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* 底鼓 */
  function kick(t, vol) {
    const c = ensureCtx();
    if (!c) return;
    vol = vol == null ? 0.6 : vol;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /* 踩镲（半拍） */
  function hat(t, vol) {
    const c = ensureCtx();
    if (!c) return;
    vol = vol == null ? 0.1 : vol;
    const src = c.createBufferSource();
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  }

  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* 触发一个谱面音符对应的音色：
   * 按谱面 midi 演奏真实旋律；左右轨仍用音色区分（左三角波、右方波）。
   * keyMidi = 当前 BGM 和弦根音：无固定音高的音符会自动落在和弦音上，跟 BGM 走 */
  function playNote(note, t, songVolume, keyMidi) {
    const vol = (songVolume || 0.3) * (note.lane === 1 ? 0.9 : 1.7);
    const type = note.lane === 1 ? "square" : "triangle";
    let midi = note.midi;
    if (midi == null) {
      const root = keyMidi != null ? keyMidi : 60;
      midi = root + 12 + (note.lane === 1 ? 7 : 0);
    }
    const freq = midiFreq(midi);
    const dur = (note.dur && note.dur > 0.2) ? note.dur : 0.32;
    pluck(freq, t, vol, dur, type);
  }

  /* 节拍器 tick（编辑器用） */
  function metronome(t, isDown) {
    if (isDown) kick(t, 0.5);
    else hat(t, 0.1);
  }

  /* 解码本地音频文件 */
  function decodeFile(arrayBuffer) {
    const c = ensureCtx();
    if (!c) return Promise.reject(new Error("无音频上下文"));
    return c.decodeAudioData(arrayBuffer);
  }

  /* 播放 AudioBuffer（作为 BGM），返回 AudioBufferSourceNode；track=true 时纳入统一管理，stopBGM() 可一次全部停止 */
  function playBuffer(buf, when, loop, offset, track) {
    const c = ensureCtx();
    if (!c) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;
    const g = c.createGain();
    g.gain.value = 0.7;
    src.connect(g);
    g.connect(master);
    if (track) {
      bgmSources.add(src);
      src.onended = () => bgmSources.delete(src);
    }
    src.start(when || 0, offset || 0);
    return src;
  }

  /* 停止所有正在播放的 BGM（暂停 / 重开 / 退出 / 结算前统一调用，确保不会新旧 BGM 叠加） */
  function stopBGM() {
    const c = ensureCtx();
    if (!c) { bgmSources.clear(); return; }
    for (const s of bgmSources) { try { s.stop(); } catch (e) {} }
    bgmSources.clear();
  }

  /* 清脆铃音：基频三角波 + 高频泛音，快速衰减 */
  function bell(freq, t, vol, bright, dur) {
    const c = ensureCtx();
    if (!c) return;
    bellAt(c, freq, t, vol, bright, dur);
  }
  function bellAt(c, freq, t, vol, bright, dur) {
    const parts = [1, 2.01, 3.02];
    const gains = [1, bright * 0.55, bright * 0.25];
    const durs = [dur, dur * 0.62, dur * 0.42];
    for (let i = 0; i < parts.length; i++) {
      const o = c.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.setValueAtTime(freq * parts[i], t);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(vol * gains[i], 0.0002), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durs[i]);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + durs[i] + 0.05);
    }
  }

  /* 把内置曲离线渲染成一段固定音频（旋律 + 轻柔和声 + 贝斯 + 轻鼓），返回 AudioBuffer */
  async function renderSong(notes, bpm, prog) {
    const sr = 44100;
    const spb = 60 / bpm;
    let last = 0;
    for (const n of notes) last = Math.max(last, n.time + (n.dur || 0.5));
    const dur = last + 2.5;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const progArr = (prog && prog.length) ? prog : [{ r: 60, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 }];
    const barDur = spb * 4;
    const bars = Math.max(1, Math.ceil(last / barDur) + 1);
    /* 伴奏层：每小节和声 + 贝斯 + 鼓 */
    for (let b = 0; b < bars; b++) {
      const ch = progArr[b % progArr.length];
      const barT = b * barDur;
      padAt(off, ch.r, ch.t, barT, barDur * 1.35, 0.28);
      bassAt(off, ch.r - 12, barT, barDur * 0.95, 0.5);
      for (let k = 0; k < 4; k++) {
        kickAt(off, barT + k * spb, k === 0 ? 0.3 : 0.16);
        hatAt(off, barT + k * spb, 0.14);
      }
    }
    /* 旋律层：八音盒播放谱面旋律 */
    for (const n of notes) {
      const midi = n.midi != null ? n.midi : 72;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const nd = (n.dur && n.dur > 0.2) ? n.dur : 0.5;
      bellAt(off, freq, n.time, 0.7, 0.35, nd);
    }
    return off.startRendering();
  }

  /* 柔和和声：根音 + 三度 + 五度 + 八度，长包络（渲染用） */
  function padAt(c, rootMidi, t3, t, dur, vol) {
    const parts = [rootMidi, rootMidi + t3, rootMidi + 7, rootMidi + 12];
    for (const m of parts) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(midiFreq(m), t);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(vol / parts.length, 0.0002), t + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  /* 贝斯：三角波低音（渲染用） */
  function bassAt(c, freq, t, dur, vol) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(vol, 0.0002), t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /* 底鼓：正弦滑音（渲染用） */
  function kickAt(c, t, vol) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.3);
  }

  /* 踩镲：噪声高通（渲染用） */
  function hatAt(c, t, vol) {
    const len = Math.max(1, Math.floor(c.sampleRate * 0.09));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(vol, 0.0002), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp);
    hp.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.stop(t + 0.1);
  }

  /* 打击音效（音游惯例：短促噪声咔嗒，attack 尖锐，50-200ms）
   * highpass 越高声音越清脆，低越高则越闷 */
  function percNoise(t, vol, highpass, dur) {
    const c = ensureCtx();
    if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = highpass;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  }

  /* 和弦铺底 pad：三角波（更亮），根音 + 高八度 + 三度 + 五度，柔和衬底 */
  function playPad(rootMidi, t, thirdOffset, dur, vol) {
    const c = ensureCtx();
    if (!c) return;
    vol = vol == null ? 0.16 : vol;
    const root = 440 * Math.pow(2, (rootMidi - 69) / 12);
    const f3 = root * Math.pow(2, thirdOffset / 12);
    const f5 = root * Math.pow(2, 7 / 12);
    const parts = [
      { f: root, w: 1.0 },
      { f: root * 2, w: 0.55 },
      { f: f3, w: 0.75 },
      { f: f5, w: 0.7 },
    ];
    parts.forEach((p) => {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(p.f, t);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * p.w, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }

  /* 判定反馈音：三种都是短促打击声（音调都在打击声范围），
   * 频率层次不同且清脆，极易分辨，且跟随 BGM 当前和弦根音（rootMidi）：
   *  PERFECT = 高频清脆“嗒” + 冲击 + 合调微铃
   *  GOOD    = 中频“嗒”
   *  MISS    = 根音低八度的“咚” */
  function sfxHit(judge, rootMidi) {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime;
    if (judge === "perfect") {
      kick(t, 0.3);                                  // 低频冲击
      percNoise(t, 0.3, 3200, 0.045);                // 清脆高频嗒
      bell(midiFreq((rootMidi != null ? rootMidi : 72) + 12 + 7), t, 0.1, 0.5, 0.06); // 根音上方纯五度
    } else {
      percNoise(t, 0.22, 900, 0.07);                 // 中频嗒（稍闷）
    }
  }
  function sfxMiss(rootMidi) {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime;
    pluck(midiFreq((rootMidi != null ? rootMidi : 60) - 12), t, 0.22, 0.16, "sine"); // 根音低八度闷咚
  }

  /* 立即压掉所有正在发声（退出/结算时清余音），短暂后恢复 */
  function silence() {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime;
    const cur = master.gain.value;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(cur, 0.0001), now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    master.gain.setValueAtTime(0.0001, now + 0.4);
    master.gain.linearRampToValueAtTime(1.0, now + 0.5);
  }

  window.AudioEngine = {
    ensureCtx,
    currentTime() { return ctx ? ctx.currentTime : 0; },
    pluck,
    kick,
    hat,
    playNote,
    metronome,
    decodeFile,
    playBuffer,
    stopBGM,
    playPad,
    renderSong,
    sfxHit,
    sfxMiss,
    silence,
  };
})();