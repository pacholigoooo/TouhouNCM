// Keep NetEase's DesktopLyrics window, native playback clock and window controls.
// The desktop renderer already accepts the same YRC timestamps as the player.
function watchDesktopLyrics(bridge, getPalette = () => null) {
  const channel = window.channel;
  const root = document.getElementById("root");
  const containerKey = root && Object.keys(root).find(key => key.indexOf("__reactContainer") === 0);
  const raw = root && (root._reactRootContainer?._internalRoot?.current || root[containerKey]);
  const fiber = raw && (raw.current || raw.stateNode?.current || raw);
  const store = [fiber?.child?.child?.memoizedProps, fiber?.child?.memoizedProps,
    fiber?.memoizedProps, fiber?.memoizedState?.element?.props]
    .map(props => props && props.store).find(value => typeof value?.getState === "function");
  if (!store || typeof channel?.call !== "function") throw new Error("桌面歌词需要网易云原生播放器接口。");

  const nativeCall = channel.call;
  const fonts = {
    system: "Microsoft YaHei UI", song: "宋体", kai: "楷体", xingkai: "华文行楷",
    youyuan: "幼圆", corsiva: "Monotype Corsiva", baskerville: "Baskerville Old Face", rockwell: "Rockwell"
  };
  const legacyFonts = { serif: "song", xinwei: "corsiva", lishu: "baskerville", zhongsong: "rockwell" };
  let disposed = false;
  let snapshot = bridge.getSnapshot();
  let originalLyrics = null;
  let originalTrackId = "";
  let primedTrackId = "";
  let effectiveYrc = "";
  let lyricSource = "none";
  let lastWord = null;
  let lastFont = "";
  let nativeFont = String(store.getState().setting?.lyricFont || "");
  let nativeFontEdited = false;
  let setting = store.getState().setting || {};
  let lastLines = null;
  let interceptedWrites = 0;
  let supplementalYrc = "";
  let captionSignature = "";
  let captionRevision = 0;
  // The launcher can retain its last caption across a renderer reinjection.
  // A new module instance must resend the full line even at the same revision.
  const captionInstance = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  let captionLineCache = null;
  let captionNativeClock = null;

  function preference(key, fallback) {
    try { return localStorage.getItem("ncm-immersive." + key) || fallback; }
    catch (_) { return fallback; }
  }
  function fontPreference() {
    const value = preference("fontFamily", "system");
    const key = legacyFonts[value] || value;
    return Object.prototype.hasOwnProperty.call(fonts, key) ? key : "system";
  }
  function numericPreference(key, fallback, min, max) {
    const value = Number(preference(key, String(fallback)));
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
  }
  function captionPreferences(native) {
    const fontSize = Math.round(Number(native.lyricFontSize) || 36);
    return {
      captionFontSize: numericPreference("captionFontSize", fontSize, 12, 72),
      captionTranslationSize: numericPreference("captionTranslationSize", Math.round(fontSize * 0.49), 10, 48),
      captionScale: numericPreference("captionScale", 1, 0.65, 1.6),
      captionBackground: preference("captionBackground", "on") !== "off"
    };
  }
  function call(name, args) {
    return nativeCall.call(channel, name, function () {}, args);
  }
  function currentLyricTrack() {
    return String(store.getState()["async:lyric"]?.resourceTrackId || "");
  }
  function toYrc(lines) {
    return lines.filter(line => Array.isArray(line.words) && line.words.length &&
      line.words.every(word => typeof word.text === "string" && Number.isFinite(word.startMs) && Number.isFinite(word.durationMs)))
      .map(line => {
        const words = line.words;
        const start = Number.isFinite(line.startMs) ? line.startMs : words[0].startMs;
        const end = Number.isFinite(line.endMs) ? line.endMs : Math.max(...words.map(word => word.startMs + word.durationMs));
        return "[" + Math.round(start) + "," + Math.max(0, Math.round(end - start)) + "]" + words.map(word =>
          "(" + Math.round(word.startMs) + "," + Math.max(0, Math.round(word.durationMs)) + ",0)" + word.text).join("");
      }).join("\n");
  }
  function lyricsForDesktop(payload) {
    const sameTrack = originalTrackId && originalTrackId === String(snapshot.track?.id || "");
    const yrc = payload.yrc || (sameTrack ? supplementalYrc : "") || "";
    effectiveYrc = lastWord ? yrc : "";
    lyricSource = effectiveYrc ? payload.yrc ? "native-yrc" : "official-yrc" : "native-lrc";
    return Object.assign({}, payload, { yrc: effectiveYrc });
  }
  function applyLyrics() {
    if (originalLyrics && originalTrackId === currentLyricTrack()) {
      call("player.setLyrics", [lyricsForDesktop(originalLyrics)]);
    }
  }
  function applyFont() {
    if (nativeFontEdited) return;
    call("player.setLRCFont", [String(setting.lyricFontSize), String(setting.lyricFontStyle), fonts[lastFont]]);
  }
  // Preserve the SDK callback, command arguments and return value. No event or
  // progress callback is registered or replaced; the native clock stays intact.
  function desktopCall(name, callback, args) {
    // Another plugin may wrap this function after installation. Keep that
    // chain working after unload, without applying any immersive overrides.
    if (disposed) return nativeCall.apply(this, arguments);
    if (name === "player.setLyrics" && args && args[0] && typeof args[0] === "object") {
      originalLyrics = Object.assign({}, args[0]);
      originalTrackId = currentLyricTrack();
      interceptedWrites++;
      args = [lyricsForDesktop(originalLyrics), ...args.slice(1)];
    } else if (name === "player.setLRCFont" && args && !nativeFontEdited) {
      // Native font-size controls send the stored family along with the size.
      // Retain the immersive family until the user explicitly picks a new one.
      const selected = String(args[2] || "");
      if (selected !== nativeFont) nativeFontEdited = true;
      else args = [args[0], args[1], fonts[lastFont]];
    }
    if (name === "player.setLyrics" || name === "player.setLRCFont") return nativeCall.call(this, name, callback, args);
    return nativeCall.apply(this, arguments);
  }
  function sync(next) {
    if (disposed) return;
    snapshot = next;
    setting = store.getState().setting || {};
    const selectedFont = String(setting.lyricFont || "");
    if (selectedFont !== nativeFont) {
      nativeFont = selectedFont;
      nativeFontEdited = true;
    }
    const word = preference("word", "on") === "on";
    const font = fontPreference();
    const wordChanged = word !== lastWord;
    const fontChanged = font !== lastFont;
    lastWord = word;
    if (fontChanged) {
      lastFont = font;
      nativeFontEdited = false;
      applyFont();
    }
    const lines = next.lyrics?.lines;
    const lyricsChanged = lines !== lastLines;
    if (lyricsChanged) {
      lastLines = lines;
      supplementalYrc = next.lyrics?.kind === "word" && Array.isArray(lines) ? toYrc(lines) : "";
    }
    const trackId = String(next.track?.id || "");
    const nativeLyric = store.getState()["async:lyric"];
    // Ask the existing model for its own exact lrc/tlrc/romalrc payload once for
    // the current track. Native lyrics arriving later pass through desktopCall.
    if (trackId && trackId === String(nativeLyric?.resourceTrackId || "") &&
        nativeLyric?.displayType === "default" && primedTrackId !== trackId) {
      primedTrackId = trackId;
      store.dispatch({ type: "async:lyric/setNativeLyric" });
    } else if (wordChanged || lyricsChanged) applyLyrics();
  }

  function captionTextKey(text) {
    return String(text || "").replace(/[\s\u200b-\u200d\ufeff]+/g, "");
  }
  function captionYrcLines(text) {
    return String(text || "").split(/\r?\n/).map(raw => {
      const head = raw.match(/^\s*\[(\d+),(\d+)\]/);
      if (!head) return null;
      const markers = Array.from(raw.matchAll(/\((\d+),(\d+),-?\d+\)/g));
      const words = markers.map((marker, index) => ({
        text: raw.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? raw.length),
        startMs: Number(marker[1]), durationMs: Number(marker[2])
      })).filter(value => value.text);
      return { startMs: Number(head[1]), endMs: Number(head[1]) + Number(head[2]),
        text: words.map(value => value.text).join(""), words };
    }).filter(Boolean).sort((a, b) => a.startMs - b.startMs);
  }
  function captionTranslationTimes(text) {
    const source = String(text || ""), byTime = new Map();
    const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0);
    function add(time, value) {
      const key = Math.round(time);
      byTime.set(key, byTime.has(key) && byTime.get(key) !== value ? null : value);
    }
    source.split(/\r?\n/).forEach(raw => {
      const millis = raw.match(/^\s*\[(\d+),(\d+)\](.*)$/);
      if (millis) { add(Number(millis[1]), millis[3].replace(/\(\d+,\d+,-?\d+\)/g, "")); return; }
      const value = raw.replace(/\[[^\]]*\]/g, "").trim();
      if (!captionTextKey(value)) return;
      for (const match of raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)) {
        add((Number(match[1]) * 60 + Number(match[2])) * 1000 + Number("0." + (match[3] || "0")) * 1000 + offset, value);
      }
    });
    return byTime;
  }
  function captionClock(next, nativePlaying) {
    const playback = next.playback, now = Date.now();
    if (!Number.isFinite(playback.positionMs)) return null;
    const identity = next.track.resourceType + ":" + next.track.id + ":" + (nativePlaying.playId || "");
    let observed = captionNativeClock;
    if (!observed || observed.identity !== identity) {
      observed = captionNativeClock = { identity, raw: playback.positionMs, changedAt: now,
        positionMs: playback.positionMs, sampledAt: now, rate: 1, forwardSamples: 0 };
    } else if (playback.positionMs !== observed.raw) {
      const interval = now - observed.changedAt, delta = playback.positionMs - observed.raw;
      const continuous = delta > 0 && delta <= 2250 && interval >= 100 && interval <= 2250 && Math.abs(delta - interval) <= 700;
      observed.forwardSamples = continuous ? observed.forwardSamples + 1 : 0;
      const previous = observed.positionMs + Math.min(Math.max(0, now - observed.sampledAt), observed.horizonMs || 1250) * observed.rate;
      observed.positionMs = continuous && observed.forwardSamples >= 2 ? previous : playback.positionMs;
      if (continuous) observed.cadenceMs = Math.max(1000, interval);
      observed.horizonMs = Math.min(2500, (observed.cadenceMs || 1000) + 250);
      observed.rate = Math.max(0, Math.min(1.5, 1 + (playback.positionMs - observed.positionMs) / (observed.cadenceMs || 1000)));
      observed.raw = playback.positionMs;
      observed.changedAt = observed.sampledAt = now;
    }
    const paused = nativePlaying.playingState === 1 && observed.hostState === 2 ||
      playback.state === "paused" && observed.playbackState === "playing" && next.diagnostics?.playbackStateSource !== "native-stationary";
    observed.hostState = nativePlaying.playingState;
    observed.playbackState = playback.state;
    const interacting = /^(dragging|seeking|seek-request|native-seek)$/.test(playback.clockReason || "");
    const buffering = nativePlaying.isLoadingFirst || next.diagnostics?.clockStatus === "buffering";
    if (paused || buffering || interacting) {
      observed.forwardSamples = 0;
      observed.motionPlaying = false;
      observed.positionMs = playback.positionMs;
      observed.sampledAt = now;
      observed.rate = 1;
    }
    const hidden = document.hidden === true;
    const staleAfter = Math.min(2650, (observed.cadenceMs || 1000) + 400);
    const freshMotion = observed.forwardSamples >= 2 && now - observed.changedAt <= staleAfter;
    // A renderer reload can leave both store/button paused while native audio
    // continues. Fresh motion proves playback; a real pause transition above
    // clears that evidence immediately.
    const playing = playback.state === "playing" || freshMotion;
    if (freshMotion) observed.motionPlaying = true;
    if (observed.motionPlaying && now - observed.changedAt > staleAfter) return null;
    let clock = playback.visualClock || playback;
    if (playing && (hidden || freshMotion && !(clock.maxInterpolationMs > 0))) {
      // The page bridge deliberately freezes animations when hidden. Desktop
      // lyrics can still animate if its native DOM progress keeps moving.
      // Require two real forward samples; never assume wall time is playback.
      if (buffering || !freshMotion) return null;
      clock = { positionMs: observed.positionMs, sampledAt: observed.sampledAt,
        maxInterpolationMs: observed.horizonMs || 1250, rate: observed.rate };
    } else if ((playing || next.diagnostics?.playbackStateSource === "native-stationary" && nativePlaying.playingState === 2) &&
        now - observed.changedAt > staleAfter) {
      // Freeze the last caption until native timing resumes. The host keeps
      // its surface mounted throughout the sample gap.
      return null;
    }
    if (!Number.isFinite(clock.positionMs)) return null;
    const rate = Number.isFinite(clock.rate) ? clock.rate : 1;
    const elapsed = Number.isFinite(clock.sampledAt) ? Math.max(0, now - clock.sampledAt) : 0;
    const limit = playing && Number.isFinite(clock.maxInterpolationMs) ? Math.max(0, clock.maxInterpolationMs) : 0;
    const position = clock.positionMs + Math.min(elapsed, limit) * rate;
    return { positionMs: Math.max(0, Number.isFinite(playback.durationMs) ? Math.min(playback.durationMs, position) : position),
      rate, interpolationMs: Math.max(0, limit - elapsed), playing };
  }
  function captionLines(next, nativeLyric, word) {
    const bridgeLines = Array.isArray(next.lyrics?.lines) ? next.lyrics.lines : [];
    const offset = Number.isFinite(nativeLyric.offset) ? nativeLyric.offset * 1000 : 0;
    // Native LRC times already include the user's offset; raw YRC and the
    // public lyric service do not. Never shift the native line clock twice.
    const shift = next.lyrics?.source?.startsWith("ncm-lyric-store:") && next.lyrics.kind !== "word" ? 0 : offset;
    const timed = bridgeLines.filter(line => Number.isFinite(line.startMs) && typeof line.text === "string");
    const nativeLines = Array.isArray(nativeLyric.lyricLines) ? nativeLyric.lyricLines : [];
    const nativeWords = word ? captionYrcLines(nativeLyric.yrcInfo?.yrc) : [];
    const useNativeWords = nativeWords.some(line => line.words.some(value => value.durationMs > 0));
    const wordLines = useNativeWords ? nativeWords : next.lyrics?.kind === "word" ? timed : [];
    if (word && wordLines.length) {
      const wordShift = useNativeWords ? offset : shift;
      const translations = useNativeWords ? captionTranslationTimes(nativeLyric.yrcInfo?.yrcTrans) : new Map();
      const romanizations = useNativeWords ? captionTranslationTimes(nativeLyric.yrcInfo?.yrcRoma) : new Map();
      const byText = new Map(), counts = new Map();
      timed.forEach(line => {
        const key = captionTextKey(line.text);
        if (!byText.has(key)) byText.set(key, []);
        byText.get(key).push(line);
      });
      wordLines.forEach(line => {
        const key = captionTextKey(line.text);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      const lines = wordLines.map(line => {
        const startMs = line.startMs - wordShift, key = captionTextKey(line.text);
        const matches = byText.get(key) || [];
        const enriched = matches.find(value => Math.abs(value.startMs - shift - startMs) < 1) ||
          (matches.length === 1 && counts.get(key) === 1 ? matches[0] : null);
        return {
          startMs,
          endMs: Number.isFinite(line.endMs) ? line.endMs - wordShift : null,
          text: line.text, translation: String(translations.get(Math.round(line.startMs)) || line.translation || enriched?.translation || ""),
          romanization: String(romanizations.get(Math.round(line.startMs)) || line.romanization || enriched?.romanization || ""),
          words: Array.isArray(line.words) && line.words.every(value => typeof value.text === "string" &&
            Number.isFinite(value.startMs) && Number.isFinite(value.durationMs) && value.durationMs >= 0) &&
            line.words.map(value => value.text).join("") === line.text ? line.words
            .map(value => ({ text: value.text, startMs: value.startMs - wordShift, durationMs: value.durationMs })) : []
        };
      });
      // Native LRC can carry an explicit silent line. The bridge omits empty
      // text for its scrolling view; retain that boundary on the desktop.
      nativeLines.forEach(line => {
        if (typeof line.time === "number" && Number.isFinite(line.time) && !captionTextKey(line.lyric)) {
          const time = line.time * 1000;
          if (!lines.some(value => Math.abs(value.startMs - time) < 1)) {
            lines.push({ startMs: time, endMs: null, text: "", translation: "", romanization: "", words: [] });
          }
        }
      });
      return lines.sort((a, b) => a.startMs - b.startMs);
    }
    if (nativeLines.length && (nativeLyric.scrollable === true || nativeLyric.currentUsedLyric === "yrc")) {
      const byText = new Map(), nativeCounts = new Map();
      timed.forEach(line => {
        const key = captionTextKey(line.text);
        if (!byText.has(key)) byText.set(key, []);
        byText.get(key).push(line);
      });
      nativeLines.forEach(line => {
        const key = captionTextKey(line.lyric);
        nativeCounts.set(key, (nativeCounts.get(key) || 0) + 1);
      });
      return nativeLines.map((line, index) => ({ line, index }))
        .filter(({ line }) => typeof line.time === "number" && Number.isFinite(line.time) && typeof line.lyric === "string")
        .map(({ line, index }) => {
          const startMs = line.time * 1000;
          const textKey = captionTextKey(line.lyric);
          const matching = byText.get(textKey) || [];
          const enriched = matching.find(value => Math.abs(value.startMs - shift - startMs) < 1) ||
            (matching.length === 1 && nativeCounts.get(textKey) === 1 ? matching[0] : null);
          const translated = nativeLyric.tlyricLines?.[index];
          const translation = translated && Number.isFinite(translated.time) && Math.abs(translated.time * 1000 - startMs - offset) < 1
            ? String(translated.lyric || "") : "";
          const romanized = nativeLyric.romaLyricLines?.[index];
          const romanization = romanized && Number.isFinite(romanized.time) && Math.abs(romanized.time * 1000 - startMs - offset) < 1
            ? String(romanized.lyric || "") : "";
          return { startMs, endMs: null, text: line.lyric, translation: translation || String(enriched?.translation || ""),
            romanization: romanization || String(enriched?.romanization || ""), words: [] };
        }).sort((a, b) => a.startMs - b.startMs);
    }
    return timed.map(line => ({
      startMs: line.startMs - shift,
      endMs: Number.isFinite(line.endMs) ? line.endMs - shift : null,
      text: line.text, translation: String(line.translation || ""), romanization: String(line.romanization || ""), words: []
    })).sort((a, b) => a.startMs - b.startMs);
  }
  function cachedCaptionLines(next, nativeLyric, word) {
    // Bridge lyric enrichment and the native offset reducer replace these
    // arrays. Settings/progress updates preserve them, so parsing is per song
    // revision rather than per desktop animation sample.
    const inputs = [next.track.resourceType, next.track.id, next.lyrics, next.lyrics?.lines, next.lyrics?.source, next.lyrics?.kind, nativeLyric.lyricLines,
      nativeLyric.tlyricLines, nativeLyric.romaLyricLines, nativeLyric.yrcInfo?.yrc, nativeLyric.yrcInfo?.yrcTrans, nativeLyric.yrcInfo?.yrcRoma,
      nativeLyric.offset, nativeLyric.currentUsedLyric, nativeLyric.scrollable, word];
    if (captionLineCache && inputs.every((value, index) => value === captionLineCache.inputs[index])) return captionLineCache.lines;
    const lines = captionLines(next, nativeLyric, word);
    let upcoming = -1;
    for (let index = lines.length - 1; index >= 0; index--) {
      lines[index].nextNonEmpty = upcoming;
      lines[index].nonEmpty = !!captionTextKey(lines[index].text);
      if (lines[index].nonEmpty) upcoming = index;
    }
    captionLineCache = { inputs, lines };
    return lines;
  }
  function caption(knownLineKey) {
    if (disposed) return "null";
    // Desktop polling remains active when Chromium throttles page timers.
    // Ask the existing bridge to refresh its native clock and state first.
    const next = typeof bridge.sample === "function" ? bridge.sample() : bridge.getSnapshot();
    const state = store.getState(), native = state.setting || {};
    const nativeLyric = state["async:lyric"] || {};
    const playback = next.playback;
    const trackId = String(next.track?.id || "");
    const identity = (next.track?.resourceType || "") + ":" + trackId + ":" + (state.playing?.playId || "");
    // Missing clock/lyric samples are distinct from a closed or unsupported
    // surface. The host holds this line, or clears it when the track changes.
    const transient = () => JSON.stringify({ status: "transient", identity });
    const lineMode = Number(native.lyricLineMode);
    const align = Number((lineMode ? native.lyricOneLineAlign : native.lyricDoubleLineAlign) || 0);
    const mode = native.lyricMode || "translate";
    const composition = native.lyricComposition || "horizontal";
    if (!native.showLyric || !["horizontal", "vertical"].includes(composition) || ![0, 1].includes(lineMode) ||
        ![0, 1, 2, 3].includes(align) || !["translate", "roman", "none"].includes(mode)) return "null";
    if (!trackId || String(nativeLyric.resourceTrackId || "") !== trackId || !playback) return transient();
    if (nativeLyric.displayType !== "default") return nativeLyric.displayType ? "null" : transient();
    const clock = captionClock(next, state.playing || {});
    if (!clock) return transient();
    const positionMs = clock.positionMs;
    const word = preference("word", "on") === "on";
    const lines = cachedCaptionLines(next, nativeLyric, word);
    if (!lines.length) return ["instrumental", "unavailable"].includes(next.lyrics?.status) || next.lyrics?.kind === "plain" ? "null" : transient();
    // Select from the clock on every poll, rather than counting elapsed polls.
    // Skipped samples, backward seeks and an intro therefore select the same line.
    let left = 0, right = lines.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (lines[middle].startMs <= positionMs) left = middle + 1;
      else right = middle;
    }
    const index = left - 1;
    const line = lines[index];
    const nextStart = lines[index + 1]?.startMs;
    const startMs = line ? line.startMs : 0;
    const endMs = Math.max(startMs, Math.min(
      Number.isFinite(line?.endMs) ? line.endMs : Infinity,
      Number.isFinite(nextStart) ? nextStart : Infinity,
      Number.isFinite(playback.durationMs) ? playback.durationMs : Infinity));
    if (!Number.isFinite(endMs)) return transient();
    const silent = !line || positionMs >= endMs || !line.nonEmpty;
    const text = silent ? "" : line.text;
    const translate = preference("translation", "on") === "on";
    let translation = "";
    if (!silent) {
      if (mode === "roman") translation = line.romanization;
      else if (mode === "translate" && translate) translation = line.translation;
    }
    let secondaryIsNext = false;
    if (!captionTextKey(translation)) translation = "";
    // Translation is independent of native original-line count. Keep the
    // caption surface across translated/untranslated lines in either mode.
    if (!silent && lineMode === 0 && !translation && line.nextNonEmpty >= 0) {
      const upcoming = lines[line.nextNonEmpty];
      const gap = upcoming.startMs - endMs;
      // Explicit YRC endings/empty LRC rows identify interludes. Plain LRC has
      // no sung ending, so a widely separated next timestamp is kept hidden.
      if (gap <= 2000 && (Number.isFinite(line.endMs) || upcoming.startMs - line.startMs <= 8000)) {
        translation = upcoming.text;
        secondaryIsNext = true;
      }
    }
    const font = fontPreference();
    const nativeFamily = String(native.lyricFont || "");
    const fontFamily = font === lastFont && (nativeFontEdited || nativeFamily !== nativeFont) ? nativeFamily : fonts[font];
    const silentStart = line && line.nonEmpty ? endMs : Math.max(0, startMs);
    const palette = preference("captionTheme", "on") === "on" ? getPalette() : null;
    const sizing = captionPreferences(native);
    const full = {
      text, translation, font: fontFamily, fontSize: sizing.captionFontSize,
      translationFontSize: sizing.captionTranslationSize, captionScale: sizing.captionScale,
      background: sizing.captionBackground, composition, lineMode, alignment: align, secondaryIsNext,
      color: palette ? [palette.muted, palette.muted, palette.accent, palette.accent] : native.lyricColor,
      outline: palette ? [palette.background, palette.background] : native.lyricOutLine,
      palette,
      outlineEnabled: native.lyricFontOutlineEnabled === true,
      word: !!(word && !silent && line.words.length),
      startMs: silent ? silentStart : startMs,
      endMs: silent && line ? Number.isFinite(nextStart) ? nextStart : playback.durationMs : endMs,
      locked: native.desktopLyricLockState === true,
      words: word && !silent ? line.words : []
    };
    if (!Number.isFinite(full.endMs)) return transient();
    const signature = JSON.stringify([identity, playback.clockEpoch, nativeLyric.offset,
      lineMode, mode, word, translate, native.lyricOneLineAlign, native.lyricDoubleLineAlign, native.lyricFontStyle, native.lyricTop, full]);
    if (signature !== captionSignature) {
      captionSignature = signature;
      captionRevision++;
    }
    const key = captionInstance + ":" + trackId + ":" + captionRevision;
    const progress = { key, identity, status: "ready", positionMs, playing: clock.playing,
      rate: clock.rate, interpolationMs: clock.interpolationMs };
    return JSON.stringify(key === knownLineKey ? progress : Object.assign(progress, full));
  }

  function desktopAction(type) {
    if (disposed || store.getState().setting?.showLyric !== true) return false;
    if (!["detail", "playprev", "play_pause", "playnext", "setting", "offset_back", "offset_forward", "lock", "unlock", "close"].includes(type)) return false;
    // This is the same effect used by NetEase's real desktop toolbar. It owns
    // the playback commands, popup menu, native lock flag and saved settings.
    return Promise.resolve(store.dispatch({ type: "setting/handleDesktopLyricAction", payload: { type } })).then(() => true);
  }

  let stopWatching = null;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    captionLineCache = null;
    captionNativeClock = null;
    if (channel.call === desktopCall) channel.call = nativeCall;
    if (stopWatching) stopWatching();
    const native = store.getState().setting || {};
    call("player.setLRCFont", [String(native.lyricFontSize), String(native.lyricFontStyle), native.lyricFont]);
    if (originalLyrics && originalTrackId === currentLyricTrack()) call("player.setLyrics", [originalLyrics]);
  };
  lastFont = fontPreference();
  lastWord = preference("word", "on") === "on";
  channel.call = desktopCall;
  // Native colors stay saved while theme colors are displayed. Turning off
  // theme following restores those values; alignment always follows NetEase.
  try {
    applyFont();
    stopWatching = bridge.subscribe(sync);
  } catch (error) {
    stop();
    throw error;
  }
  stop.getState = () => ({
    enabled: setting.showLyric === true, locked: setting.desktopLyricLockState === true,
    nativeWindowClass: "DesktopLyrics", word: lastWord, fontFamily: nativeFontEdited ? nativeFont : fonts[lastFont],
    fontSize: setting.lyricFontSize, lineMode: setting.lyricLineMode, composition: setting.lyricComposition,
    preferences: captionPreferences(setting),
    trackId: originalTrackId, wordDataSource: lyricSource, nativeYrcChars: originalLyrics?.yrc?.length || 0,
    effectiveYrcChars: effectiveYrc.length, interceptedWrites, disposed
  });
  stop.caption = caption;
  stop.action = desktopAction;
  return stop;
}
