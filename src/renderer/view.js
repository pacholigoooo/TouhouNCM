(() => {
  "use strict";

  const VERSION = "1.4.1";
  let mounted = null;
  const icons = {
    down: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    expand: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
    settings: '<path d="M13 3.5a8.7 8.7 0 1 0 7.5 7.5M5.7 12a6 6 0 0 1 4.1-5.4"/><circle cx="11.8" cy="12.2" r="2.2"/><path d="m18.2 1.7 1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1Z"/>',
    previous: '<path d="M5 5v14"/><path class="icon-fill" d="m19 5-10 7 10 7Z"/>',
    next: '<path d="M19 5v14"/><path class="icon-fill" d="m5 5 10 7-10 7Z"/>',
    play: '<path class="icon-fill" d="m8 4 12 8-12 8Z"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4.5"/>',
    loop: '<path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4m4 10-4-4 4-4m-4 4h14a4 4 0 0 0 4-4"/>',
    single: '<path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4m4 10-4-4 4-4m-4 4h14a4 4 0 0 0 4-4m-11-3 2-1v6"/>',
    shuffle: '<path d="M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c1.5 0 3-1.7 4.5-4M14 9c1.5-2 2.5-3 4-3h3m-4-4 4 4-4 4"/>',
    order: '<path d="M4 5h15M4 10h11M4 15h7m4 0 4 4-4 4m-2-4h6"/>',
    heart: '<path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4m4 10-4-4 4-4m-4 4h14a4 4 0 0 0 4-4"/><path class="icon-fill" d="m10 9 5 3-5 3Z"/>',
    fm: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    volume: '<path d="M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    muted: '<path d="M11 4 6 8H3v8h3l5 4Zm5 5 6 6m0-6-6 6"/>',
    translate: '<path d="M3 5h11M8 3v2M5 5c0 5 4 8 8 10M12 5c0 5-4 8-8 10m9 6 4-11 4 11m-6.7-3h5.4"/>',
    collection: '<path d="M3 5h12M3 10h12M3 15h7m8-5v10m-5-5h10"/>',
    queue: '<path d="M3 5h16M3 10h12M3 15h8m5-1 5 3-5 3Z"/>',
    music: '<path d="M10 17V5l10-2v12M10 8l10-2"/><ellipse cx="6.5" cy="17.5" rx="3.5" ry="2.5"/><ellipse cx="16.5" cy="15.5" rx="3.5" ry="2.5"/>'
  };
  const icon = (name, className = "") => '<svg class="icon ' + className + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  const time = ms => {
    if (!Number.isFinite(ms)) return "--:--";
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  };
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const fontFamilies = ["system", "song", "kai", "xingkai", "youyuan", "corsiva", "baskerville", "rockwell"];
  const legacyFontFamilies = { serif: "song", xinwei: "corsiva", lishu: "baskerville", zhongsong: "rockwell" };
  const normalizeFontFamily = value => {
    const family = legacyFontFamilies[value] || value;
    return fontFamilies.includes(family) ? family : "system";
  };
  const normalizeLyricCurve = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const adjustments = {
    brightness: {label: "明暗", min: 45, max: 135, step: 1, value: 100, unit: "%"},
    blur: {label: "模糊", min: 0, max: 48, step: 1, value: 0, unit: "px"},
    saturation: {label: "饱和度", min: 0, max: 220, step: 1, value: 132, unit: "%"},
    lyricSize: {label: "歌词字号", min: 24, max: 72, step: 1, value: 44, unit: "px"},
    lineSpacing: {label: "行距", min: 1.1, max: 2.2, step: 0.05, value: 1.4, unit: " 倍"},
    translationSize: {label: "译文字号", min: 10, max: 32, step: 1, value: 18, unit: "px"},
    unsungOpacity: {label: "未唱歌词透明度", min: 10, max: 85, step: 1, value: 50, unit: "%"}
  };
  const normalizeAdjustment = (name, value) => {
    const setting = adjustments[name], number = Number(value);
    return Number.isFinite(number) ? Math.max(setting.min, Math.min(setting.max, Number((Math.round(number / setting.step) * setting.step).toFixed(2)))) : setting.value;
  };
  const normalizeAccent = value => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : "#ffffff";
  const themeDefaults = {brightness: 100, blur: 0, saturation: 132, accent: "#ffffff"};
  const lyricPresets = {
    sing: {lyricSize: 56, lineSpacing: 1.5, translationSize: 20, unsungOpacity: 35, translation: true},
    bilingual: {lyricSize: 34, lineSpacing: 1.25, translationSize: 16, unsungOpacity: 58, translation: true}
  };
  function adjustmentControl(name) {
    const s = adjustments[name], id = "ncm-setting-" + name;
    return '<div class="setting-adjustment"><label for="' + id + '">' + s.label + '</label><output for="' + id + '" data-adjustment-value="' + name + '"></output><input id="' + id + '" class="range adjustment-range" type="range" data-preference="' + name + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"></div>';
  }
  function timedWords(line) {
    if (!Array.isArray(line.words) || !line.words.length) return [];
    const valid = line.words.every(word => word && typeof word.text === "string" && word.text.length > 0 && finite(word.startMs) && word.startMs >= 0 && finite(word.durationMs) && word.durationMs >= 0);
    return valid && line.words.some(word => word.durationMs > 0) ? line.words : [];
  }
  // Measure timing ranges on one shaped text node. Kerning, joins and punctuation
  // then match the same line displayed when word highlighting is switched off.
  function measureLyricInk(text, words) {
    const box = text.getBoundingClientRect();
    const range = document.createRange();
    let offset = 0;
    const segments = words.map(word => {
      range.setStart(text.firstChild, offset);
      offset += word.text.length;
      range.setEnd(text.firstChild, offset);
      let advance = 0;
      const fragments = Array.from(range.getClientRects(), rect => {
        const fragment = { x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height, advance };
        advance += rect.width;
        return fragment;
      });
      return { fragments, advance, start: word.startMs, duration: word.durationMs };
    });
    return { text, segments, style: "" };
  }

  function paintLyricInk(ink, position) {
    // Each rectangle is a piece of ink for the text-clip mask, never another glyph.
    // Merge neighboring sung words so a join is painted with one solid background.
    const bands = [];
    for (const s of ink.segments) {
      if (position < s.start) continue;
      const fraction = s.duration ? Math.min(1, (position - s.start) / s.duration) : 1;
      const filled = s.advance * fraction;
      for (const r of s.fragments) {
        const width = Math.min(r.width, filled - r.advance);
        if (width <= 0 || !r.height) continue;
        const end = r.x + width;
        const last = bands[bands.length - 1];
        if (last && Math.abs(last.y-r.y) < 0.5 && r.x >= last.x && r.x <= last.end + 0.5) {
          last.end = Math.max(last.end, end);
          last.height = Math.max(last.height, r.height);
        } else bands.push({x:r.x, y:r.y, end, height:r.height});
      }
    }
    const layers = bands.map(b => "linear-gradient(var(--lyric-accent,white),var(--lyric-accent,white)) " +
      b.x.toFixed(2) + "px " + Math.floor(b.y) + "px / " + (b.end-b.x).toFixed(2) + "px " + (Math.ceil(b.height)+1) + "px no-repeat");
    const style = layers.join(",") || "none";
    if (style !== ink.style) {
      ink.text.style.setProperty("--sung-ink", style);
      ink.style = style;
    }
  }
  const readPreference = (name, fallback) => {
    try { return localStorage.getItem("ncm-immersive." + name) || fallback; }
    catch (_) { return fallback; }
  };

  // Paint with the cover itself. Drawing a cross-origin image is supported here
  // because the player never reads canvas pixels or exports the resulting image.
  function createArtworkBackground(canvas) {
    const context = canvas.getContext("2d");
    const crops = [[0.22, 0.24], [0.77, 0.22], [0.73, 0.79], [0.23, 0.77]];
    let base = null, patches = [], frame = 0, previousTime = 0, phase = 0;
    let previous = null, transitionStart = 0, running = false;
    function tile(size) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = size;
      return tile;
    }
    function paint(now = 0) {
      if (!context) return;
      const w = canvas.width, h = canvas.height;
      context.clearRect(0, 0, w, h);
      if (base) context.drawImage(base, 0, 0, w, h);
      patches.forEach((patch, i) => {
        const angle = phase + i * Math.PI / 2;
        const x = w * (0.5 + 0.39 * Math.cos(angle) + 0.07 * Math.sin(i + phase * 1.6));
        const y = h * (0.5 + 0.42 * Math.sin(angle) + 0.08 * Math.cos(i - phase * 1.4));
        context.drawImage(patch, x - w * 0.59, y - h * 0.67, w * 1.18, h * 1.34);
      });
      if (previous) {
        if (!transitionStart) transitionStart = now;
        const progress = Math.min(1, Math.max(0, (now - transitionStart) / 600));
        context.globalAlpha = Math.pow(1 - progress, 2);
        context.drawImage(previous, 0, 0, w, h);
        context.globalAlpha = 1;
        if (progress === 1) previous = null;
      }
    }
    function tick(now) {
      if (!previousTime || now - previousTime >= 55) {
        if (running && previousTime) phase += Math.min(now - previousTime, 120) * 0.00030;
        previousTime = now;
        paint(now);
      }
      frame = running && base || previous ? requestAnimationFrame(tick) : 0;
    }
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = previousTime = 0;
    }
    function setCover(image, animate = false) {
      stop();
      const old = animate && (base || previous) ? document.createElement("canvas") : null;
      if (old) {
        old.width = canvas.width; old.height = canvas.height;
        old.getContext("2d").drawImage(canvas, 0, 0);
      }
      previous = old;
      transitionStart = 0;
      patches = [];
      base = null;
      phase = 0;
      if (!context) return;
      if (image && image.naturalWidth) {
        base = tile(5);
        base.getContext("2d").drawImage(image, 0, 0, 5, 5);
        const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.38;
        patches = crops.map(([u, v]) => {
          const sample = tile(3), patch = tile(64), ctx = patch.getContext("2d");
          sample.getContext("2d").drawImage(image, u * (image.naturalWidth - side), v * (image.naturalHeight - side), side, side, 0, 0, 3, 3);
          ctx.drawImage(sample, 0, 0, 64, 64);
          const edge = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
          edge.addColorStop(0, "#fff"); edge.addColorStop(0.4, "#fff"); edge.addColorStop(1, "transparent");
          ctx.globalCompositeOperation = "destination-in";
          ctx.fillStyle = edge;
          ctx.fillRect(0, 0, 64, 64);
          return patch;
        });
      }
      paint();
      if (previous || running && base) frame = requestAnimationFrame(tick);
    }
    return {setCover, stop, setRunning(on) {
      running = on;
      if (!on) { stop(); previous = null; paint(); }
      else if (base && !frame) frame = requestAnimationFrame(tick);
    }};
  }

  function mount(bridge, cssText, options = {}) {
    if (!bridge || typeof bridge.subscribe !== "function") throw new Error("沉浸听歌需要真实播放器桥接。");
    if (mounted) mounted.destroy();
    const host = document.createElement("div");
    host.id = "ncm-immersive-host";
    host.dataset.version = VERSION;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <section class="immersion" data-ncm-view data-open="false" data-playing="false" data-lyric-mode="none" role="dialog" aria-modal="true" aria-label="沉浸听歌" tabindex="-1" hidden>
        <div class="ambient" aria-hidden="true"><canvas class="ambient-field" width="128" height="80"></canvas><div class="ambient-shade"></div></div>
        <header class="topbar">
          <button class="header-leading" data-ncm-action="close" type="button" title="收起播放页 · Esc" aria-label="收起播放页">
            <span class="icon-button back-button" aria-hidden="true">${icon("down")}</span>
            <span class="brand"><svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><path d="M17.2 3.6a10.8 10.8 0 1 0 6.7 7.2M16 4.7v10.4a3.4 3.4 0 1 1-3.4-3.4H16m0-7 5-1.6"/></svg><span>网易云音乐</span></span>
          </button>
          <div class="header-drag-space" aria-hidden="true"></div>
          <div class="header-actions"><button class="icon-button" data-ncm-action="fullscreen" type="button" title="全屏 · F" aria-label="进入全屏" aria-pressed="false">${icon("expand")}</button><button class="icon-button" data-ncm-action="settings" type="button" title="听歌设置" aria-label="听歌设置" aria-expanded="false" aria-controls="ncm-immersive-settings">${icon("settings")}</button></div>
        </header>
        <main class="immersive-view">
          <section class="player-pane" aria-label="播放器">
            <div class="cover-wrap" data-cover-state="empty"><div class="cover-placeholder" aria-hidden="true">${icon("music")}</div><img class="cover-art" data-cover alt="" hidden></div>
            <div class="song-heading"><div class="song-title-row"><div class="song-title-wrap"><h1 data-title tabindex="0" aria-haspopup="menu" aria-controls="ncm-title-context-menu" aria-expanded="false">尚未播放</h1></div>
            <div class="song-tools" data-song-tools role="group" aria-label="播放工具">
              <button class="icon-button tool-button" data-ncm-action="mode" type="button" aria-label="播放模式" title="播放模式" hidden>${icon("loop")}</button>
              <div class="volume-control" data-volume-control hidden><button class="icon-button tool-button" data-ncm-action="volume" type="button" aria-label="音量" title="音量" aria-expanded="false" aria-controls="ncm-immersive-volume">${icon("volume")}</button><div id="ncm-immersive-volume" class="volume-panel" role="group" aria-label="音量调节" hidden><input class="range volume-range" data-volume type="range" min="0" max="100" step="1" aria-label="音量"><output class="volume-value" data-volume-value aria-hidden="true"></output></div></div>
              <button class="icon-button tool-button" data-ncm-action="collection" type="button" aria-label="收藏到歌单" title="收藏到歌单" disabled>${icon("collection")}</button>
              <button class="icon-button tool-button" data-ncm-action="translation" type="button" aria-label="播放歌曲后查看译文" title="播放歌曲后查看译文" aria-pressed="false" aria-disabled="true">${icon("translate")}</button>
              <button class="icon-button tool-button" data-ncm-action="queue" type="button" aria-label="播放队列" title="播放队列" disabled>${icon("queue")}</button>
            </div></div><p class="song-origin-note" data-title-annotation hidden></p><div class="song-meta"><span class="song-artist" data-artist tabindex="0" aria-haspopup="menu" aria-controls="ncm-title-context-menu" aria-expanded="false">从网易云音乐选择一首歌</span><span class="song-album" data-album hidden></span></div></div>
            <div class="progress-block"><input class="range progress-range" data-progress type="range" min="0" max="1" step="1" value="0" aria-label="播放进度" disabled><div class="time-labels"><span data-position>--:--</span><span data-duration>--:--</span></div></div>
            <div class="playback-controls"><button class="icon-button track-control" data-ncm-action="previous" type="button" title="上一首" aria-label="上一首" disabled>${icon("previous")}</button><button class="play-button" data-ncm-action="play" type="button" title="播放 / 暂停 · 空格" aria-label="播放" disabled>${icon("play", "icon-play")}${icon("pause", "icon-pause")}</button><button class="icon-button track-control" data-ncm-action="next" type="button" title="下一首" aria-label="下一首" disabled>${icon("next")}</button></div>
          </section>
          <section class="lyrics-pane" aria-label="歌词">
            <div class="lyrics-viewport" data-lyrics-viewport tabindex="0" aria-label="滚动查看歌词，点击歌词可跳转"><div class="lyrics-track" data-lyrics-track></div></div>
            <div class="lyric-empty" data-lyric-empty><div class="sound-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p data-empty-title>音乐，等你开启</p><span data-empty-detail>播放后，歌词会在这里与你相遇</span></div>
            <button class="recenter-button" data-ncm-action="recenter" type="button" hidden>回到当前歌词</button>
          </section>
        </main>
        <section id="ncm-immersive-settings" class="settings-panel" role="dialog" aria-label="听歌设置" hidden>
          <div class="settings-header"><h2>${icon("settings", "settings-brand-mark")}听歌设置</h2><button class="icon-button" data-ncm-action="close-settings" type="button" aria-label="关闭设置">${icon("close")}</button></div>
          <details class="settings-group" open>
            <summary>背景调色</summary>
            <label class="setting-row"><span class="setting-copy"><span>流动背景</span><small data-motion-hint>让封面的色彩缓缓流动</small></span><span class="switch"><input type="checkbox" data-setting="motion" aria-label="流动背景"><span class="switch-track"></span></span></label>
            ${["brightness", "blur", "saturation"].map(adjustmentControl).join("")}
            <label class="setting-select-row accent-row"><span>歌词强调色</span><input class="accent-input" type="color" data-accent aria-label="歌词强调色" value="#ffffff"></label>
            <div class="theme-actions" role="group" aria-label="个人主题"><button type="button" class="settings-text-button" data-ncm-action="save-theme">保存个人主题</button><button type="button" class="settings-text-button" data-ncm-action="restore-theme" disabled>恢复个人主题</button><button type="button" class="settings-text-button" data-ncm-action="reset-theme">恢复默认</button></div>
          </details>
          <details class="settings-group" open>
            <summary>歌词排版</summary>
            <label class="setting-select-row"><span>排版预设</span><select class="font-select" data-lyric-preset aria-label="歌词排版预设"><option value="custom">自定排版</option><option value="sing">大字跟唱</option><option value="bilingual">紧凑双语</option></select></label>
            ${["lyricSize", "lineSpacing", "translationSize", "unsungOpacity"].map(adjustmentControl).join("")}
            <label class="setting-select-row"><span>歌词字体</span><select class="font-select" data-font-family aria-label="歌词字体"><option value="system">默认字体</option><option value="song">宋体</option><option value="kai">楷体</option><option value="xingkai">华文行楷</option><option value="youyuan">幼圆</option><option value="corsiva">Monotype Corsiva</option><option value="baskerville">Baskerville Old Face</option><option value="rockwell">Rockwell</option></select></label>
            <div class="setting-curve"><label for="ncm-lyric-curve">歌词弯曲</label><output for="ncm-lyric-curve" data-curve-value>直排</output><input id="ncm-lyric-curve" class="range curve-range" data-lyric-curve type="range" min="0" max="100" step="1" value="0"></div>
            <label class="setting-row"><span class="setting-copy"><span>逐字歌词</span><small id="ncm-word-hint" data-word-hint></small></span><span class="switch"><input type="checkbox" data-setting="word" aria-label="逐字歌词" aria-describedby="ncm-word-hint"><span class="switch-track"></span></span></label>
            <button type="button" class="settings-text-button" data-ncm-action="reset-lyrics">恢复默认排版</button>
          </details>
          <details class="settings-group" data-simplify-group hidden><summary>界面简化</summary><p class="setting-description">勾选后隐藏对应入口</p><div data-simplify-items></div><button type="button" class="settings-text-button" data-ncm-action="reset-simplify">恢复全部入口</button></details>
          <details class="settings-group" data-distraction-group hidden><summary>通知与广告</summary><p class="setting-description">关闭红点、推广弹窗或页面广告</p><div data-distraction-items></div><button type="button" class="settings-text-button" data-ncm-action="reset-distractions">恢复通知与广告</button></details>
          <div class="keyboard-hints"><span><kbd>空格</kbd> 播放</span><span><kbd>← →</kbd> 5 秒</span><span><kbd>Esc</kbd> 返回</span></div>
        </section>
        <div class="toast" data-toast role="status" aria-live="polite" hidden></div>
      </section><div id="ncm-title-context-menu" class="title-context-menu" data-title-menu role="menu" aria-label="复制曲目信息" tabindex="-1" hidden><button type="button" role="menuitem" tabindex="-1" data-copy-field="title">复制歌名</button><button type="button" role="menuitem" tabindex="-1" data-copy-field="artist">复制歌手</button></div>`;
    const style = document.createElement("style");
    style.textContent = cssText;
    shadow.prepend(style);
    (document.body || document.documentElement).appendChild(host);

    const $ = selector => shadow.querySelector(selector);
    const view = $("[data-ncm-view]");
    const viewport = $("[data-lyrics-viewport]");
    const lyricTrack = $("[data-lyrics-track]");
    const progress = $("[data-progress]");
    const positionLabel = $("[data-position]");
    const durationLabel = $("[data-duration]");
    const settingsPanel = $(".settings-panel");
    const titleMenu = $("[data-title-menu]");
    let titleMenuOrigin = null;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const backdrop = createArtworkBackground($(".ambient-field"));
    const storedFontFamily = readPreference("fontFamily", "system");
    const storedLyricSize = readPreference("lyricSize", "");
    const preferences = {
      motion: readPreference("motion", motionQuery.matches ? "off" : "on") === "on",
      word: readPreference("word", "on") === "on",
      translation: readPreference("translation", "on") === "on",
      fontFamily: normalizeFontFamily(storedFontFamily),
      lyricCurve: normalizeLyricCurve(readPreference("lyricCurve", "0")),
      accent: normalizeAccent(readPreference("accent", "#ffffff")),
      ...Object.fromEntries(Object.entries(adjustments).map(([name, setting]) => [name, normalizeAdjustment(name, readPreference(name, String(setting.value)))])),
      lyricSize: normalizeAdjustment("lyricSize", storedLyricSize || (readPreference("fontSize", "standard") === "large" ? 54 : 44))
    };
    let personalTheme = null;
    try {
      const saved = JSON.parse(readPreference("personalTheme", "null"));
      if (saved && typeof saved === "object" && Object.keys(themeDefaults).every(name => name in saved)) {
        personalTheme = Object.fromEntries(Object.keys(themeDefaults).map(name => [name, name === "accent" ? normalizeAccent(saved[name]) : normalizeAdjustment(name, saved[name])]));
      }
      if (!storedLyricSize) localStorage.setItem("ncm-immersive.lyricSize", String(preferences.lyricSize));
    } catch (_) {}
    if (storedFontFamily !== preferences.fontFamily) {
      try { localStorage.setItem("ncm-immersive.fontFamily", preferences.fontFamily); } catch (_) {}
    }
    let snapshot = null;
    let lines = [];
    let lyricOffsetMs = 0;
    let wordRows = [];
    let lyricInk = null;
    let curveRows = null;
    let curveScrollTop = NaN;
    let curveFocus = NaN;
    let curveShift = 0;
    let lineStarts = [];
    let hasWordTiming = false;
    let hasLineTiming = false;
    let lyricSignature = "";
    let coverUrl = "";
    let coverColorKey = "";
    let pendingCover = null;
    let previousCover = null;
    let coverRetireTimer = 0;
    let coverFadeTimer = 0;
    let opened = false;
    let settingsOnly = false;
    let activeLine = -1;
    let frameId = 0;
    let resizeId = 0;
    let toastTimer = 0;
    let resumeTimer = 0;
    let manualUntil = 0;
    let lastFocus = null;
    let dragging = false;
    let seekPreview = null;
    let destroyed = false;
    let requestedFullscreen = false;
    let switchingFullscreen = false;
    let fullscreenExitedAt = 0;
    let nativeDialogOpen = false;
    let beforeEscape = null;
    let focusBeforeNativeDialog = null;
    const suspendedTabIndexes = new Map();
    let renderedMetadata = null;
    let renderedPlayback = null;
    let renderedLyrics = null;
    let renderedTools = null;
    let appliedPreferences = null;
    let appliedLyricLayout = "";
    const simplify = options.simplify;
    if (simplify) {
      [[simplify.items, "simplify"], [simplify.distractionItems, "distraction"]].forEach(([items, group]) => {
        if (!items) return;
        const fragment = document.createDocumentFragment();
        items.forEach(item => {
          const label = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
          label.className = "setting-hide-row";
          text.textContent = item.label;
          input.type = "checkbox";
          input.dataset.simplifyId = item.id;
          label.appendChild(text); label.appendChild(input);
          fragment.appendChild(label);
        });
        $("[data-" + group + "-items]").appendChild(fragment);
        $("[data-" + group + "-group]").hidden = false;
      });
      syncSimplification();
    }

    function toast(message, duration = 4200) {
      if (destroyed) return;
      const node = $("[data-toast]");
      node.textContent = message;
      node.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { node.hidden = true; }, duration);
    }
    function copyTrackValues() {
      const track = snapshot && snapshot.track;
      const artists = track && track.artists;
      return {
        title: track && typeof track.title === "string" ? track.title : "",
        artist: Array.isArray(artists) ? artists.map(artist => typeof artist === "string" ? artist : artist && typeof artist.name === "string" ? artist.name : "").filter(name => name.trim()).join(" / ") : typeof artists === "string" ? artists : ""
      };
    }
    function closeTitleMenu(restoreFocus = false) {
      const origin = titleMenuOrigin;
      titleMenu.hidden = true;
      titleMenuOrigin = null;
      $("[data-title]").setAttribute("aria-expanded", "false");
      $("[data-artist]").setAttribute("aria-expanded", "false");
      if (restoreFocus && opened && !nativeDialogOpen && origin && origin.isConnected) origin.focus({ preventScroll: true });
    }
    function openTitleMenu(origin, clientX, clientY) {
      if (!opened || nativeDialogOpen) return;
      closeTitleMenu();
      titleMenuOrigin = origin;
      const values = copyTrackValues();
      titleMenu.querySelectorAll("[data-copy-field]").forEach(button => { button.disabled = !values[button.dataset.copyField].trim(); });
      titleMenu.hidden = false;
      titleMenu.style.left = "0px";
      titleMenu.style.top = "0px";
      const bounds = host.getBoundingClientRect();
      const menuBounds = titleMenu.getBoundingClientRect();
      const scaleX = host.clientWidth ? bounds.width / host.clientWidth : 1;
      const scaleY = host.clientHeight ? bounds.height / host.clientHeight : 1;
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      const left = Math.max(8, Math.min((clientX - bounds.left) / scaleX, width - menuBounds.width / scaleX - 8));
      const top = Math.max(8, Math.min((clientY - bounds.top) / scaleY, height - menuBounds.height / scaleY - 8));
      titleMenu.style.left = left + "px";
      titleMenu.style.top = top + "px";
      origin.setAttribute("aria-expanded", "true");
      const first = titleMenu.querySelector("button:not([disabled])");
      (first || titleMenu).focus({ preventScroll: true });
    }
    async function writeClipboardText(value) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch (_) {}
      const previousFocus = shadow.activeElement || document.activeElement;
      const selection = document.getSelection();
      const ranges = [];
      if (selection) for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i).cloneRange());
      const field = document.createElement("textarea");
      field.value = value;
      field.readOnly = true;
      field.tabIndex = -1;
      field.setAttribute("aria-hidden", "true");
      field.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      (document.body || document.documentElement).appendChild(field);
      let copied = false;
      try {
        field.focus({ preventScroll: true });
        if (document.activeElement !== field) return false;
        field.select();
        field.setSelectionRange(0, value.length);
        copied = typeof document.execCommand === "function" && document.execCommand("copy") === true;
      } catch (_) {}
      finally {
        field.remove();
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
        if (selection && ranges.length) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
      }
      return copied;
    }
    async function copyTrackField(field) {
      const value = copyTrackValues()[field];
      if (typeof value !== "string" || !value.trim()) { toast(field === "artist" ? "暂无可复制的歌手信息" : "暂无可复制的歌名", 2200); return; }
      closeTitleMenu(true);
      const copied = await writeClipboardText(value);
      if (!destroyed && opened) toast(copied ? (field === "artist" ? "已复制歌手" : "已复制歌名") : "复制失败，请稍后重试", copied ? 1800 : 3000);
    }
    function onTitleContextMenu(event) {
      if (!opened || nativeDialogOpen) return;
      const origin = event.target.closest("[data-title],[data-artist]");
      if (!origin) { closeTitleMenu(); return; }
      event.preventDefault();
      event.stopPropagation();
      const bounds = origin.getBoundingClientRect();
      openTitleMenu(origin, event.clientX || bounds.left, event.clientY || bounds.bottom);
    }
    function onTitleMenuKeydown(event) {
      if (!opened || nativeDialogOpen) return;
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      const origin = target && target.closest ? target.closest("[data-title],[data-artist]") : null;
      if (origin && (event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) {
        event.preventDefault(); event.stopImmediatePropagation();
        const bounds = origin.getBoundingClientRect();
        openTitleMenu(origin, bounds.left, bounds.bottom + 5);
        return;
      }
      if (titleMenu.hidden) return;
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault(); event.stopImmediatePropagation(); closeTitleMenu(true); return;
      }
      const items = Array.from(titleMenu.querySelectorAll("button:not([disabled])"));
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const current = items.indexOf(shadow.activeElement);
        const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        if (items[index]) items[index].focus();
      } else if (event.key === "Enter" || event.code === "Space") {
        event.preventDefault(); event.stopImmediatePropagation();
        const active = shadow.activeElement;
        if (active && active.dataset.copyField && !active.disabled) copyTrackField(active.dataset.copyField);
      }
    }
    function onTitleMenuOutside(event) {
      if (!titleMenu.hidden && !event.composedPath().includes(titleMenu)) closeTitleMenu();
    }
    function onTitleMenuViewportChange() { closeTitleMenu(); }
    shadow.addEventListener("contextmenu", onTitleContextMenu);
    titleMenu.addEventListener("click", event => {
      event.stopPropagation();
      const button = event.target.closest("[data-copy-field]");
      if (button && !button.disabled) copyTrackField(button.dataset.copyField);
    });
    function savePreferences(values) {
      Object.entries(values).forEach(([name, value]) => {
        preferences[name] = value;
        try { localStorage.setItem("ncm-immersive." + name, typeof value === "boolean" ? (value ? "on" : "off") : value); } catch (_) {}
      });
      applyPreferences();
    }
    function savePreference(name, value) { savePreferences({[name]: value}); }
    function syncSimplification() {
      if (!simplify) return;
      const hidden = simplify.get();
      shadow.querySelectorAll("[data-simplify-id]").forEach(input => { input.checked = hidden[input.dataset.simplifyId] === true; });
    }
    function savePersonalTheme() {
      const theme = Object.fromEntries(Object.keys(themeDefaults).map(name => [name, preferences[name]]));
      try { localStorage.setItem("ncm-immersive.personalTheme", JSON.stringify(theme)); }
      catch (_) { toast("个人主题未能保存，请检查客户端存储空间。"); return; }
      personalTheme = theme;
      $("[data-ncm-action=restore-theme]").disabled = false;
      toast("已保存个人主题", 1800);
    }
    function lyricContentMode() {
      const lyric = snapshot && snapshot.lyrics;
      if (!lyric) return "none";
      if (lyric.status === "instrumental") return "instrumental";
      if (lyric.status !== "ready" || !lines.length) return "none";
      return hasWordTiming ? "word" : hasLineTiming ? "line" : "plain";
    }
    function lyricMode() {
      const mode = lyricContentMode();
      return mode === "word" && !preferences.word ? "line" : mode;
    }
    function wordSyncHint() {
      if (!snapshot || !snapshot.track) return "播放歌曲后，自动匹配歌词";
      if (snapshot.lyrics && snapshot.lyrics.status === "loading") return "正在加载歌词，请稍候";
      const mode = lyricContentMode();
      if (mode === "instrumental") return "这是一首纯音乐，没有歌词";
      if (mode === "none") return "这首歌暂无歌词";
      if (mode === "plain") return "这首歌只有文字歌词，暂不支持同步高亮";
      if (mode === "line") return preferences.word ? "这首歌按整行高亮，遇到逐字歌词时自动切换" : "已关闭，按整行高亮";
      return preferences.word ? "已开启，歌词跟着歌声逐字亮起" : "已关闭，当前按整行高亮";
    }
    function applyPreferences(force = true) {
      const motion = preferences.motion;
      const hint = wordSyncHint();
      const mode = lyricMode();
      const fields = [motion, preferences.fontFamily, mode, preferences.translation, preferences.word, hint, hasTranslation(), Boolean(snapshot && snapshot.track), preferences.lyricCurve, preferences.accent, ...Object.keys(adjustments).map(name => preferences[name])];
      if (appliedPreferences && fields.every((value, index) => value === appliedPreferences[index])) return;
      const motionChanged = !appliedPreferences || motion !== appliedPreferences[0];
      appliedPreferences = fields;
      view.dataset.motion = String(motion);
      view.dataset.fontFamily = preferences.fontFamily;
      view.dataset.lyricMode = mode;
      view.dataset.translation = String(preferences.translation);
      updateTranslationButton();
      $("[data-setting=motion]").checked = motion;
      if (motionChanged) syncBackdrop();
      $("[data-setting=word]").checked = preferences.word;
      $("[data-word-hint]").textContent = hint;
      shadow.querySelectorAll("[data-preference]").forEach(input => {
        const name = input.dataset.preference, setting = adjustments[name], value = preferences[name];
        const label = String(value) + setting.unit;
        input.value = String(value);
        input.style.setProperty("--progress", ((value - setting.min) / (setting.max - setting.min) * 100) + "%");
        input.setAttribute("aria-valuetext", label);
        $('[data-adjustment-value="' + name + '"]').textContent = label;
      });
      view.style.setProperty("--ambient-brightness", preferences.brightness / 100);
      view.style.setProperty("--ambient-blur", preferences.blur + "px");
      view.style.setProperty("--ambient-saturation", preferences.saturation / 100);
      view.style.setProperty("--lyric-accent", preferences.accent);
      view.style.setProperty("--lyric-size-factor", preferences.lyricSize / 44);
      view.style.setProperty("--lyric-line-spacing", preferences.lineSpacing);
      view.style.setProperty("--lyric-gap-factor", preferences.lineSpacing / 2);
      view.style.setProperty("--translation-scale", preferences.translationSize / 44);
      view.style.setProperty("--unsung-opacity", preferences.unsungOpacity / 100);
      $("[data-accent]").value = preferences.accent;
      $("[data-ncm-action=restore-theme]").disabled = !personalTheme;
      $("[data-lyric-preset]").value = Object.keys(lyricPresets).find(name => Object.entries(lyricPresets[name]).every(([key, value]) => preferences[key] === value)) || "custom";
      $("select[data-font-family]").value = preferences.fontFamily;
      const curve = $("[data-lyric-curve]");
      const curveLabel = preferences.lyricCurve ? preferences.lyricCurve + "%" : "直排";
      curve.value = String(preferences.lyricCurve);
      curve.style.setProperty("--progress", preferences.lyricCurve + "%");
      curve.setAttribute("aria-valuetext", preferences.lyricCurve ? "弯曲 " + curveLabel : curveLabel);
      $("[data-curve-value]").textContent = curveLabel;
      const layout = [preferences.fontFamily, preferences.lyricSize, preferences.lineSpacing, preferences.translationSize, preferences.translation, preferences.lyricCurve, mode].join("|");
      const layoutChanged = layout !== appliedLyricLayout;
      if (layoutChanged) {
        appliedLyricLayout = layout;
        curveRows = null;
        lyricInk = null;
        if (opened) centerLine(false);
      }
      // Progress samples already feed the open view's animation loop.
      if (snapshot && force !== false) renderPosition(layoutChanged);
    }
    function syncBackdrop() {
      const running = artworkMotion();
      backdrop.setRunning(running);
      if (!running) finishCoverTransition();
    }
    function onSystemMotionChange() {
      preferences.motion = readPreference("motion", motionQuery.matches ? "off" : "on") === "on";
      applyPreferences();
      syncBackdrop();
    }
    function hasTranslation() {
      return Boolean(snapshot && snapshot.track && lines.some(line => line.translation && String(line.translation).trim()));
    }
    function updateTranslationButton() {
      const available = hasTranslation();
      const button = $("[data-ncm-action=translation]");
      const title = available ? (preferences.translation ? "隐藏歌词译文" : "显示歌词译文") : snapshot && snapshot.track ? "这首歌暂无译文" : "播放歌曲后查看译文";
      button.setAttribute("aria-pressed", String(available && preferences.translation));
      button.setAttribute("aria-disabled", String(!available));
      button.setAttribute("aria-label", title);
      button.title = title;
    }
    function suspendViewFocus() {
      shadow.querySelectorAll("button,input,select,summary,[tabindex]").forEach(node => {
        if (!suspendedTabIndexes.has(node)) suspendedTabIndexes.set(node, node.getAttribute("tabindex"));
        node.setAttribute("tabindex", "-1");
      });
    }
    function setNativeDialogOpen(open) {
      const next = Boolean(open);
      if (nativeDialogOpen === next) return;
      nativeDialogOpen = next;
      host.dataset.nativeDialogOpen = String(next);
      view.setAttribute("aria-modal", String(!next && !settingsOnly));
      if (next) {
        // A document-level portal sits outside the web fullscreen fallback.
        if (document.fullscreenElement === host) document.exitFullscreen().catch(() => {});
        closeTitleMenu();
        view.setAttribute("aria-hidden", "true");
        focusBeforeNativeDialog = shadow.activeElement;
        suspendViewFocus();
        if (focusBeforeNativeDialog && typeof focusBeforeNativeDialog.blur === "function") focusBeforeNativeDialog.blur();
      } else {
        view.removeAttribute("aria-hidden");
        suspendedTabIndexes.forEach((value, node) => { if (value === null) node.removeAttribute("tabindex"); else node.setAttribute("tabindex", value); });
        suspendedTabIndexes.clear();
        if (opened || settingsOnly) {
          if (focusBeforeNativeDialog && focusBeforeNativeDialog.isConnected && !focusBeforeNativeDialog.disabled && focusBeforeNativeDialog.getClientRects().length) focusBeforeNativeDialog.focus();
          else if (settingsOnly) $("[data-ncm-action=close-settings]").focus();
          else view.focus();
        }
        focusBeforeNativeDialog = null;
      }
    }
    function updateTools() {
      const tools = snapshot && snapshot.tools || {};
      const modes = { loop: "列表循环", single: "单曲循环", shuffle: "随机播放", order: "顺序播放", heart: "心动模式", fm: "私人漫游" };
      const hasTrack = Boolean(snapshot && snapshot.track);
      const modeVisible = hasTrack && tools.modeAvailable && Boolean(modes[tools.mode]) && typeof bridge.cycleMode === "function";
      const volumeVisible = hasTrack && tools.volumeAvailable && finite(tools.volume) && tools.volume >= 0 && tools.volume <= 100 && typeof bridge.setVolume === "function";
      const volume = volumeVisible ? Math.round(tools.volume) : null;
      const collectionDisabled = !hasTrack || !tools.collectionAvailable || typeof bridge.openCollection !== "function";
      const queueDisabled = !tools.queueAvailable || typeof bridge.openQueue !== "function";
      const fields = [modeVisible, tools.mode, volumeVisible, volume, collectionDisabled, hasTrack, queueDisabled];
      const volumeInput = $("[data-volume]");
      const changed = !renderedTools || fields.some((value, index) => value !== renderedTools[index]);
      // A dragged value may need reconciling after focus leaves, even if the host value is unchanged.
      if (!changed) {
        if (volumeVisible && shadow.activeElement !== volumeInput && volumeInput.value !== String(volume)) showVolume(volume);
        return;
      }
      renderedTools = fields;
      const modeButton = $("[data-ncm-action=mode]");
      const volumeControl = $("[data-volume-control]");
      const volumeButton = $("[data-ncm-action=volume]");
      const collectionButton = $("[data-ncm-action=collection]");
      modeButton.hidden = !modeVisible;
      if (!modeButton.hidden) {
        const title = "播放模式：" + modes[tools.mode] + "，点击切换";
        modeButton.title = title;
        modeButton.setAttribute("aria-label", title);
        if (modeButton.dataset.mode !== tools.mode) modeButton.innerHTML = icon(tools.mode);
        modeButton.dataset.mode = tools.mode;
      }
      volumeControl.hidden = !volumeVisible;
      if (!volumeControl.hidden) {
        const title = "音量：" + volume + "%";
        volumeButton.title = title;
        volumeButton.setAttribute("aria-label", title);
        const volumeIcon = volume === 0 ? "muted" : "volume";
        if (volumeButton.dataset.icon !== volumeIcon) volumeButton.innerHTML = icon(volumeIcon);
        volumeButton.dataset.icon = volumeIcon;
        if (shadow.activeElement !== volumeInput) showVolume(volume);
      } else setVolumeOpen(false, false);
      collectionButton.disabled = collectionDisabled;
      collectionButton.title = collectionButton.disabled ? (hasTrack ? "当前歌曲暂不支持收藏到歌单" : "播放歌曲后收藏到歌单") : "收藏到歌单";
      collectionButton.setAttribute("aria-label", collectionButton.title);
      const queueButton = $("[data-ncm-action=queue]");
      queueButton.disabled = queueDisabled;
      queueButton.title = queueDisabled ? "当前播放模式暂无队列" : "播放队列";
      queueButton.setAttribute("aria-label", queueButton.title);
    }
    function showVolume(value) {
      const input = $("[data-volume]");
      input.value = String(value);
      input.style.setProperty("--progress", value + "%");
      input.setAttribute("aria-valuetext", value + "%");
      $("[data-volume-value]").textContent = value + "%";
    }
    function setVolumeOpen(open, restoreFocus = true) {
      $(".volume-panel").hidden = !open;
      $("[data-ncm-action=volume]").setAttribute("aria-expanded", String(open));
      if (open) {
        if (snapshot && snapshot.tools && finite(snapshot.tools.volume)) showVolume(Math.round(snapshot.tools.volume));
        $("[data-volume]").focus();
      } else if (restoreFocus) $("[data-ncm-action=volume]").focus();
    }
    function currentPosition(visual = false) {
      const playback = snapshot && snapshot.playback;
      const clock = visual && playback && playback.visualClock || playback;
      if (!clock || !finite(clock.positionMs)) return null;
      let value = clock.positionMs;
      if (playback.state === "playing" && finite(clock.sampledAt)) {
        const interpolationLimit = finite(clock.maxInterpolationMs) ? Math.max(0, clock.maxInterpolationMs) : 1000;
        const rate = visual && finite(clock.rate) ? clock.rate : 1;
        value += Math.min(Math.max(0, Date.now() - clock.sampledAt), interpolationLimit) * rate;
      }
      const duration = getDuration();
      return Math.max(0, finite(duration) && duration > 0 ? Math.min(duration, value) : value);
    }
    function getDuration() {
      if (!snapshot) return null;
      if (snapshot.playback && finite(snapshot.playback.durationMs)) return snapshot.playback.durationMs;
      return snapshot.track && finite(snapshot.track.durationMs) ? snapshot.track.durationMs : null;
    }
    function centerLine(animate) {
      if (!opened || activeLine < 0 || !lyricTrack.children[activeLine]) return;
      updateLyricCurve();
      const node = lyricTrack.children[activeLine];
      const top = node.offsetTop - lyricTrack.offsetTop - (viewport.clientHeight - node.offsetHeight) * 0.46;
      viewport.scrollTo({ top: Math.max(0, top), behavior: animate && view.dataset.motion === "true" ? "smooth" : "auto" });
    }
    function updateLyricCurve() {
      if (!opened || viewport.hidden) return;
      if (!preferences.lyricCurve) {
        if (curveShift) {
          lyricTrack.style.setProperty("--lyric-curve-space", "0px");
          for (const row of lyricTrack.children) row.style.removeProperty("transform");
          curveShift = 0;
          curveRows = null;
          lyricInk = null;
        }
        return;
      }
      if (!curveRows) {
        curveShift = Math.min(96, viewport.clientWidth * 0.2) * preferences.lyricCurve / 100;
        lyricTrack.style.setProperty("--lyric-curve-space", curveShift + "px");
        // Reserve the widest displacement before measuring line wraps and ink.
        lyricInk = null;
        curveRows = Array.from(lyricTrack.children, node => ({
          node, center: node.offsetTop + node.offsetHeight / 2, height: node.offsetHeight
        }));
        curveScrollTop = NaN;
      }
      const height = viewport.clientHeight;
      const current = curveRows[activeLine];
      const focus = height * 0.46 + (current ? current.height * 0.04 : 0);
      const scrollTop = viewport.scrollTop;
      if (scrollTop === curveScrollTop && focus === curveFocus) return;
      curveScrollTop = scrollTop;
      curveFocus = focus;
      // The existing scroll animation supplies motion; horizontal easing would lag.
      for (const row of curveRows) {
        const distance = Math.min(1, Math.abs(row.center - scrollTop - focus) / Math.max(1, height * 0.54));
        const transform = curveShift ? "translateX(" + (curveShift * distance * distance).toFixed(2) + "px)" : "";
        if (row.node.style.transform !== transform) row.node.style.transform = transform;
      }
    }
    function recenter() {
      manualUntil = 0;
      clearTimeout(resumeTimer);
      $("[data-ncm-action=recenter]").hidden = true;
      centerLine(true);
    }
    function manualScroll() {
      if (!lines.length || lyricMode() === "plain") return;
      manualUntil = Date.now() + 4500;
      $("[data-ncm-action=recenter]").hidden = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(recenter, 4600);
    }
    function clearLyrics() {
      suspendedTabIndexes.forEach((_, node) => {
        if (lyricTrack.contains(node)) suspendedTabIndexes.delete(node);
      });
      if (focusBeforeNativeDialog && lyricTrack.contains(focusBeforeNativeDialog)) focusBeforeNativeDialog = null;
      lyricTrack.textContent = "";
      lyricInk = null;
      curveRows = null;
      wordRows = [];
      lineStarts = [];
      activeLine = -1;
      view.dataset.activeLine = "-1";
    }
    function buildLyrics() {
      clearLyrics();
      const fragment = document.createDocumentFragment();
      lines.forEach((line, index) => {
        const words = timedWords(line);
        const rawStart = finite(line.startMs) ? line.startMs : words.length ? Math.min(...words.map(word => word.startMs)) : null;
        const start = finite(rawStart) ? Math.max(0, rawStart - lyricOffsetMs) : null;
        wordRows.push(words);
        lineStarts.push(start);
        const button = document.createElement("button");
        button.className = "lyric-line";
        button.type = "button";
        button.dataset.lineIndex = String(index);
        button.dataset.startMs = finite(start) ? String(start) : "";
        const seekable = finite(start) && snapshot.capabilities.seek;
        button.disabled = !seekable;
        button.setAttribute("aria-label", seekable ? "跳至 " + time(start) + "，" + line.text : line.text);
        const text = document.createElement("span");
        text.className = "lyric-text";
        text.textContent = words.length ? words.map(word => word.text).join("") : line.text;
        if (words.length) text.classList.add("word-timed");
        button.appendChild(text);
        if (line.translation) {
          const translation = document.createElement("span");
          translation.className = "lyric-translation";
          translation.textContent = line.translation;
          button.appendChild(translation);
        }
        fragment.appendChild(button);
      });
      lyricTrack.appendChild(fragment);
      viewport.scrollTop = 0;
      manualUntil = 0;
      clearTimeout(resumeTimer);
      $("[data-ncm-action=recenter]").hidden = true;
    }
    function renderPosition(force) {
      updateLyricCurve();
      const displayPosition = currentPosition();
      const position = currentPosition(true);
      const duration = getDuration();
      if (seekPreview && (Date.now() - seekPreview.requestedAt >= 1500 || finite(position) && Math.abs(position - seekPreview.targetMs) <= 500)) seekPreview = null;
      if (!dragging) {
        const sliderPosition = seekPreview ? seekPreview.targetMs : position;
        const max = finite(duration) && duration > 0 ? String(duration) : "1";
        if (progress.max !== max) progress.max = max;
        const sliderMs = finite(sliderPosition) ? Math.round(sliderPosition) : 0;
        if (progress.valueAsNumber !== sliderMs) {
          progress.value = String(sliderMs);
          progress.style.setProperty("--progress", (sliderMs / Number(max) * 100) + "%");
        }
        const label = time(seekPreview ? seekPreview.targetMs : displayPosition);
        const aria = (seekPreview ? "正在跳转至 " : "") + label + " / " + time(duration);
        if (progress.getAttribute("aria-valuetext") !== aria) progress.setAttribute("aria-valuetext", aria);
        if (positionLabel.textContent !== label) positionLabel.textContent = label;
      }
      const total = time(duration);
      if (durationLabel.textContent !== total) durationLabel.textContent = total;
      if (!opened) return;
      let index = -1;
      if (lyricMode() !== "plain" && finite(position)) {
        for (let i = 0; i < lines.length; i += 1) {
          if (finite(lineStarts[i]) && lineStarts[i] <= position) index = i;
          else if (finite(lineStarts[i]) && lineStarts[i] > position) break;
        }
      }
      if (index !== activeLine || force) {
        for (let i = 0; i < lyricTrack.children.length; i += 1) {
          const node = lyricTrack.children[i];
          node.classList.toggle("is-current", i === index);
          node.classList.toggle("is-past", index >= 0 && i < index);
          node.classList.toggle("is-upcoming", i > index);
          if (i === index) node.setAttribute("aria-current", "true");
          else node.removeAttribute("aria-current");
        }
        const previous = activeLine;
        activeLine = index;
        view.dataset.activeLine = String(index);
        if (Date.now() >= manualUntil) centerLine(!force && previous !== -1);
      }
      if (index >= 0 && lyricMode() === "word") {
        const words = wordRows[index] || [];
        if (words.length && opened) {
          const text = lyricTrack.children[index].firstElementChild;
          if (force || !lyricInk || lyricInk.text !== text) lyricInk = measureLyricInk(text, words);
          paintLyricInk(lyricInk, position + lyricOffsetMs);
        }
      }
    }
    function artworkMotion() { return opened && !document.hidden && preferences.motion && !motionQuery.matches; }
    function releaseCover(image) {
      if (!image) return;
      image.onload = image.onerror = null;
      image.removeAttribute("src");
      image.remove();
    }
    function finishCoverTransition() {
      clearTimeout(coverFadeTimer);
      coverFadeTimer = 0;
      $("[data-cover]").classList.remove("is-entering");
      releaseCover(previousCover);
      previousCover = null;
    }
    function clearCoverDisplay(state) {
      finishCoverTransition();
      const image = $("[data-cover]"), animate = artworkMotion();
      if (animate && image.naturalWidth && !image.hidden) {
        const placeholder = document.createElement("img");
        placeholder.className = "cover-art";
        placeholder.setAttribute("data-cover", "");
        placeholder.alt = "";
        placeholder.hidden = true;
        image.removeAttribute("data-cover");
        image.alt = "";
        image.classList.add("is-leaving");
        previousCover = image;
        $(".cover-wrap").appendChild(placeholder);
        coverFadeTimer = setTimeout(finishCoverTransition, 640);
      } else { image.hidden = true; image.removeAttribute("src"); }
      $(".cover-wrap").dataset.coverState = state;
      backdrop.setCover(null, animate);
      if (options.onCover) options.onCover(null);
    }
    function updateCover(url, title, force = false) {
      const alt = title ? title + " · 专辑封面" : "专辑封面";
      $("[data-cover]").alt = alt;
      if (pendingCover) pendingCover.alt = alt;
      if (url === coverUrl && (!force || pendingCover)) return;
      coverUrl = url;
      releaseCover(pendingCover);
      pendingCover = null;
      clearTimeout(coverRetireTimer);
      if (!url) { clearCoverDisplay("empty"); return; }
      $(".cover-wrap").dataset.coverState = "loading";
      const image = document.createElement("img");
      image.className = "cover-art";
      image.alt = alt;
      pendingCover = image;
      // Keep the outgoing artwork briefly while the next cover loads. A slow or
      // failed request must never leave the previous song's artwork on screen.
      if (artworkMotion()) coverRetireTimer = setTimeout(() => {
        if (pendingCover === image) clearCoverDisplay("loading");
      }, 900);
      else clearCoverDisplay("loading");
      image.onload = () => {
        if (destroyed || pendingCover !== image) return;
        pendingCover = null;
        clearTimeout(coverRetireTimer);
        image.onload = image.onerror = null;
        finishCoverTransition();
        if (!opened) {
          if (options.onCover) options.onCover(image, url);
          releaseCover(image);
          return;
        }
        const old = $("[data-cover]"), animate = artworkMotion();
        if (animate && old.naturalWidth && !old.hidden) {
          old.removeAttribute("data-cover");
          old.alt = "";
          previousCover = old;
        } else releaseCover(old);
        image.setAttribute("data-cover", "");
        if (animate) {
          image.classList.add("is-entering");
          coverFadeTimer = setTimeout(finishCoverTransition, 640);
        }
        $(".cover-wrap").appendChild(image);
        $(".cover-wrap").dataset.coverState = "ready";
        backdrop.setCover(image, animate);
        if (options.onCover) options.onCover(image, url);
        syncBackdrop();
      };
      image.onerror = () => {
        if (destroyed || pendingCover !== image) return;
        pendingCover = null;
        clearTimeout(coverRetireTimer);
        releaseCover(image);
        clearCoverDisplay("unavailable");
      };
      image.src = url;
    }
    function receive(next) {
      if (destroyed || !next) return;
      const rgb = next.coverColor;
      const colorKey = rgb ? rgb.join(",") : "";
      if (colorKey !== coverColorKey) {
        coverColorKey = colorKey;
        if (rgb) {
          host.style.setProperty("--ncm-cover-panel-rgb", rgb.map(value => Math.round(value * .28 + 14)).join(","));
          host.style.setProperty("--ncm-cover-panel-accent", "rgb(" + rgb.map(value => Math.round(value * .18 + 205)).join(",") + ")");
        } else {
          host.style.removeProperty("--ncm-cover-panel-rgb");
          host.style.removeProperty("--ncm-cover-panel-accent");
        }
      }
      const nextTrackId = next.track ? String(next.track.id || "") : "";
      if (nextTrackId !== view.dataset.trackId) { dragging = false; seekPreview = null; closeTitleMenu(); }
      snapshot = next;
      if (opened && isFullscreen() !== (view.dataset.fullscreen === "true")) onFullscreenChange();
      const track = next.track;
      const playback = next.playback || {};
      const capability = next.capabilities || {};
      const lyric = next.lyrics || { status: "unavailable", kind: "none", lines: [] };
      const artists = track && Array.isArray(track.artists) ? track.artists.map(artist => typeof artist === "string" ? artist : artist.name).filter(Boolean).join(" / ") : track && track.artists;
      const title = track && track.title ? track.title : "尚未播放";
      const artist = track ? (artists || "未知歌手") : "从网易云音乐选择一首歌";
      const album = track && track.album ? (typeof track.album === "string" ? track.album : track.album.name || "") : "";
      const cover = track && track.coverUrl ? track.coverUrl : "";
      const metadata = [nextTrackId, title, artist, album, cover];
      if (!renderedMetadata || metadata.some((value, index) => value !== renderedMetadata[index])) {
        renderedMetadata = metadata;
        view.dataset.trackId = nextTrackId;
        const displayed = window.NcmTouhouNames?.splitTitle(title) || {title, annotation: ""};
        $("[data-title]").textContent = displayed.title;
        $("[data-title]").setAttribute("aria-label", title);
        $("[data-title-annotation]").textContent = displayed.annotation;
        $("[data-title-annotation]").hidden = !displayed.annotation;
        $("[data-artist]").textContent = artist;
        $("[data-album]").textContent = album;
        $("[data-album]").hidden = !album;
        updateCover(cover, track && track.title);
      }
      const duration = getDuration();
      const controls = [playback.state || "unknown", Boolean(capability.playPause), Boolean(capability.previous), Boolean(capability.next), Boolean(capability.seek), duration];
      if (!renderedPlayback || controls.some((value, index) => value !== renderedPlayback[index])) {
        renderedPlayback = controls;
        view.dataset.playing = String(playback.state === "playing");
        view.dataset.playbackState = playback.state || "unknown";
        $("[data-ncm-action=play]").disabled = !capability.playPause;
        $("[data-ncm-action=play]").setAttribute("aria-label", playback.state === "playing" ? "暂停" : "播放");
        $("[data-ncm-action=previous]").disabled = !capability.previous;
        $("[data-ncm-action=next]").disabled = !capability.next;
        progress.disabled = !capability.seek || !finite(duration) || duration <= 0;
      }
      const signature = String(track && track.id) + "|" + lyric.status + "|" + lyric.kind + "|" + Boolean(capability.seek);
      const offset = finite(lyric.offsetMs) ? lyric.offsetMs : 0;
      const lyricsChanged = signature !== lyricSignature || offset !== lyricOffsetMs || (Array.isArray(lyric.lines) && lyric.lines !== lines);
      if (lyricsChanged) {
        lyricSignature = signature;
        lyricOffsetMs = offset;
        lines = Array.isArray(lyric.lines) ? lyric.lines : [];
        hasWordTiming = lines.some(line => timedWords(line).length > 0);
        hasLineTiming = hasWordTiming || lines.some(line => finite(line.startMs));
        if (opened) buildLyrics();
      }
      const hasLyrics = lyric.status === "ready" && lines.length > 0;
      const lyricFields = [Boolean(track), lyric.status, lyric.kind, lyric.source || "", hasLyrics, Boolean(lyric.translationAvailable)];
      if (lyricsChanged || !renderedLyrics || lyricFields.some((value, index) => value !== renderedLyrics[index])) {
        renderedLyrics = lyricFields;
        view.dataset.lyricSource = lyric.source || "";
        viewport.hidden = !hasLyrics;
        $("[data-lyric-empty]").hidden = hasLyrics;
        let emptyTitle = "暂无歌词";
        let emptyDetail = "让旋律继续陪伴你";
        if (!track) { emptyTitle = "音乐，等你开启"; emptyDetail = "播放后，歌词会在这里与你相遇"; }
        else if (lyric.status === "loading") { emptyTitle = "正在寻找歌词"; emptyDetail = "跟随当前播放歌曲读取"; }
        else if (lyric.status === "instrumental") { emptyTitle = "让音乐，慢慢流淌"; emptyDetail = "此刻，只用聆听"; }
        $("[data-empty-title]").textContent = emptyTitle;
        $("[data-empty-detail]").textContent = emptyDetail;
        applyPreferences(false);
      }
      updateTools();
      if (nativeDialogOpen && lyricsChanged) suspendViewFocus();
    }
    async function action(method, value) {
      if (destroyed || typeof bridge[method] !== "function") return;
      try {
        const result = await bridge[method](value);
        if (result && result.ok === false) toast(result.error || "暂时无法操作，请回到网易云音乐重试。");
        return result;
      } catch (_) { toast("暂时无法操作，请回到网易云音乐重试。"); }
    }
    function requestSeek(value) {
      const preview = { targetMs: value, requestedAt: Date.now() };
      seekPreview = preview;
      dragging = false;
      renderPosition(false);
      action("seek", value).then(result => {
        if (destroyed || seekPreview !== preview) return;
        if (!result || result.ok === false) { seekPreview = null; renderPosition(false); }
      });
      recenter();
    }
    function tick() {
      if (!opened || destroyed) return;
      renderPosition(false);
      frameId = requestAnimationFrame(tick);
    }
    function setSettings(open, restoreFocus = true) {
      if (open) setVolumeOpen(false, false);
      if (open) syncSimplification();
      settingsPanel.hidden = !open;
      $("[data-ncm-action=settings]").setAttribute("aria-expanded", String(open));
      if (!open && settingsOnly) {
        settingsOnly = false;
        view.dataset.settingsOnly = "false";
        view.hidden = true;
        view.setAttribute("aria-label", "沉浸听歌");
        view.setAttribute("aria-modal", String(!nativeDialogOpen));
        if (restoreFocus && !nativeDialogOpen && lastFocus && lastFocus.isConnected && typeof lastFocus.focus === "function") lastFocus.focus();
      } else if (!nativeDialogOpen) {
        if (open) $("[data-ncm-action=close-settings]").focus();
        else if (restoreFocus) $("[data-ncm-action=settings]").focus();
      }
    }
    function openSettings() {
      if (destroyed) return;
      if (!opened && !settingsOnly) {
        lastFocus = document.activeElement;
        settingsOnly = true;
        view.dataset.settingsOnly = "true";
        view.hidden = false;
        view.setAttribute("aria-label", "听歌设置");
        view.setAttribute("aria-modal", "false");
      }
      setSettings(true);
    }
    function onSettingsOutside(event) {
      if (!settingsOnly || nativeDialogOpen) return;
      const path = event.composedPath();
      if (path.some(node => node.id === "ncm-immersive-settings-entry")) return;
      if (!path.includes(settingsPanel)) setSettings(false, false);
    }
    function open() {
      if (opened || destroyed) return;
      if (!settingsOnly) lastFocus = document.activeElement;
      settingsOnly = false;
      view.dataset.settingsOnly = "false";
      view.setAttribute("aria-label", "沉浸听歌");
      view.setAttribute("aria-modal", String(!nativeDialogOpen));
      opened = true;
      dragging = false;
      seekPreview = null;
      manualUntil = 0;
      $("[data-ncm-action=recenter]").hidden = true;
      view.hidden = false;
      view.dataset.open = "true";
      document.documentElement.setAttribute("data-ncm-player-open", "");
      updateCover(coverUrl, snapshot && snapshot.track && snapshot.track.title, true);
      buildLyrics();
      onFullscreenChange();
      syncBackdrop();
      if (typeof bridge.sample === "function") Promise.resolve(bridge.sample()).then(receive).catch(() => {});
      if (nativeDialogOpen) suspendViewFocus();
      else if (!settingsPanel.hidden) $("[data-ncm-action=close-settings]").focus();
      else view.focus();
      renderPosition(true);
      frameId = requestAnimationFrame(tick);
    }
    function close() {
      closeTitleMenu();
      if (!opened) return;
      opened = false;
      dragging = false;
      seekPreview = null;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(resizeId);
      clearTimeout(resumeTimer);
      clearTimeout(coverRetireTimer);
      if (pendingCover) clearCoverDisplay("loading");
      settingsPanel.hidden = true;
      setVolumeOpen(false, false);
      $("[data-ncm-action=settings]").setAttribute("aria-expanded", "false");
      view.hidden = true;
      view.dataset.open = "false";
      clearLyrics();
      finishCoverTransition();
      $("[data-cover]").removeAttribute("src");
      backdrop.setCover(null);
      document.documentElement.removeAttribute("data-ncm-player-open");
      syncBackdrop();
      if (requestedFullscreen) setFullscreen(false).catch(() => {});
      requestedFullscreen = false;
      document.documentElement.removeAttribute("data-ncm-player-fullscreen");
      if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === "function") lastFocus.focus();
    }
    function requestClose() {
      if (typeof options.onClose === "function") options.onClose();
    }
    function isFullscreen() {
      return Boolean(snapshot && snapshot.detailFullscreen || document.fullscreenElement);
    }
    async function setFullscreen(enabled) {
      if (!enabled && document.fullscreenElement) await document.exitFullscreen();
      if (!enabled || !document.fullscreenElement) {
        const native = bridge.setDetailFullscreen && bridge.setDetailFullscreen(enabled);
        if (native) await native;
        else if (enabled) await host.requestFullscreen();
      }
    }
    async function fullscreen() {
      if (switchingFullscreen) return;
      const enter = !isFullscreen();
      switchingFullscreen = true;
      if (enter) {
        closeTitleMenu();
        setVolumeOpen(false, false);
        settingsPanel.hidden = true;
        $("[data-ncm-action=settings]").setAttribute("aria-expanded", "false");
        requestedFullscreen = true;
      }
      try {
        await setFullscreen(enter);
        if (enter && !opened && (!destroyed || document.fullscreenElement === host)) await setFullscreen(false);
      } catch (_) {
        toast(enter ? "无法进入全屏" : "无法退出全屏");
      } finally {
        switchingFullscreen = false;
        onFullscreenChange();
      }
    }
    function onFullscreenChange() {
      if (destroyed) return;
      const expanded = opened && isFullscreen();
      const wasExpanded = view.dataset.fullscreen === "true";
      view.dataset.fullscreen = String(expanded);
      if (expanded !== wasExpanded) curveRows = null;
      document.documentElement.toggleAttribute("data-ncm-player-fullscreen", expanded);
      $("[data-ncm-action=fullscreen]").setAttribute("aria-pressed", String(expanded));
      $("[data-ncm-action=fullscreen]").setAttribute("aria-label", expanded ? "退出全屏" : "进入全屏");
      if (expanded && !wasExpanded) toast("按 Esc 退出", 2200);
      if (!expanded) {
        if (!switchingFullscreen) requestedFullscreen = false;
        if (wasExpanded) fullscreenExitedAt = Date.now();
        if ($("[data-toast]").textContent === "按 Esc 退出") $("[data-toast]").hidden = true;
      }
      if (expanded !== wasExpanded) {
        closeTitleMenu();
        if (opened && !nativeDialogOpen) view.focus();
      }
      centerLine(false);
    }
    function onKeydown(event) {
      if ((!opened && !settingsOnly) || nativeDialogOpen) return;
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      if (event.key === "Escape" && target && target.tagName === "SELECT") return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat) return;
        if (beforeEscape && beforeEscape()) return;
        if (settingsOnly) { setSettings(false); return; }
        if (switchingFullscreen) return;
        if (isFullscreen()) { fullscreen(); return; }
        // CEF may exit fullscreen before delivering this same native Esc keydown.
        if (Date.now() - fullscreenExitedAt < 300) return;
        if (!settingsPanel.hidden) setSettings(false);
        else if (!$(".volume-panel").hidden) setVolumeOpen(false);
        else requestClose();
        return;
      }
      if (event.key === "Tab") {
        const area = settingsPanel.hidden ? view : settingsPanel;
        const focusable = Array.from(area.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex='0']")).filter(node => !node.hidden && node.getClientRects().length > 0);
        const first = focusable[0], last = focusable[focusable.length - 1], active = shadow.activeElement;
        if (!focusable.length) { event.preventDefault(); return; }
        if (event.shiftKey && (active === first || active === view)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || active === view)) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || !settingsPanel.hidden || target && target.closest && target.closest("input,button,textarea,select,[contenteditable]")) return;
      if (event.code === "Space") { event.preventDefault(); event.stopImmediatePropagation(); if (snapshot && snapshot.capabilities.playPause) action("togglePlay"); }
      else if (event.code === "KeyF") { event.preventDefault(); event.stopImmediatePropagation(); fullscreen(); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        const position = currentPosition();
        if (finite(position) && snapshot.capabilities.seek) requestSeek(Math.max(0, Math.min(getDuration() || Infinity, position + (event.key === "ArrowRight" ? 5000 : -5000))));
      }
    }
    shadow.addEventListener("click", event => {
      if (nativeDialogOpen) return;
      event.stopPropagation();
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.hasAttribute("data-line-index")) { const start = lineStarts[Number(button.dataset.lineIndex)]; if (finite(start)) requestSeek(start); return; }
      switch (button.dataset.ncmAction) {
        case "close": requestClose(); break;
        case "play": action("togglePlay"); break;
        case "previous": action("previous"); break;
        case "next": action("next"); break;
        case "mode": action("cycleMode"); break;
        case "volume": setVolumeOpen($(".volume-panel").hidden); break;
        case "collection": action("openCollection"); break;
        case "queue": action("openQueue"); break;
        case "translation":
          if (!hasTranslation()) { toast(snapshot && snapshot.track ? "这首歌暂无译文" : "播放歌曲后查看译文", 2200); break; }
          savePreference("translation", !preferences.translation); requestAnimationFrame(() => centerLine(false)); break;
        case "fullscreen": fullscreen(); break;
        case "settings": setSettings(settingsPanel.hidden); break;
        case "close-settings": setSettings(false); break;
        case "recenter": recenter(); break;
        case "save-theme": savePersonalTheme(); break;
        case "restore-theme": if (personalTheme) savePreferences(personalTheme); break;
        case "reset-theme": savePreferences(themeDefaults); break;
        case "reset-lyrics": savePreferences({lyricSize: 44, lineSpacing: 1.4, translationSize: 18, unsungOpacity: 50, fontFamily: "system", lyricCurve: 0}); break;
        case "reset-simplify": if (simplify) { simplify.reset(); syncSimplification(); } break;
        case "reset-distractions": if (simplify) { simplify.reset("distractions"); syncSimplification(); } break;
      }
    });
    view.addEventListener("click", event => {
      if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !event.target.closest("[data-ncm-action=settings]")) setSettings(false);
      if (!$(".volume-panel").hidden && !event.target.closest("[data-volume-control]")) setVolumeOpen(false, false);
    });
    shadow.addEventListener("change", event => {
      if (nativeDialogOpen) return;
      if (event.target.dataset.setting) savePreference(event.target.dataset.setting, event.target.checked);
      else if (event.target.matches("select[data-font-family]")) { savePreference("fontFamily", normalizeFontFamily(event.target.value)); requestAnimationFrame(() => centerLine(false)); }
      else if (event.target.matches("[data-lyric-preset]") && lyricPresets[event.target.value]) savePreferences(lyricPresets[event.target.value]);
      else if (event.target.hasAttribute("data-simplify-id") && simplify) { simplify.set(event.target.dataset.simplifyId, event.target.checked); syncSimplification(); }
    });
    shadow.addEventListener("input", event => {
      if (nativeDialogOpen) return;
      const name = event.target.dataset.preference;
      if (adjustments[name]) savePreference(name, normalizeAdjustment(name, event.target.value));
      else if (event.target.matches("[data-accent]")) savePreference("accent", normalizeAccent(event.target.value));
    });
    $("[data-lyric-curve]").addEventListener("input", event => {
      if (!nativeDialogOpen) savePreference("lyricCurve", normalizeLyricCurve(event.target.value));
    });
    // Keep playback shortcuts in the overlay from reaching native document handlers.
    view.addEventListener("keydown", event => { if (!nativeDialogOpen) event.stopPropagation(); });
    view.addEventListener("focusin", event => { if (nativeDialogOpen && typeof event.target.blur === "function") event.target.blur(); });
    progress.addEventListener("pointerdown", event => { if (event.button === 0) dragging = true; });
    progress.addEventListener("input", () => {
      if (nativeDialogOpen) return;
      dragging = true;
      const value = Number(progress.value);
      $("[data-position]").textContent = time(value);
      progress.style.setProperty("--progress", (value / Number(progress.max) * 100) + "%");
      progress.setAttribute("aria-valuetext", time(value) + " / " + time(getDuration()));
    });
    progress.addEventListener("change", () => { if (!nativeDialogOpen) requestSeek(Number(progress.value)); });
    function endScrub() { dragging = false; }
    $("[data-volume]").addEventListener("input", event => {
      if (nativeDialogOpen) return;
      const value = Number(event.target.value);
      showVolume(value);
      action("setVolume", value);
    });
    viewport.addEventListener("wheel", manualScroll, { passive: true });
    viewport.addEventListener("touchmove", manualScroll, { passive: true });
    viewport.addEventListener("keydown", event => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) manualScroll(); });
    function onResize() {
      lyricInk = null;
      curveRows = null;
      cancelAnimationFrame(resizeId);
      resizeId = requestAnimationFrame(() => centerLine(false));
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("resize", onTitleMenuViewportChange);
    window.addEventListener("blur", onTitleMenuViewportChange);
    window.addEventListener("pointerdown", onTitleMenuOutside, true);
    window.addEventListener("pointerdown", onSettingsOutside, true);
    window.addEventListener("click", onTitleMenuOutside, true);
    window.addEventListener("keydown", onTitleMenuKeydown, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onTitleMenuViewportChange);
      window.visualViewport.addEventListener("scroll", onTitleMenuViewportChange);
    }
    window.addEventListener("pointerup", endScrub, true);
    window.addEventListener("pointercancel", endScrub, true);
    window.addEventListener("keydown", onKeydown, true);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", syncBackdrop);
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", onSystemMotionChange);
    else motionQuery.addListener(onSystemMotionChange);
    let unsubscribe = null;
    const controller = {
      host, shadowRoot: shadow, open, close, openSettings, setNativeDialogOpen,
      writeClipboardText,
      closeSettings: () => setSettings(false, false),
      applyAppearance: savePreferences,
      onBeforeEscape(handler) {
        beforeEscape = handler;
        return () => { if (beforeEscape === handler) beforeEscape = null; };
      },
      getState: () => ({ open: opened, settingsOnly, settingsOpen: !settingsPanel.hidden, nativeDialogOpen, trackId: view.dataset.trackId || "", lyricMode: view.dataset.lyricMode, activeLine, playing: view.dataset.playing === "true", positionMs: currentPosition(), seekPreviewMs: seekPreview ? seekPreview.targetMs : null, lyricCount: lines.length, preferences: Object.assign({}, preferences) }),
      destroy() {
        if (destroyed) return;
        if (settingsOnly) setSettings(false, false);
        close();
        destroyed = true;
        if (typeof unsubscribe === "function") unsubscribe();
        cancelAnimationFrame(frameId); cancelAnimationFrame(resizeId);
        clearTimeout(toastTimer); clearTimeout(resumeTimer);
        clearTimeout(coverRetireTimer);
        finishCoverTransition();
        releaseCover(pendingCover);
        pendingCover = null;
        window.removeEventListener("resize", onResize);
        window.removeEventListener("resize", onTitleMenuViewportChange);
        window.removeEventListener("blur", onTitleMenuViewportChange);
        window.removeEventListener("pointerdown", onTitleMenuOutside, true);
        window.removeEventListener("pointerdown", onSettingsOutside, true);
        window.removeEventListener("click", onTitleMenuOutside, true);
        window.removeEventListener("keydown", onTitleMenuKeydown, true);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener("resize", onTitleMenuViewportChange);
          window.visualViewport.removeEventListener("scroll", onTitleMenuViewportChange);
        }
        window.removeEventListener("pointerup", endScrub, true);
        window.removeEventListener("pointercancel", endScrub, true);
        window.removeEventListener("keydown", onKeydown, true);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        const cover = $("[data-cover]");
        cover.onload = cover.onerror = null;
        cover.removeAttribute("src");
        backdrop.setCover(null);
        document.removeEventListener("visibilitychange", syncBackdrop);
        if (motionQuery.removeEventListener) motionQuery.removeEventListener("change", onSystemMotionChange);
        else motionQuery.removeListener(onSystemMotionChange);
        host.remove();
        if (mounted === controller) mounted = null;
      }
    };
    mounted = controller;
    try {
      applyPreferences();
      unsubscribe = bridge.subscribe(receive);
      if (!snapshot && typeof bridge.getSnapshot === "function") receive(bridge.getSnapshot());
    } catch (error) {
      controller.destroy();
      throw error;
    }
    return controller;
  }
  window.NcmImmersiveView = { mount, version: VERSION };
})();
