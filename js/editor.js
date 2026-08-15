/* =========================================================
 * 谱面编辑器（editor.js）
 * Canvas 可视化编辑：
 *  - 点击轨道空白添加普通音符；Shift+点击添加长按音符
 *  - 按住音符拖动移动位置；拖动长按的尾部小柄调整时长
 *  - 右键删除；空格试听；支持导入本地音频作 BGM
 * 双押无需特殊编辑：同一时刻两轨各放一个音符即为双押。
 * ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("editor-canvas");
  const ctx2d = canvas.getContext("2d");
  const SNAP_TXT = { 0: 0, 4: 0.25, 2: 0.125, 1: 0.0625 }; // 下拉值 -> 拍比例（0=关闭）
  const DUR_PX_PER_SEC = 34;   // 长按竖条每秒像素

  const START_X = 44;
  const PAD_R = 16;

  let notes = [];       // {time,lane,midi,dur}
  let audioBuf = null;
  let audioName = "";
  let audioData = null;     // 源音频 ArrayBuffer（保存到 IDB）
  let pendingAudioId = null; // 已绑定音频的 id
  let songRef = null;
  let duration = 20;
  /* 视口：缩放（px/秒）与横向滑动（viewStart 秒） */
  let viewStart = 0;
  let pxPerSec = 60;

  /* ---- 播放状态 ---- */
  let playTimer = null;
  let playBase = 0;
  let playedSet = null;
  let raf = null;
  let bgmSrc = null;
  let edRoot = 60;   // 试听时当前和弦根音（无固定音高音符跟随）

  /* ---- 拖拽状态 ---- */
  let dragNote = null;     // 移动音符
  let dragDur = null;      // 调整长按时长
  let dragId = null;
  let hoverSnap = null;    // 吸附参考线（秒）
  let selected = null;     // 选中音符（键盘调音高）
  let downPos = null;      // mousedown 坐标（用于区分点击/拖动）
  let downNote = null;

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function midiToName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

  function w() { return canvas.clientWidth; }
  function h() { return canvas.clientHeight; }

  function timeToX(t) {
    return START_X + (t - viewStart) * pxPerSec;
  }
  function xToTime(px) {
    return Math.max(0, Math.min(duration, viewStart + (px - START_X) / pxPerSec));
  }
  function viewDur() {
    return (w() - START_X - PAD_R) / pxPerSec;
  }
  /* 缩放/滑动：把整个谱面适配到画布（初始视图） */
  function fitView() {
    pxPerSec = (w() - START_X - PAD_R) / Math.max(0.5, duration);
    pxPerSec = Math.max(8, Math.min(500, pxPerSec));
    viewStart = 0;
    draw();
  }
  /* 限制视口不越界 */
  function clampView() {
    const maxStart = Math.max(0, duration - viewDur());
    if (viewStart < 0) viewStart = 0;
    if (viewStart > maxStart) viewStart = maxStart;
  }
  function yToLane(y) { return y < h() / 2 ? 0 : 1; }
  function laneCenterY(lane) { return lane === 0 ? h() * 0.25 : h() * 0.75; }

  function currentBpm() { return parseFloat($("ed-bpm").value) || 120; }
  function currentOffset() { return parseFloat($("ed-offset").value) || 0; }
  function snapSec() {
    const v = parseInt($("ed-snap").value, 10);
    if (!v) return 0;
    const spb = 60 / currentBpm();
    return spb * (SNAP_TXT[v] || 0.25);
  }

  /* ---------- 打开与加载 ---------- */
  function open(songObj) {
    songRef = songObj;
    $("ed-title").value = songObj.title || "";
    $("ed-bpm").value = songObj.bpm || 120;
    $("ed-offset").value = songObj.offset != null ? songObj.offset : 0.6;
    notes = (songObj.notes || []).map((n) => ({
      time: +n.time, lane: n.lane,
      midi: n.midi != null ? n.midi : null,
      dur: n.dur || 0,
    }));
    audioBuf = songObj.audioBuf || null;
    audioName = songObj.audioName || "";
    pendingAudioId = songObj.audioId || null;
    audioData = null;
    $("ed-audio-name").textContent = audioName ? "BGM：" + audioName : "";
    /* 若曲库里的歌带 audioId，从 IndexedDB 取回音频 */
    if (pendingAudioId && !audioBuf) {
      SongLib.getAudio(pendingAudioId).then((ab) => {
        if (!ab) return;
        AudioEngine.decodeFile(ab.slice(0)).then((buf) => {
          audioBuf = buf;
        }).catch(() => {});
      }).catch(() => {});
    } else if (songObj && songObj.source === "synth" && !audioBuf) {
      SongLib.ensureBuiltinAudio(songObj).then((buf) => {
        if (buf) audioBuf = buf;
      }).catch(() => {});
    }
    computeDuration();
    renderMeta();
    fitView();
  }

  function newSong(title) {
    open({
      title: title || "未命名曲目",
      artist: "自定义",
      bpm: 120,
      offset: 0.6,
      volume: 0.3,
      notes: [],
    });
  }

  /* 导入本地音频：新建一首曲子并绑定 BGM */
  function loadAudio(file) {
    const reader = new FileReader();
    reader.onload = () => {
      /* decodeAudioData 会销毁传入的 ArrayBuffer，先复制一份供保存用 */
      const raw = reader.result.slice(0);
      AudioEngine.decodeFile(raw).then((buf) => {
        /* 先建好曲子（open 会重置 audioBuf/audioData），再绑定音频 */
        const base = file.name.replace(/\.[^.]+$/, "");
        if (!songRef || !songRef.notes || !songRef.notes.length) newSong(base);
        audioBuf = buf;
        audioData = reader.result;
        audioName = file.name;
        $("ed-title").value = $("ed-title").value || base;
        $("ed-audio-name").textContent = "BGM：" + file.name;
        draw();
      }).catch((e) => alert("音频解码失败：" + e.message));
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- 绘制 ---------- */
  function computeDuration() {
    const last = notes.reduce((m, n) => Math.max(m, n.time + (n.dur || 0)), 0);
    duration = Math.max(10, last + 3);
  }

  function draw() {
    const cw = w(), ch = h();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, cw, ch);

    const bg = ctx2d.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, "#131830");
    bg.addColorStop(1, "#0b0e1a");
    ctx2d.fillStyle = bg;
    ctx2d.fillRect(0, 0, cw, ch);

    const colors = ["rgba(91,140,255,.12)", "rgba(255,91,160,.12)"];
    for (let lane = 0; lane < 2; lane++) {
      const cy = laneCenterY(lane);
      ctx2d.fillStyle = colors[lane];
      ctx2d.fillRect(0, cy - 56, cw, 112);
      ctx2d.strokeStyle = lane === 0 ? "rgba(91,140,255,.4)" : "rgba(255,91,160,.4)";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(0, cy - 56, cw, 112);
      ctx2d.fillStyle = "rgba(232,236,255,.55)";
      ctx2d.font = "13px 'Microsoft YaHei'";
      ctx2d.textAlign = "left";
      ctx2d.fillText("轨道 " + (lane + 1), 8, cy - 66);
    }

    const spb = 60 / currentBpm();
    ctx2d.strokeStyle = "rgba(138,147,184,.22)";
    ctx2d.lineWidth = 1;
    const viewEnd = viewStart + viewDur();
    for (let t = Math.max(0, Math.floor(viewStart / spb) * spb); t <= Math.min(duration, viewEnd); t += spb) {
      const x = timeToX(t);
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, ch);
      ctx2d.stroke();
    }
    ctx2d.fillStyle = "#8b93b8";
    ctx2d.font = "11px 'Microsoft YaHei'";
    ctx2d.textAlign = "center";
    for (let s = Math.max(0, Math.floor(viewStart)); s <= Math.min(Math.ceil(duration), Math.ceil(viewEnd)); s += 1) {
      ctx2d.fillText(s + "s", timeToX(s), ch - 6);
    }

    /* 音符 */
    for (const n of notes) {
      const x = timeToX(n.time);
      const cy = laneCenterY(n.lane);
      const main = n.lane === 0 ? "91,140,255" : "255,91,160";
      /* 长按矩形条 */
      if (n.dur > 0) {
        const len = n.dur * DUR_PX_PER_SEC;
        const grad = ctx2d.createLinearGradient(0, cy, 0, cy + len);
        grad.addColorStop(0, "rgba(" + main + ",.92)");
        grad.addColorStop(0.18, "rgba(" + main + ",.55)");
        grad.addColorStop(1, "rgba(" + main + ",.12)");
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        if (ctx2d.roundRect) ctx2d.roundRect(x - 13, cy, 26, len, 7);
        else ctx2d.rect(x - 13, cy, 26, len);
        ctx2d.fill();
        /* 顶部亮头 */
        ctx2d.beginPath();
        ctx2d.arc(x, cy, 9, 0, Math.PI * 2);
        ctx2d.fillStyle = "rgba(255,255,255,.95)";
        ctx2d.fill();
        ctx2d.strokeStyle = "rgba(" + main + ",.9)";
        ctx2d.lineWidth = 3;
        ctx2d.stroke();
        /* 尾部小柄 */
        ctx2d.beginPath();
        ctx2d.arc(x, cy + len, 6, 0, Math.PI * 2);
        ctx2d.fillStyle = "rgba(" + main + ",.9)";
        ctx2d.fill();
        ctx2d.strokeStyle = "#0b0e1a";
        ctx2d.lineWidth = 2;
        ctx2d.stroke();
      }

      /* 音符圆 */
      ctx2d.beginPath();
      ctx2d.arc(x, cy, 11, 0, Math.PI * 2);
      ctx2d.fillStyle = "rgba(" + main + ",.85)";
      ctx2d.fill();
      ctx2d.strokeStyle = "#0b0e1a";
      ctx2d.lineWidth = 2;
      ctx2d.stroke();

      /* 音高标签 */
      if (n.midi != null) {
        ctx2d.fillStyle = "rgba(255,255,255,.9)";
        ctx2d.font = "bold 10px 'Microsoft YaHei'";
        ctx2d.textAlign = "center";
        ctx2d.fillText(midiToName(n.midi), x, cy - 18);
      }

      /* 选中高亮 */
      if (n === selected) {
        ctx2d.strokeStyle = "#ffd166";
        ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        ctx2d.arc(x, cy, 16, 0, Math.PI * 2);
        ctx2d.stroke();
      }
    }

    /* 吸附参考线（虚线，提示音符将吸附到哪个拍点） */
    if (hoverSnap != null) {
      const x = timeToX(hoverSnap);
      ctx2d.save();
      ctx2d.strokeStyle = "rgba(255,209,102,.5)";
      ctx2d.lineWidth = 1;
      ctx2d.setLineDash([5, 5]);
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, ch);
      ctx2d.stroke();
      ctx2d.restore();
    }

    /* 播放光标 */
    if (playTimer) {
      const t = currentPlayElapsed();
      const x = timeToX(Math.max(0, t));
      ctx2d.strokeStyle = "#ffd166";
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, ch);
      ctx2d.stroke();
    }
  }

  function renderMeta() {
    $("ed-note-count").textContent =
      "音符：" + notes.length + "（长按 " + notes.filter((n) => n.dur > 0).length + "）";
  }

  function currentPlayElapsed() {
    return AudioEngine.currentTime() - playBase - currentOffset();
  }

  /* ---------- 交互 ---------- */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* 命中：返回 {note, part}（part: body | tail），tail 为长按尾柄 */
  function hitNote(px, py) {
    let best = null, bestD = 14;
    for (const n of notes) {
      const x = timeToX(n.time), cy = laneCenterY(n.lane);
      if (n.dur > 0) {
        const tailY = cy + n.dur * DUR_PX_PER_SEC;
        const dt = Math.hypot(px - x, py - tailY);
        if (dt < 10 && dt < bestD) { bestD = dt; best = { note: n, part: "tail" }; }
      }
      const db = Math.hypot(px - x, py - cy);
      if (db < bestD) { bestD = db; best = { note: n, part: "body" }; }
    }
    return best;
  }

  function addNote(t, lane, isHold) {
    const snap = snapSec();
    const t2 = snap > 0 ? Math.round(t / snap) * snap : t;
    if (notes.some((n) => n.lane === lane && Math.abs(n.time - t2) < 0.02)) return;
    const spb = 60 / currentBpm();
    notes.push({
      time: +t2.toFixed(3),
      lane: lane,
      midi: lane === 0 ? 72 : 76,
      dur: isHold ? +spb.toFixed(3) : 0,
    });
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    computeDuration();
    renderMeta();
    draw();
  }

  function removeNote(n) {
    notes = notes.filter((x) => x !== n);
    computeDuration();
    renderMeta();
    draw();
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      const p = canvasPos(e);
      const hit = hitNote(p.x, p.y);
      if (hit) removeNote(hit.note);
      return;
    }
    const p = canvasPos(e);
    const hit = hitNote(p.x, p.y);
    downPos = p;
    downNote = hit ? hit.note : null;
    if (hit && hit.part === "tail") {
      dragDur = hit.note;
    } else if (hit) {
      dragNote = hit.note;
    } else if (!playTimer) {
      addNote(xToTime(p.x), yToLane(p.y), e.shiftKey);
    }
  });

  /* 滚轮：Ctrl+滚轮 缩放（围绕鼠标），普通滚轮 横向滑动 */
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const px = e.offsetX;
      const tUnder = xToTime(px);
      const factor = e.deltaY < 0 ? 1.3 : 1 / 1.3;
      pxPerSec = Math.max(8, Math.min(500, pxPerSec * factor));
      viewStart = tUnder - (px - START_X) / pxPerSec;
    } else {
      const dx = e.deltaX || e.deltaY;
      viewStart += dx / pxPerSec;
    }
    clampView();
    draw();
  }, { passive: false });

  window.addEventListener("mousemove", (e) => {
    const p = canvasPos(e);
    const snap = snapSec();
    if (dragDur) {
      const cy = laneCenterY(dragDur.lane);
      const len = Math.max(0.15, (p.y - cy) / DUR_PX_PER_SEC);
      dragDur.dur = +len.toFixed(3);
      computeDuration();
      draw();
      return;
    }
    hoverSnap = snap > 0 ? +(Math.round(xToTime(p.x) / snap) * snap).toFixed(3) : null;
    if (!dragNote) { draw(); return; }
    const tx = xToTime(p.x);
    dragNote.time = snap > 0 ? +Math.round(tx / snap) * snap : tx;
    dragNote.time = +dragNote.time.toFixed(3);
    dragNote.lane = yToLane(p.y);
    computeDuration();
    draw();
  });

  window.addEventListener("mouseup", (e) => {
    /* 点击（无拖动）音符 = 选中 */
    const p = canvasPos(e);
    const moved = downPos ? Math.hypot(p.x - downPos.x, p.y - downPos.y) : 99;
    if (downPos && downNote && !dragDur && moved < 5) {
      selected = downNote;
      draw();
    } else if (downPos && !downNote && !dragDur && moved < 5) {
      selected = null;
      draw();
    }
    dragNote = null;
    dragDur = null;
    dragId = null;
    downPos = null;
    downNote = null;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mouseleave", () => { hoverSnap = null; draw(); });

  /* 触摸支持（移动端） */
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const p = canvasPos({ clientX: t.clientX, clientY: t.clientY });
    const hit = hitNote(p.x, p.y);
    if (hit && hit.part === "tail") dragDur = hit.note;
    else if (hit) dragNote = hit.note;
    else if (!playTimer) addNote(xToTime(p.x), yToLane(p.y), false);
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!dragNote && !dragDur) return;
    const t = e.touches[0];
    const p = canvasPos({ clientX: t.clientX, clientY: t.clientY });
    if (dragDur) {
      const cy = laneCenterY(dragDur.lane);
      dragDur.dur = +Math.max(0.15, (p.y - cy) / DUR_PX_PER_SEC).toFixed(3);
      computeDuration();
      draw();
      return;
    }
    const snap = snapSec();
    const tx = xToTime(p.x);
    dragNote.time = snap > 0 ? +Math.round(tx / snap) * snap : tx;
    dragNote.time = +dragNote.time.toFixed(3);
    dragNote.lane = yToLane(p.y);
    computeDuration();
    draw();
  }, { passive: false });
  canvas.addEventListener("touchend", () => { dragNote = null; dragDur = null; });

  /* ---------- 播放 / 试听 ---------- */
  function playToggle() {
    if (playTimer) { stopPlay(); return; }
    const ctx = AudioEngine.ensureCtx();
    if (!ctx) return;
    playBase = ctx.currentTime + 0.15;
    if (audioBuf) bgmSrc = AudioEngine.playBuffer(audioBuf, playBase + currentOffset(), false);
    playedSet = new Set();
    playTimer = setInterval(scheduleTick, 25);
    raf = requestAnimationFrame(loop);
  }

  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    cancelAnimationFrame(raf);
    raf = null;
    if (bgmSrc) { try { bgmSrc.stop(); } catch (e) {} bgmSrc = null; }
    AudioEngine.silence();
    draw();
  }

  function loop() {
    if (!playTimer) return;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function scheduleTick() {
    const ctx = AudioEngine.currentTime();
    const t = ctx - playBase - currentOffset();
    const spb = 60 / currentBpm();

    if (t >= 0) {
      const beat = Math.floor(t / spb);
      const frac = t - beat * spb;
      if (frac < 0.06) {
        /* 每小节更新和弦根音（供无固定音高音符跟随），不合成伴奏 */
        const prog = (songRef && songRef.prog && songRef.prog.length)
          ? songRef.prog
          : [{ r: 60, t: 4 }, { r: 55, t: 4 }, { r: 57, t: 3 }, { r: 53, t: 4 }];
        if (beat % 4 === 0) {
          const ch = prog[(Math.floor(beat / 4)) % prog.length];
          edRoot = ch.r;
        }
      }
    }

    for (const n of notes) {
      const key = n.time + "_" + n.lane;
      const delta = t - n.time;
      if (!playedSet.has(key) && delta >= 0 && delta < 0.06) {
        playedSet.add(key);
        AudioEngine.playNote(n, ctx, 0.3, edRoot);
      }
    }

    const end = audioBuf ? audioBuf.duration : Math.max(duration, 10);
    if (t > end + 0.5) stopPlay();
  }

  /* ---------- 保存 / 导出 ---------- */
  function buildSong() {
    return {
      title: $("ed-title").value.trim() || "未命名曲目",
      artist: (songRef && songRef.artist) || "自定义",
      bpm: currentBpm(),
      offset: currentOffset(),
      volume: (songRef && songRef.volume) || 0.3,
      audioId: pendingAudioId,
      notes: notes.map((n) => ({
        time: n.time,
        lane: n.lane,
        midi: n.midi != null ? n.midi : (n.lane === 0 ? 72 : 76),
        dur: n.dur ? +n.dur.toFixed(3) : 0,
      })),
    };
  }

  async function save() {
    if (audioData) {
      if (!pendingAudioId) pendingAudioId = "a_" + Date.now().toString(36);
      const ok = await SongLib.saveAudio(pendingAudioId, audioData);
      if (!ok) {
        pendingAudioId = null;
        alert("BGM 音频保存失败：浏览器本地存储空间不足或不可用。请换个小一点的音频文件重试。");
        return;
      }
    }
    const song = buildSong();
    SongLib.CustomStore.add(song);
    if (window.Main && Main.refresh) Main.refresh();
    alert("已保存到曲库：" + song.title);
    stopPlay();
  }

  function exportJSON() {
    const song = buildSong();
    const blob = new Blob([SongLib.exportJSON(song)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (song.title || "chart") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clear() {
    if (!confirm("确认清空当前谱面？")) return;
    notes = [];
    computeDuration();
    renderMeta();
    draw();
  }

  /* 选中音符后键盘调整音高/切换 */
  window.addEventListener("keydown", (e) => {
    const ed = $("view-editor");
    if (!ed || !ed.classList.contains("active")) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    if (!selected) return;
    if (e.key === "ArrowUp") {
      selected.midi = Math.min(127, (selected.midi == null ? 72 : selected.midi) + 1);
      renderMeta(); draw(); e.preventDefault();
    } else if (e.key === "ArrowDown") {
      selected.midi = Math.max(0, (selected.midi == null ? 72 : selected.midi) - 1);
      renderMeta(); draw(); e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const sorted = notes.slice().sort((a, b) => a.time - b.time || a.lane - b.lane);
      const idx = sorted.indexOf(selected);
      if (idx >= 0) {
        const nx = sorted[idx + dir];
        if (nx) { selected = nx; draw(); }
      }
      e.preventDefault();
    }
  });

  /* ---------- 自动生成谱面 ---------- */
  function analyzeOnsets(buf, minGap) {
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.max(1, Math.floor(sr * 0.023));
    const rms = [];
    for (let i = 0; i < data.length; i += hop) {
      let s = 0, n = 0;
      const end = Math.min(data.length, i + hop);
      for (let j = i; j < end; j++) { s += data[j] * data[j]; n++; }
      rms.push(Math.sqrt(s / Math.max(1, n)));
    }
    let avg = 0;
    for (let i = 0; i < rms.length; i++) avg += rms[i];
    avg /= Math.max(1, rms.length);
    const onsets = [];
    let prev = 0;
    for (let i = 1; i < rms.length; i++) {
      const v = rms[i];
      if (v > prev * 1.45 && v > avg * 1.6) onsets.push(i * hop / sr);
      prev = v;
    }
    const out = [];
    let last = -Infinity;
    for (const t of onsets) {
      if (t - last >= minGap) { out.push(+t.toFixed(3)); last = t; }
    }
    return out;
  }

  /* 逐帧能量：{t, e} */
  function frameEnergy(buf) {
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.max(1, Math.floor(sr * 0.023));
    const out = [];
    for (let i = 0; i < data.length; i += hop) {
      let s = 0, n = 0;
      const end = Math.min(data.length, i + hop);
      for (let j = i; j < end; j++) { s += data[j] * data[j]; n++; }
      out.push({ t: i / sr, e: Math.sqrt(s / Math.max(1, n)) });
    }
    return out;
  }
  /* 找持续高能量区间（长音/持续段）→ 长条 */
  function findHolds(frames, avg) {
    const holds = [];
    let runStart = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].e > avg * 1.35) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        const dur = frames[i].t - frames[runStart].t;
        if (dur >= 0.45) holds.push({ t: +frames[runStart].t.toFixed(3), dur: +Math.min(dur, 2.5).toFixed(2) });
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      const dur = frames[frames.length - 1].t - frames[runStart].t;
      if (dur >= 0.45) holds.push({ t: +frames[runStart].t.toFixed(3), dur: +Math.min(dur, 2.5).toFixed(2) });
    }
    if (holds.length > 12) return holds.filter((_, i) => i % 2 === 0);
    return holds;
  }
  /* 在升序时间数组里找最近的候选（对齐节奏） */
  function nearestOnset(cand, t, spb) {
    let lo = 0, hi = cand.length - 1, best = t, bestD = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = cand[mid] - t;
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = cand[mid]; }
      if (d < 0) lo = mid + 1; else hi = mid - 1;
    }
    return bestD < spb * 0.4 ? +best.toFixed(3) : +t.toFixed(3);
  }
  /* 迭代 FFT，返回前 n/2 个频点幅度 */
  function fftMag(seg) {
    const n = seg.length;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = seg[i];
    /* 位反序 */
    let j = 0;
    for (let i = 1; i < n - 1; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= n; len *= 2) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i + j], uIm = im[i + j];
          const a = i + j + len / 2;
          const vRe = re[a] * curRe - im[a] * curIm;
          const vIm = re[a] * curIm + im[a] * curRe;
          re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
          re[a] = uRe - vRe; im[a] = uIm - vIm;
          const nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nRe;
        }
      }
    }
    const mag = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    return mag;
  }
  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  /* 节拍检测：对能量帧做自相关找周期 → BPM（和谐评分消除倍频歧义，范围 55~210） */
  function detectBPM(buf) {
    const fr = frameEnergy(buf);
    const N = fr.length;
    if (N < 60) return null;
    const hop = Math.max(0.001, fr[1].t - fr[0].t);
    const x = new Float64Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) { x[i] = fr[i].e; mean += fr[i].e; }
    mean /= N;
    for (let i = 0; i < N; i++) x[i] -= mean;
    const minLag = Math.max(2, Math.floor(60 / (240 * hop)));
    const maxLag = Math.ceil(60 / (55 * hop));
    const ac = new Float64Array(maxLag + 1);
    for (let L = minLag; L <= maxLag; L++) {
      let s = 0;
      for (let i = 0; i < N - L; i++) s += x[i] * x[i + L];
      ac[L] = s / Math.max(1, N - L);
    }
    /* 和谐评分：真节拍周期的 2x/3x 滞后也会呈现峰值 */
    let bestLag = minLag, bestS = -1;
    for (let L = minLag; L <= maxLag; L++) {
      const s2 = L * 2 <= maxLag ? ac[L * 2] : 0;
      const s3 = L * 3 <= maxLag ? ac[L * 3] : 0;
      const score = ac[L] + s2 * 0.8 + s3 * 0.6;
      if (score > bestS) { bestS = score; bestLag = L; }
    }
    let bestBpm = null, bestScore = -1;
    /* 抛物线插值精确定位峰位（亚滞后精度） */
    let exactLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const A = ac[bestLag - 1], B = ac[bestLag], C = ac[bestLag + 1];
      const denom = A - 2 * B + C;
      if (Math.abs(denom) > 1e-12) {
        const d = (A - C) / (2 * denom);
        if (d > -1 && d < 1) exactLag = bestLag + d;
      }
    }
    const bpm0 = 60 / (exactLag * hop);
    /* 遍历整数 BPM，按对应滞后自相关强度 + 和谐项 + 接近 bpm0 综合打分 */
    for (let bpm = 55; bpm <= 210; bpm++) {
      const lag2 = Math.round(60 / (bpm * hop));
      if (lag2 < minLag || lag2 > maxLag) continue;
      let strength = ac[lag2];
      if (lag2 * 2 <= maxLag) strength += ac[lag2 * 2] * 0.5;
      const near = 1 / (1 + Math.abs(bpm - bpm0) * 0.1);
      const score = strength * near;
      if (score > bestScore) { bestScore = score; bestBpm = bpm; }
    }
    return bestBpm;
  }
  /* 量化到最近的 C 大调白键，让旋律有调性 */
  function quantizeWhite(midi) {
    const oct = midi - (midi % 12);
    const rel = midi - oct;
    const white = [0, 2, 4, 5, 7, 9, 11];
    let best = white[0], bestD = Infinity;
    for (const w of white) {
      const d = Math.abs(w - rel);
      if (d < bestD) { bestD = d; best = w; }
    }
    return oct + best;
  }
  /* 按 250ms 分段做音高检测，缓存为时间表 */
  function buildPitchTable(buf) {
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const n = 2048;
    const hop = Math.floor(sr * 0.25);
    const table = [];
    for (let s = 0; s < buf.length - n; s += hop) {
      const seg = new Float32Array(n);
      for (let i = 0; i < n; i++) seg[i] = data[s + i];
      const mag = fftMag(seg);
      let best = -1, bestF = 0;
      for (let k = Math.ceil(80 * n / sr); k < 1400 * n / sr && k < n / 2; k++) {
        if (mag[k] > best) { best = mag[k]; bestF = k * sr / n; }
      }
      let midi = null;
      if (best > 0) {
        midi = quantizeWhite(Math.round(freqToMidi(bestF)));
        midi = Math.max(48, Math.min(84, midi));
      }
      table.push({ t: s / sr, midi: midi });
    }
    return table;
  }
  function pitchAt(table, t) {
    if (!table || !table.length) return null;
    let lo = 0, hi = table.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid].t <= t) { best = table[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best ? best.midi : null;
  }

  /* 自动生成谱面：根据 BGM 能量段落变化密度，加入双押/长条，音调跟随 BGM */
  function autoGen() {
    const diff = $("ed-gen-diff") ? $("ed-gen-diff").value : "normal";
    const cfg = { easy: { name: "简单" }, normal: { name: "普通" }, hard: { name: "困难" } }[diff] || { name: "普通" };
    /* 有音频时先自动检测 BPM 并写入谱面，后续网格/对齐全部跟随 */
    if (audioBuf) {
      const d = detectBPM(audioBuf);
      if (d) $("ed-bpm").value = d;
    }
    const spb = 60 / currentBpm();
    const off = currentOffset();
    notes = [];
    let laneLast = 1;
    const nextLane = () => { laneLast = 1 - laneLast; return laneLast; };

    let cand = null, pitchTable = null;
    if (audioBuf) {
      duration = Math.max(duration, audioBuf.duration + 2);
      cand = analyzeOnsets(audioBuf, Math.min(0.08, spb * 0.25));
      try { pitchTable = buildPitchTable(audioBuf); } catch (e) { pitchTable = null; }
      const fr = frameEnergy(audioBuf);
      const avg = fr.reduce((s, f) => s + f.e, 0) / Math.max(1, fr.length);
      const holds = findHolds(fr, avg);
      const bars = Math.ceil(Math.min(audioBuf.duration, duration) / (spb * 4));
      for (let b = 0; b < bars; b++) {
        const bStart = b * spb * 4, bEnd = bStart + spb * 4;
        const bE = fr.filter((f) => f.t >= bStart && f.t < bEnd).reduce((s, f) => s + f.e, 0) / Math.max(1, spb * 4 / 0.023);
        const en = avg > 0 ? bE / avg : 1;
        let step;
        if (diff === "easy") step = en >= 1.6 ? spb : spb * 2;
        else if (diff === "hard") step = en >= 1.6 ? spb * 0.25 : (en >= 0.9 ? spb * 0.5 : spb);
        else step = en >= 1.6 ? spb * 0.25 : (en >= 0.9 ? spb * 0.5 : spb * 2);
        const heavy = diff === "hard" || en >= 1.6;
        for (let t = off + bStart; t < Math.min(bEnd, duration); t += step) {
          const tt = cand ? nearestOnset(cand, t, spb) : +t.toFixed(3);
          if (heavy && Math.random() < 0.28) {
            const m = pitchAt(pitchTable, tt) || PENTA[Math.floor(Math.random() * PENTA.length)];
            notes.push({ time: tt, lane: 0, midi: m, dur: 0 });
            notes.push({ time: tt, lane: 1, midi: m, dur: 0 });
            laneLast = 1;
          } else {
            notes.push({ time: tt, lane: nextLane(), midi: null, dur: 0 });
          }
        }
        /* 该小节若有长音区间 → 长条 */
        const h = holds.find((x) => x.t >= bStart && x.t < bEnd);
        if (h) {
          notes.push({ time: nearestOnset(cand, h.t, spb), lane: Math.floor(Math.random() * 2), midi: null, dur: h.dur });
        }
      }
    } else {
      /* 无音频：用正弦起伏模拟段落强弱，保证间隔有变化 */
      const len = Math.max(20, duration);
      const bars = Math.ceil(len / (spb * 4));
      for (let b = 0; b < bars; b++) {
        const wave = 0.5 + 0.5 * Math.sin((b / 4) * Math.PI);
        let step = wave > 0.72 ? spb * 0.25 : (wave > 0.42 ? spb * 0.5 : spb);
        if (diff === "easy") step = Math.max(spb, step);
        else if (diff === "hard") step = wave > 0.42 ? spb * 0.25 : spb * 0.5;
        for (let t = off + b * spb * 4; t < Math.min(off + (b + 1) * spb * 4, len); t += step) {
          if (wave > 0.72 && Math.random() < 0.25) {
            const m = PENTA[Math.floor(Math.random() * PENTA.length)];
            notes.push({ time: +t.toFixed(3), lane: 0, midi: m, dur: 0 });
            notes.push({ time: +t.toFixed(3), lane: 1, midi: m, dur: 0 });
            laneLast = 1;
          } else {
            notes.push({ time: +t.toFixed(3), lane: nextLane(), midi: null, dur: 0 });
          }
        }
      }
    }

    /* 填充音高：有音频用检测表，否则五声循环 */
    let mi = 0;
    for (const n of notes) {
      if (n.midi == null) n.midi = audioBuf ? (pitchAt(pitchTable, n.time) || PENTA[mi % PENTA.length]) : PENTA[mi % PENTA.length];
      mi++;
    }
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    /* 防止音符过多拖垮编辑器 */
    if (notes.length > 700) {
      const keep = Math.ceil(notes.length / 700);
      notes = notes.filter((_, i) => i % keep === 0);
    }
    selected = null;
    computeDuration();
    renderMeta();
    fitView();
    alert("已按「" + cfg.name + "」难度自动生成 " + notes.length + " 个音符：段落有强弱变化、含双押与长条、音调跟随 BGM（可点击选中后用 ↑/↓ 调整）");
  }

  window.Editor = {
    open,
    newSong,
    loadAudio,
    autoGen,
    playToggle,
    stopPlay,
    save,
    exportJSON,
    clear,
    redraw: draw,
    getNotes() { return notes.slice(); },
    hasAudio() { return !!audioBuf; },
    detectBpm: detectBPM,
  };

  newSong();
})();