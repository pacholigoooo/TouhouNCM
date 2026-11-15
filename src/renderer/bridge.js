/* Current-track bridge for NetEase Cloud Music 3.1.41.205529 / Orpheus (CEF 91).
 * All public time values are milliseconds; sampledAt uses Date.now().
 *
 * Verified against this machine's web.pack, pub/hybrid/app.chunk.83304b1.js:
 * playing.resourceDuration and async:lyric.lyricLines[].time are seconds;
 * Playing=2, Pause=1, Stop=0, End=-1. Native slider values are absolute seconds.
 * Actions below are the same actions used by the native mini player.
 * The bridge reads current playing/lyric state. Explicit song searches use the
 * client's own search/parser, and queue changes use its availability-check effect.
 * A character test reads recent listening records only after an explicit click.
 *
 * API/selector research:
 * https://github.com/Leafmy/BetterNCM-v3/blob/main/plugins/src/RefinedNowPlaying/main.js
 * https://github.com/Leafmy/BetterNCM-v3/blob/main/docs/03-native-bridge.md
 * https://github.com/Leafmy/BetterNCM-v3/blob/main/loader/selectors.json
 * This is an independent implementation; no upstream runtime is bundled.
 */
(function (host) {
  'use strict';

  function createBridge() {
    var doc = host.document;
    var listeners = new Set();
    var disposed = false;
    var store = null;
    var offStore = null;
    var trackKey = '';
    var previousCoverColor = null;
    var playing = null;
    var nativeLyricRef = null;
    var lyricRequest = null;
    var lyricRequestKey = '';
    var publicLyricPayload = null;
    var lyricRank = 0;
    var lastError = null;
    var clockIdentity = '';
    var nativePositionMs = null;
    var previousNativePositionMs = null;
    var nativeChangedAt = 0;
    var clockAdvancing = false;
    var clockAwaitingChange = false;
    var forwardSamples = 0;
    var forwardEvidenceUntil = 0;
    var observedNativeMotion = false;
    var lastHostPlaybackState = 'unknown';
    var lastButtonPlaybackState = 'unknown';
    var lastPlaybackState = 'unknown';
    var pendingSeek = null;
    var clockEpoch = 0;
    var clockReason = 'initial';
    var visualProgress = null;
    var visualContext = '';
    var nativeInteractionUntil = 0;
    var nativeProgressElement = null;
    var progressObserver = null;
    var observedProgressElements = [];
    var closeWhenOpened = false;
    var nativeSongSearch = null;
    var nativeHistory = null;
    var nativeListeningRank = null, nativeMusicTags = null, nativeSongLyrics = null;
    var musicTagCache = new Map();
    var songChoices = new Map();
    var searchWaiters = new Set();
    var enqueueTail = Promise.resolve();
    var progress = { positionMs: null, sampledAt: Date.now(), source: 'unavailable' };
    var snapshot = {
      track: null,
      detailState: 'closed',
      tools: { mode: null, volume: null, modeAvailable: false, volumeAvailable: false, collectionAvailable: false, queueAvailable: false },
      playback: {
        state: 'unknown', positionMs: null, durationMs: null, sampledAt: Date.now(), maxInterpolationMs: 0,
        clockEpoch: 0, clockReason: 'initial',
        visualClock: { positionMs: null, sampledAt: Date.now(), maxInterpolationMs: 0, rate: 1 }
      },
      lyrics: emptyLyrics('unavailable', '尚未读取到当前歌曲'),
      capabilities: { playPause: false, previous: false, next: false, seek: false },
      diagnostics: { host: 'Orpheus 3.1.41', metadataSource: 'unavailable', progressSource: 'unavailable', lastError: null }
    };

    function emptyLyrics(status, reason) {
      return { status: status, source: 'none', kind: 'none', lines: [], translationAvailable: false, reason: reason || '' };
    }

    function str(value) { return value === null || value === undefined ? '' : String(value).trim(); }
    function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
    function seconds(value) { return finite(value) && Number(value) >= 0 ? Number(value) * 1000 : null; }
    function first(values) { return values.map(str).find(Boolean) || ''; }

    function report(error) {
      lastError = str(error && error.message || error);
    }

    function emit() {
      if (disposed) return;
      snapshot.diagnostics.lastError = lastError;
      listeners.forEach(function (listener) {
        try { listener(snapshot); } catch (error) { host.console && host.console.error('[NCMImmersiveBridge subscriber]', error); }
      });
    }

    // These four store locations are used by the 3.x-compatible RNP plugin.
    // No walk through the state tree or webpack interception is necessary.
    function resolveStore() {
      var root = doc.getElementById('root');
      var fiber = root && root._reactRootContainer && root._reactRootContainer._internalRoot && root._reactRootContainer._internalRoot.current;
      if (!fiber && root) {
        var key = Object.keys(root).find(function (name) { return name.indexOf('__reactContainer') === 0; });
        var container = key && root[key];
        fiber = container && (container.current || container.stateNode && container.stateNode.current || container);
      }
      if (!fiber) return null;
      var candidates = [
        fiber.child && fiber.child.child && fiber.child.child.memoizedProps,
        fiber.child && fiber.child.memoizedProps,
        fiber.memoizedProps,
        fiber.memoizedState && fiber.memoizedState.element && fiber.memoizedState.element.props
      ];
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i] && candidates[i].store;
        if (candidate && typeof candidate.getState === 'function' && typeof candidate.subscribe === 'function') return candidate;
      }
      return null;
    }

    function readCurrent() {
      if (!store) return { playing: null, lyric: null, detail: null };
      var state = store.getState();
      return { playing: state.playing || null, lyric: state['async:lyric'] || null, detail: state['page:vinylPage'] || null, windowFullscreen: state.app && state.app.isFullScreen };
    }

    function normalizeTrack(value) {
      if (!value) return null;
      var track = value.curTrack || value.curPlaying && (value.curPlaying.track || value.curPlaying.localTrack) || {};
      var album = value.resourceAlbum || track.album || track.al || {};
      var id = first([value.resourceTrackId, track.id]);
      var title = first([value.resourceName, track.name]);
      if (!id && !title) return null;
      var artists = value.resourceArtists || track.artists || track.ar || [];
      return {
        id: id,
        title: title,
        artists: Array.isArray(artists) ? artists.map(function (artist) { return str(typeof artist === 'string' ? artist : artist.name); }).filter(Boolean) : [],
        album: first([value.resourceAlbumName, album.name]),
        coverUrl: first([value.resourceCoverUrl, album.picUrl, track.coverUrl]),
        durationMs: seconds(value.resourceDuration),
        source: 'ncm-store',
        resourceType: str(value.resourceType)
      };
    }

    function stateName(value) {
      if (!finite(value)) return 'unknown';
      var number = Number(value);
      if (number === 2) return 'playing';
      if (number === 1 || number === 0 || number === -1) return 'paused';
      return 'unknown';
    }

    function isEnabled(element) {
      return !!(element && !element.disabled && element.getAttribute('aria-disabled') !== 'true');
    }

    function playerButton(kind) {
      var ids = { play: 'btn_pc_minibar_play', previous: 'btn_pc_previous', next: 'btn_pc_next' };
      var exact = doc.getElementById(ids[kind]);
      if (exact && !exact.closest('[data-ncm-immersive]')) return exact;
      var patterns = { play: /播放|暂停|\bplay\b|\bpause\b/i, previous: /上一首|上一曲|\bprev(?:ious)?\b/i, next: /下一首|下一曲|\bnext\b/i };
      return Array.from(doc.querySelectorAll('footer button, #main-player button')).find(function (button) {
        if (button.closest('[data-ncm-immersive]')) return false;
        var label = [button.getAttribute('title'), button.getAttribute('aria-label')].join(' ');
        return patterns[kind].test(label);
      }) || null;
    }

    function nativeButtonState() {
      var button = playerButton('play');
      if (!button) return 'unknown';
      // Native module83/396 records the action the button would perform.
      var raw = button.getAttribute('data-log');
      if (raw) {
        try {
          var log = JSON.parse(raw);
          if (log.params && log.params.type === 'pause') return 'playing';
          if (log.params && log.params.type === 'play') return 'paused';
        } catch (error) { /* An unrelated native log format supplies no state. */ }
      }
      var label = [button.getAttribute('title'), button.getAttribute('aria-label')].join(' ');
      if (/暂停|\bpause\b/i.test(label) || button.classList && button.classList.contains('play-pause-btn')) return 'playing';
      if (/播放|\bplay\b/i.test(label)) return 'paused';
      return 'unknown';
    }

    function sliderTrackId(element) {
      // The native connected progress component owns these two public playback props.
      // Check only that ancestor; do not enumerate Redux state or component hook data.
      var key = Object.keys(element).find(function (name) { return name.indexOf('__reactFiber') === 0; });
      var fiber = key && element[key];
      for (var depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
        var props = fiber.memoizedProps;
        if (props && props.resourceTrackId !== undefined && props.resourceDuration !== undefined) return str(props.resourceTrackId);
      }
      return '';
    }

    function observeProgressElements(elements) {
      if (typeof host.MutationObserver !== 'function') return;
      if (elements.length === observedProgressElements.length && elements.every(function (element, index) { return element === observedProgressElements[index]; })) return;
      if (!progressObserver) progressObserver = new host.MutationObserver(function () {
        if (!disposed) sample();
      });
      progressObserver.disconnect();
      observedProgressElements = elements;
      // Verified live: native React updates the range's value attribute alongside
      // its fractional value. Observe only those inputs, never native RPC slots.
      elements.forEach(function (element) { progressObserver.observe(element, { attributes: true, attributeFilter: ['value', 'max'] }); });
    }

    function resetVisualClock(reason) {
      clockEpoch++;
      clockReason = reason;
      visualProgress = null;
      snapshot.playback.clockEpoch = clockEpoch;
      snapshot.playback.clockReason = reason;
    }

    function visualPositionAt(now) {
      if (!visualProgress) return null;
      return visualProgress.positionMs + Math.min(Math.max(0, now - visualProgress.sampledAt), visualProgress.maxInterpolationMs) * visualProgress.rate;
    }

    function updateVisualClock(clock, context, advancing, now, duration) {
      if (visualContext && context !== visualContext) resetVisualClock(context === 'playing' ? 'resume' : context);
      visualContext = context;
      if (context === 'unavailable') return { positionMs: null, sampledAt: now, maxInterpolationMs: 0, rate: 1 };
      if (!visualProgress || clock.changed) {
        var position = progress.positionMs;
        var rate = 1;
        if (visualProgress && advancing && clock.continuous && (visualProgress.maxInterpolationMs > 0 || visualProgress.rate === 0)) {
          // Native samples can advance by e.g. 682ms after 1000ms of wall time.
          // Keep the visual position continuous and repay that small timing error
          // through the following interval, rather than repainting earlier words.
          position = visualPositionAt(now);
          rate = Math.max(0, Math.min(1.5, 1 + (progress.positionMs - position) / 1000));
        }
        position = Math.max(0, duration === null ? position : Math.min(duration, position));
        visualProgress = {
          positionMs: position, sampledAt: now, rate: rate,
          maxInterpolationMs: advancing && rate > 0 ? Math.min(1250, duration === null ? 1250 : Math.max(0, duration - position) / rate) : 0
        };
      }
      // Do not turn an expired extrapolation into an earlier raw anchor. Its
      // original 1250ms horizon freezes it until native motion or a real reset.
      return Object.assign({}, visualProgress);
    }

    function sampleDomProgress() {
      var track = snapshot.track;
      if (!track || !playing) {
        observeProgressElements([]);
        return { available: false, loading: false };
      }
      // web.pack module109: minValue=0, maxValue=resourceDuration, value=je.
      // Its input has no aria-valuenow; the accessible name is on the track DIV.
      // value is ALREADY absolute seconds including freeTrialInfo.start. Ordinary
      // mode floors native.current; the native chorus mode preserves fractional seconds.
      var inputs = Array.from(doc.querySelectorAll('[aria-label="播放进度调节"] input[type="range"]')).filter(function (element) { return !element.closest('[data-ncm-immersive]'); });
      observeProgressElements(inputs);
      var candidates = inputs.map(function (element) {
        var container = element.closest('[aria-label="播放进度调节"]');
        if (!container || element.closest('[data-ncm-immersive]')) return null;
        var value = Number(element.value);
        var maximum = Number(element.max);
        var minimum = Number(element.min);
        if (!finite(element.value) || !finite(element.max) || maximum <= 0 || value < minimum || value > maximum) return null;
        if (track.durationMs !== null && Math.abs(maximum * 1000 - track.durationMs) > 1000) return null;
        var ownerId = sliderTrackId(element);
        if (ownerId && ownerId !== track.id) return null;
        var inDetail = container.classList.contains('slider-vinyl');
        var detailOpen = snapshot.detailState === 'opening' || snapshot.detailState === 'opened';
        return { element: element, valueMs: value * 1000, loading: !!container.querySelector('.thumb.loading'), dragging: container.classList.contains('dragging'), preferred: inDetail === detailOpen };
      }).filter(Boolean).sort(function (a, b) { return Number(b.preferred) - Number(a.preferred); });
      if (!candidates.length) return { available: false, loading: false };
      // Keep one native input while it exists. Opening the detail page must not
      // alternate between two React inputs whose progress renders can differ.
      var candidate = candidates.find(function (item) { return item.element === nativeProgressElement; }) || candidates[0];
      nativeProgressElement = candidate.element;
      var dragging = candidates.some(function (item) { return item.dragging; });
      var now = Date.now();
      var interacting = now < nativeInteractionUntil;
      if (dragging || candidate.loading || doc.hidden === true || pendingSeek || interacting || playing.isLoadingFirst) {
        forwardSamples = 0;
        forwardEvidenceUntil = 0;
        clockAdvancing = false;
      }
      // React may render a new track's props before its previous input value is reset.
      // Wait for the native value to change instead of borrowing the previous song's clock.
      if (clockAwaitingChange && candidate.valueMs > 0 && candidate.valueMs === previousNativePositionMs) return { available: false, loading: candidate.loading };
      clockAwaitingChange = false;
      var changed = candidate.valueMs !== nativePositionMs;
      var continuous = false;
      if (changed) {
        var delta = nativePositionMs === null ? null : candidate.valueMs - nativePositionMs;
        var interval = nativeChangedAt ? now - nativeChangedAt : 0;
        var reasonable = delta !== null && delta > 0 && delta <= 2250 && interval >= 100 && interval <= 2250 && Math.abs(delta - interval) <= 600;
        continuous = reasonable && !dragging && !candidate.loading && doc.hidden !== true && !pendingSeek && !interacting && !playing.isLoadingFirst;
        if (delta !== null && !continuous) resetVisualClock(delta < 0 ? 'native-seek-backward' : pendingSeek || interacting || dragging ? 'native-seek' : 'native-discontinuity');
        clockAdvancing = continuous;
        forwardSamples = clockAdvancing ? forwardSamples + 1 : 0;
        forwardEvidenceUntil = forwardSamples >= 2 ? now + 1400 : 0;
        if (forwardSamples >= 2) observedNativeMotion = true;
        nativePositionMs = candidate.valueMs;
        nativeChangedAt = now;
        progress = { positionMs: candidate.valueMs, sampledAt: now, source: 'native-minibar' };
        nativeInteractionUntil = 0;
        interacting = false;
      }
      if (pendingSeek && (changed && Math.abs(candidate.valueMs - pendingSeek.positionMs) <= 1100 || now - pendingSeek.requestedAt >= 2000)) pendingSeek = null;
      return { available: true, loading: candidate.loading, dragging: dragging, interacting: interacting, changed: changed, continuous: continuous };
    }

    function updatePlayback(clock) {
      var current = snapshot.track;
      var hostState = playing ? stateName(playing.playingState) : 'unknown';
      var buttonState = nativeButtonState();
      var name = hostState === 'unknown' ? buttonState : hostState;
      var stateSource = hostState === 'unknown' ? 'native-player-button' : 'ncm-store';
      var now = Date.now();
      var background = doc.hidden === true;
      var buffering = !!(playing && playing.isLoadingFirst || clock && clock.loading);
      var available = !!(clock && clock.available && progress.positionMs !== null);
      var dragging = !!(clock && clock.dragging);
      var interacting = !!(clock && clock.interacting);
      // A real pause transition beats older motion evidence immediately. On reload
      // both store and button may stay paused while the native audio keeps running.
      if (hostState === 'paused' && lastHostPlaybackState === 'playing' || buttonState === 'paused' && lastButtonPlaybackState === 'playing') {
        forwardSamples = 0;
        forwardEvidenceUntil = 0;
        clockAdvancing = false;
      }
      lastHostPlaybackState = hostState;
      lastButtonPlaybackState = buttonState;
      if (available && !background && !buffering && !dragging && !interacting && !pendingSeek) {
        if (forwardSamples >= 2 && now <= forwardEvidenceUntil) {
          name = 'playing';
          stateSource = 'native-progress-evidence';
        } else if (observedNativeMotion && now - nativeChangedAt > 1500) {
          name = 'paused';
          stateSource = 'native-stationary';
        }
      }
      if (name !== lastPlaybackState || background || buffering) {
        clockAdvancing = false;
        // Resume/background changes start from the current native value, never elapsed wall time.
        if (progress.positionMs !== null) progress.sampledAt = now;
      }
      lastPlaybackState = name;
      var advancing = available && name === 'playing' && clockAdvancing && !background && !buffering && !dragging && !interacting && !pendingSeek && now - nativeChangedAt <= 1400;
      // Preserve fractional source samples too: never display the following second
      // before the native slider itself has reached it.
      var untilNextSecond = available ? Math.max(0, Math.floor(999 - progress.positionMs % 1000)) : 0;
      var context = !available ? 'unavailable' : background ? 'background' : buffering ? 'buffering' : dragging ? 'dragging' : pendingSeek || interacting ? 'seeking' : name;
      var visualClock = updateVisualClock(clock, context, advancing, now, current && current.durationMs);
      snapshot.playback = {
        state: name, positionMs: available ? progress.positionMs : null,
        durationMs: current && current.durationMs, sampledAt: progress.sampledAt,
        maxInterpolationMs: advancing ? untilNextSecond : 0,
        clockEpoch: clockEpoch, clockReason: clockReason,
        // Lyrics/animated progress may cross seconds smoothly. The visible time
        // above keeps its native second boundary; both clocks share the same real
        // fractional source and freeze/reset on pause, seek, background and tracks.
        // Consumers use positionMs + min(elapsed, maxInterpolationMs) * rate.
        visualClock: visualClock
      };
      snapshot.diagnostics.progressSource = progress.source;
      snapshot.diagnostics.playbackStateSource = stateSource;
      snapshot.diagnostics.progressSampling = progressObserver ? 'native-value-observer' : 'poll';
      snapshot.diagnostics.clockStatus = !available ? 'unavailable' : background ? 'background' : buffering ? 'buffering' : name !== 'playing' ? 'paused' : advancing ? 'advancing' : 'waiting';
      var canDispatch = !!(current && store && typeof store.dispatch === 'function');
      var previous = playerButton('previous');
      var next = playerButton('next');
      snapshot.capabilities = {
        playPause: canDispatch || isEnabled(playerButton('play')),
        previous: previous ? isEnabled(previous) : canDispatch,
        next: next ? isEnabled(next) : canDispatch,
        seek: !!(canDispatch && finite(current.durationMs) && current.durationMs > 0 && playing.resourceTrackId)
      };
    }

    var playModes = { playCycle: 'loop', playOneCycle: 'single', playRandom: 'shuffle', playOrder: 'order', playAi: 'heart', playFm: 'fm' };

    function playbackModeButton() {
      return doc.querySelector('[data-testid="tid_playmode_btn"] button');
    }

    function collectionButton() {
      var inDetail = snapshot.detailState === 'opening' || snapshot.detailState === 'opened';
      return Array.from(doc.querySelectorAll('[data-testid="tid_playbar_collect_btn"]')).filter(function (button) {
        return isEnabled(button) && !button.closest('[data-ncm-immersive]') && button.getAttribute('title') === '收藏到歌单';
      }).sort(function (a, b) {
        var aDetail = !!a.closest('[class^="VinylPageContainer_"]');
        var bDetail = !!b.closest('[class^="VinylPageContainer_"]');
        return Number(bDetail === inDetail) - Number(aDetail === inDetail);
      })[0] || null;
    }

    function openCollection() {
      if (disposed) return Promise.resolve({ ok: false, source: 'none', error: '桥接已关闭' });
      sample();
      var button = collectionButton();
      if (!button) return Promise.resolve({ ok: false, source: 'none', error: '当前曲目没有原生收藏到歌单入口' });
      // Verified native module321 button: opens FavouriteModal, preserving native
      // login, availability checks and playlist choice. Never select a playlist here.
      try {
        button.click();
        return Promise.resolve({ ok: true, source: 'native-collection-button' });
      } catch (error) {
        return Promise.resolve({ ok: false, source: 'native-collection-button', error: str(error.message) });
      }
    }

    function queueButton() {
      var inDetail = snapshot.detailState === 'opening' || snapshot.detailState === 'opened';
      return Array.from(doc.querySelectorAll('[data-testid="tid_playbar_playlist_btn"]')).filter(function (button) {
        return isEnabled(button) && !button.closest('[data-ncm-immersive]');
      }).sort(function (a, b) {
        var aDetail = !!a.closest('[class^="VinylPageContainer_"]');
        var bDetail = !!b.closest('[class^="VinylPageContainer_"]');
        return Number(bDetail === inDetail) - Number(aDetail === inDetail);
      })[0] || null;
    }

    function openQueue() {
      if (disposed) return Promise.resolve({ ok: false, source: 'none', error: '桥接已关闭' });
      var button = queueButton();
      if (!button) return Promise.resolve({ ok: false, source: 'none', error: '当前播放模式没有原生播放队列入口' });
      // This machine's app.chunk.286eda4 binds this button to
      // openPlaylist -> PlayBarPlaylist (chunk71/module3116). Its own live list,
      // play/remove handlers and clear confirmation stay entirely native.
      try {
        button.click();
        return Promise.resolve({ ok: true, source: 'native-queue-button', confirmed: false });
      } catch (error) {
        return Promise.resolve({ ok: false, source: 'native-queue-button', error: str(error.message) });
      }
    }

    function searchQuery(value) {
      var query = str(value);
      if (query.length > 160) throw new Error('搜索词请控制在 160 个字符以内');
      return query;
    }

    function nativeMethod(marker, label) {
      return host.NcmClientApi.method(marker, label);
    }

    function nativeSearch() {
      if (!nativeSongSearch) nativeSongSearch = nativeMethod('/api/search/song/list/page', '原生歌曲搜索');
      return nativeSongSearch;
    }

    function recentHistory(options) {
      return new Promise(function (resolve, reject) {
        var signal = options && options.signal, settled = false;
        function finish(error, value) {
          if (settled) return;
          settled = true;
          searchWaiters.delete(cancel);
          if (signal) signal.removeEventListener('abort', cancel);
          if (error) reject(error instanceof Error ? error : new Error(str(error && (error.message || error.msg) || error) || '最近播放记录读取失败'));
          else resolve(value);
        }
        function cancel() { var error = new Error('角色测试已取消'); error.name = 'AbortError'; finish(error); }
        try {
          if (disposed) throw new Error('桥接已关闭');
          if (signal && signal.aborted) return cancel();
          if (!store) throw new Error('尚未连接到网易云音乐');
          if (!nativeHistory) nativeHistory = nativeMethod('/api/play-record/song/list', '最近播放记录');
          searchWaiters.add(cancel);
          if (signal) signal.addEventListener('abort', cancel, { once: true });
          // module15.Ke is the read-only endpoint/parser used by the native
          // recent-play page (chunk157). The UID stays inside that parser.
          Promise.resolve(nativeHistory({ limit: 50, offset: 0 }, (store.getState().host || {}).uid)).then(function (rows) {
            if (settled || disposed) return;
            if (!Array.isArray(rows)) throw new Error('最近播放记录格式已变化，请更新客户端后重试');
            var seen = new Set();
            var tracks = rows.slice().sort(function (a, b) { return (Number(b.playtime) || 0) - (Number(a.playtime) || 0); }).filter(function (track) {
              var id = str(track && track.id);
              if (!/^\d+$/.test(id) || !str(track.name) || seen.has(id)) return false;
              seen.add(id); return true;
            }).slice(0, 50).map(function (track) {
              return { id: str(track.id), title: str(track.name), album: str(track.album && track.album.name),
                artists: (Array.isArray(track.artists) ? track.artists : []).map(function (artist) { return str(typeof artist === 'string' ? artist : artist.name); }).filter(Boolean),
                aliases: (Array.isArray(track.alias) ? track.alias : []).concat(Array.isArray(track.transNames) ? track.transNames : []).map(str).filter(Boolean) };
            });
            finish(null, tracks);
          }).catch(function (error) { finish(error); });
        } catch (error) { finish(error); }
      });
    }

    function quizRead(options, operation) {
      return new Promise(function (resolve, reject) {
        var signal = options && options.signal, settled = false, timeout = null;
        function finish(error, value) {
          if (settled) return;
          settled = true;
          if (timeout !== null) host.clearTimeout(timeout);
          searchWaiters.delete(cancel);
          if (signal) signal.removeEventListener('abort', cancel);
          if (error) reject(error instanceof Error ? error : new Error(str(error && (error.message || error.msg) || error)));
          else resolve(value);
        }
        function cancel() { var error = new Error('角色测试已取消'); error.name = 'AbortError'; finish(error); }
        if (disposed) return finish(new Error('桥接已关闭'));
        if (signal && signal.aborted) return cancel();
        searchWaiters.add(cancel);
        if (signal) signal.addEventListener('abort', cancel, { once: true });
        timeout = host.setTimeout(function () { finish(new Error('网易云音乐资料读取超时，请重试')); }, 20000);
        Promise.resolve().then(function () {
          if (!settled) return operation();
        }).then(function (value) { finish(null, value); }, function (error) { finish(error); });
      });
    }

    function quizTrack(track) {
      if (!track || !/^\d+$/.test(str(track.id)) || !str(track.name)) return null;
      var row = { id: str(track.id), title: str(track.name), album: str(track.album && track.album.name),
        artists: (Array.isArray(track.artists) ? track.artists : []).map(function (artist) { return str(typeof artist === 'string' ? artist : artist.name); }).filter(Boolean),
        aliases: (Array.isArray(track.alias) ? track.alias : []).concat(Array.isArray(track.transNames) ? track.transNames : []).map(str).filter(Boolean) };
      if (finite(track.duration) && track.duration > 0) row.durationMs = Number(track.duration);
      if (finite(track.playCount) && track.playCount >= 0) row.playCount = Number(track.playCount);
      if (row.durationMs !== undefined && row.playCount !== undefined) row.estimatedListeningMs = row.durationMs * row.playCount;
      if (finite(track.playtime) && track.playtime > 0) row.recentAt = Number(track.playtime);
      return row;
    }

    function characterHistory(options) {
      return quizRead(options, async function () {
        if (!store) throw new Error('尚未连接到网易云音乐');
        var uid = (store.getState().host || {}).uid;
        var results = await Promise.allSettled([
          Promise.resolve().then(function () {
            if (!nativeListeningRank) nativeListeningRank = nativeMethod('/api/v1/play/record', '累计听歌排行');
            return nativeListeningRank({ hostId: uid, userId: uid, type: 'all' });
          }),
          Promise.resolve().then(function () {
            if (!nativeHistory) nativeHistory = nativeMethod('/api/play-record/song/list', '最近播放记录');
            return nativeHistory({ limit: 30, offset: 0 }, uid);
          })
        ]);
        var warnings = [], groups = results.map(function (result, index) {
          if (result.status === 'fulfilled' && Array.isArray(result.value)) return result.value.map(quizTrack).filter(Boolean);
          warnings.push((index ? '最近播放记录' : '累计听歌排行') + '读取失败');
          return null;
        });
        if (!groups[0] && !groups[1]) throw new Error(warnings.join('，') + '，请重试');
        function unique(rows) {
          var seen = new Set();
          return rows.filter(function (track) { if (seen.has(track.id)) return false; seen.add(track.id); return true; });
        }
        var top = (groups[0] || []).filter(function (track) { return finite(track.estimatedListeningMs) && track.estimatedListeningMs > 0; });
        var recent = (groups[1] || []).filter(function (track) { return track.recentAt !== undefined; });
        if (groups[0] && top.length < groups[0].length) warnings.push('部分排行缺少播放次数或曲长，未参与时长估算');
        if (groups[1] && recent.length < groups[1].length) warnings.push('部分最近记录缺少播放时间，已跳过');
        top = unique(top.sort(function (a, b) { return b.estimatedListeningMs - a.estimatedListeningMs; }));
        recent = unique(recent.sort(function (a, b) { return b.recentAt - a.recentAt; }));
        return { topTracks: top.slice(0, 30), recentTracks: recent.slice(0, 30), timeBasis: 'estimated',
          topAvailable: groups[0] !== null, recentAvailable: groups[1] !== null, topTotal: top.length, recentTotal: recent.length, warnings: warnings };
      });
    }

    function cachedMusicTags(id) {
      var hit = musicTagCache.get(id);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.tags.slice();
      if (hit) musicTagCache.delete(id);
      return null;
    }

    function musicTags(tracks, options) {
      return quizRead(options, async function () {
        var ids = Array.from(new Set((Array.isArray(tracks) ? tracks : []).map(function (track) { return str(track && track.id); }).filter(function (id) { return /^\d+$/.test(id); }))).slice(0, 60);
        var tagsById = {}, warnings = [];
        ids.forEach(function (id) { tagsById[id] = cachedMusicTags(id) || []; });
        if (!ids.length) return { tagsById: tagsById, warnings: warnings };
        try {
          if (!nativeMusicTags) nativeMusicTags = nativeMethod('/api/star/song/filter/tag/list', '歌曲标签');
          var result = await nativeMusicTags({ trackIds: JSON.stringify(ids.map(function (id) { return { id: Number(id), at: 0 }; })) }, { timeout: 15000 });
          var mapping = result && result.data && result.data.tagTrackMapping;
          if (result.code !== 200 || !mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(function (tag) { return !Array.isArray(mapping[tag]); })) throw new Error('歌曲标签格式已变化');
          var selected = new Set(ids);
          ids.forEach(function (id) { tagsById[id] = []; });
          // tagCategory lists available filters, not the tags of every song.
          Object.keys(mapping).forEach(function (tag) { mapping[tag].forEach(function (value) {
            var id = str(value);
            if (selected.has(id) && str(tag)) tagsById[id].push(str(tag));
          }); });
          if (!disposed && !(options && options.signal && options.signal.aborted)) ids.forEach(function (id) {
            musicTagCache.delete(id); musicTagCache.set(id, { at: Date.now(), tags: tagsById[id].slice() });
          });
          while (musicTagCache.size > 120) musicTagCache.delete(musicTagCache.keys().next().value);
        } catch (error) { warnings.push('歌曲标签读取失败'); }
        return { tagsById: tagsById, warnings: warnings };
      });
    }

    function songMusicInfo(track, options) {
      return quizRead(options, async function () {
        var id = str(track && track.id);
        if (!/^\d+$/.test(id)) throw new Error('歌曲编号无效');
        var cached = options && Array.isArray(options.tags) ? options.tags.slice() : cachedMusicTags(id);
        var reads = await Promise.allSettled([
          cached ? Promise.resolve({ tagsById: { [id]: cached }, warnings: [] }) : musicTags([track], options),
          Promise.resolve().then(function () {
            if (!nativeSongLyrics) nativeSongLyrics = nativeMethod('/api/song/lyric/v1', '歌曲歌词');
            return nativeSongLyrics({ os: 'pc', id: id, lv: -1, kv: -1, tv: -1 }, { timeout: 15000 });
          })
        ]);
        var tags = [], lyrics = '', warnings = [];
        if (reads[0].status === 'fulfilled') {
          tags = reads[0].value.tagsById[id] || [];
          warnings.push.apply(warnings, reads[0].value.warnings);
        } else warnings.push('歌曲标签读取失败');
        var value = reads[1].status === 'fulfilled' && reads[1].value;
        if (value && value.code === 200) {
          lyrics = Array.from(new Set([value.lrc && value.lrc.lyric, value.tlyric && value.tlyric.lyric].filter(function (text) { return typeof text === 'string' && text.trim(); }))).join('\n');
        } else warnings.push('歌词读取失败');
        // Lyrics belong to this explicit test only; never persist the full text.
        return { tags: tags, lyrics: lyrics, warnings: warnings };
      });
    }

    function searchSongs(value, options) {
      return new Promise(function (resolve, reject) {
        var signal = options && options.signal;
        var settled = false;
        function finish(error, result) {
          if (settled) return;
          settled = true;
          searchWaiters.delete(cancel);
          if (signal) signal.removeEventListener('abort', cancel);
          if (error) reject(error instanceof Error ? error : new Error(str(error && (error.message || error.msg) || error) || '原生歌曲搜索失败'));
          else resolve(result);
        }
        function cancel() {
          var error = new Error('歌曲搜索已取消');
          error.name = 'AbortError';
          finish(error);
        }
        try {
          if (disposed) throw new Error('桥接已关闭');
          if (signal && signal.aborted) return cancel();
          var query = searchQuery(value);
          if (!query) return finish(null, []);
          var search = nativeSearch();
          searchWaiters.add(cancel);
          if (signal) signal.addEventListener('abort', cancel, { once: true });
          // The native transport owns the request. Abort cancels this consumer
          // and discards its late result without touching native network handlers.
          Promise.resolve(search({ keyword: query, scene: 'normal', limit: 20, offset: 0, needCorrect: false, channel: 'suggest' }, { timeout: 15000 })).then(function (result) {
            if (settled || disposed) return;
            if (!result || !Array.isArray(result.list)) throw new Error('原生搜索未返回歌曲列表');
            var seen = new Set();
            var songs = result.list.map(function (track) {
              var id = str(track && track.id);
              if (!/^\d+$/.test(id) || seen.has(id)) return null;
              seen.add(id);
              var album = track.album || {};
              var artists = track.artists || [];
              // Native aliases include the credited Touhou original. Keep that
              // evidence so same-title songs can be checked against the source.
              var aliases = (Array.isArray(track.alias) ? track.alias : []).concat(Array.isArray(track.transNames) ? track.transNames : []);
              songChoices.delete(id);
              songChoices.set(id, track);
              if (songChoices.size > 200) songChoices.delete(songChoices.keys().next().value);
              return { id: id, title: str(track.name), aliases: Array.from(new Set(aliases.map(str).filter(Boolean))), artists: Array.isArray(artists) ? artists.map(function (artist) { return str(typeof artist === 'string' ? artist : artist.name); }).filter(Boolean) : [],
                album: str(album.name), durationMs: finite(track.duration) ? Number(track.duration) : null, coverUrl: first([album.picUrl, album.cover]) };
            }).filter(Boolean);
            finish(null, songs);
          }).catch(function (error) { finish(error); });
        } catch (error) { finish(error); }
      });
    }

    function songInQueue(id) {
      var list = store && store.getState().playingList;
      return !!(list && Array.isArray(list.curPlayingList) && list.curPlayingList.some(function (item) {
        return str(item.track && item.track.id || item.trackId || item.resourceId) === id;
      }));
    }

    function enqueueSong(value) {
      var id = str(value);
      var task = enqueueTail.then(async function () {
        if (disposed) return { ok: false, error: '桥接已关闭' };
        sample();
        var track = songChoices.get(id);
        if (!track) return { ok: false, error: '请先搜索并选择要加入的网易云版本' };
        var state = store && store.getState();
        if (!store || typeof store.dispatch !== 'function' || !state.playingList || !Array.isArray(state.playingList.curPlayingList)) return { ok: false, error: '当前客户端没有可确认的原生播放队列' };
        var alreadyQueued = songInQueue(id);
        // Native module310 checks privileges; modules1386/176 deduplicate and
        // reinsert resourceId, so explicit repeats must still run this effect.
        // Leave playback unchanged and forbid copyright fallback to another ID.
        await store.dispatch({ type: 'playing/play', payload: {
          tracks: [Object.assign({}, track, { noCopyrightRcmd: null })],
          from: { resourceType: 'track', scene: 'search', text: '搜索', fromInfo: { originalResourceType: 'track', computeSourceResourceType: 'track', originalScene: 'search' } },
          options: { play: false, clear: false, playId: id }, triggerScene: 'search', triggerAction: 'addToPlayList'
        } });
        if (!songInQueue(id)) return { ok: false, error: '此版本未加入队列，请在网易云搜索页查看版权、会员或网络提示' };
        return { ok: true, alreadyQueued: alreadyQueued, confirmed: true, source: 'ncm-store' };
      }).catch(function (error) { return { ok: false, error: str(error && (error.message || error.msg) || error) || '加入播放队列失败' }; });
      // Native effects replace one queue; serialize requests to retain each update.
      enqueueTail = task;
      return task;
    }

    function openSearch(value) {
      return Promise.resolve().then(function () {
        if (disposed) return { ok: false, error: '桥接已关闭' };
        var query = searchQuery(value);
        if (!query) return { ok: false, error: '请先输入搜索词' };
        sample();
        if (!store || typeof store.dispatch !== 'function') return { ok: false, error: '当前客户端不提供原生搜索入口' };
        closeDetail();
        // Native chunk41/module3098 uses module164.b's two-stage URI encoding,
        // and the native route's spelling is deliberately "catagory".
        return Promise.resolve(store.dispatch({ type: 'async:action/doAction', payload: { actionId: 'link', data: {
          to: { linkPath: '/searchResults/' + encodeURI(encodeURIComponent(query)), state: { channel: 'suggest', catagory: 1 } }, resource: {}, resourceType: 'unknown'
        } } })).then(function () { return { ok: true, source: 'ncm-store', confirmed: false }; });
      }).catch(function (error) { return { ok: false, error: str(error && (error.message || error.msg) || error) }; });
    }

    function updateTools() {
      var mode = playing && playModes[playing.playingMode] || null;
      var volume = playing && playing.playingVolume;
      var volumeAvailable = !!store && typeof volume === 'number' && volume >= 0 && volume <= 1;
      snapshot.tools = {
        mode: mode, modeAvailable: !!mode && isEnabled(playbackModeButton()),
        volume: volumeAvailable ? Math.round(volume * 100) : null, volumeAvailable: volumeAvailable,
        collectionAvailable: !!collectionButton(), queueAvailable: !!queueButton()
      };
    }

    function cycleMode() {
      var button = playbackModeButton();
      if (!disposed && isEnabled(button)) button.click();
    }

    function setVolume(percent) {
      if (disposed || !snapshot.tools.volumeAvailable || !Number.isFinite(percent)) return;
      store.dispatch({ type: 'playing/setVolume', payload: { volume: Math.min(100, Math.max(0, percent)) / 100 } });
    }

    function lrcLines(text) {
      var offsetMatch = str(text).match(/\[offset:([+-]?\d+)\]/i);
      var offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      var lines = [];
      str(text).split(/\r?\n/).forEach(function (raw) {
        var milliseconds = raw.match(/^\s*\[(\d+),(\d+)\](.*)$/);
        if (milliseconds && milliseconds[3].trim()) {
          var timedText = milliseconds[3].replace(/\(\d+,\d+,-?\d+\)/g, '').trim();
          if (timedText) lines.push({ startMs: Number(milliseconds[1]), endMs: Number(milliseconds[1]) + Number(milliseconds[2]), text: timedText });
          return;
        }
        var times = Array.from(raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g));
        var content = raw.replace(/\[[^\]]*\]/g, '').trim();
        if (!content || /^\s*\{/.test(raw)) return;
        times.forEach(function (match) {
          var fraction = match[3] ? Number('0.' + match[3]) * 1000 : 0;
          lines.push({ startMs: Math.round(Math.max(0, (Number(match[1]) * 60 + Number(match[2])) * 1000 + fraction + offset)), endMs: null, text: content });
        });
      });
      return lines.sort(function (a, b) { return a.startMs - b.startMs; });
    }

    function yrcLines(text) {
      var lines = [];
      str(text).split(/\r?\n/).forEach(function (raw) {
        var head = raw.match(/^\s*\[(\d+),(\d+)\]/);
        if (!head) return;
        var words = [];
        var markers = Array.from(raw.matchAll(/\((\d+),(\d+),-?\d+\)/g));
        markers.forEach(function (match, index) {
          var content = raw.slice(match.index + match[0].length, markers[index + 1] ? markers[index + 1].index : raw.length);
          if (content) words.push({ startMs: Number(match[1]), durationMs: Number(match[2]), text: content });
        });
        if (!words.length) return;
        lines.push({ startMs: Number(head[1]), endMs: Number(head[1]) + Number(head[2]), text: words.map(function (word) { return word.text; }).join(''), words: words });
      });
      return lines.sort(function (a, b) { return a.startMs - b.startMs; });
    }

    function lyricTextKey(text) { return str(text).replace(/\s+/g, ''); }

    function attachTranslations(lines, translations, key, originalLines) {
      // Exact timestamps first. Conflicting entries at one time are ambiguous.
      var byTime = new Map();
      translations.forEach(function (line) {
        if (!finite(line.startMs) || !str(line.text)) return;
        var time = Math.round(line.startMs);
        byTime.set(time, byTime.has(time) && byTime.get(time) !== line.text ? null : line.text);
      });
      var originalsAtTime = new Map();
      var uniqueOriginals = new Map();
      (originalLines || []).forEach(function (line) {
        var text = lyricTextKey(line.text);
        if (!text || !finite(line.startMs)) return;
        var time = Math.round(line.startMs);
        originalsAtTime.set(time, originalsAtTime.has(time) && originalsAtTime.get(time) !== text ? null : text);
        uniqueOriginals.set(text, uniqueOriginals.has(text) ? null : line);
      });
      var targetCounts = new Map();
      lines.forEach(function (line) { var text = lyricTextKey(line.text); targetCounts.set(text, (targetCounts.get(text) || 0) + 1); });
      lines.forEach(function (line) {
        if (str(line[key])) return;
        var text = lyricTextKey(line.text);
        var time = finite(line.startMs) ? Math.round(line.startMs) : null;
        var value = time === null ? null : byTime.get(time);
        // A standard LRC translation may have a different clock than YRC. When
        // original text is supplied, reject coincident timestamps of another line.
        if (value && (!originalLines || !originalLines.length || originalsAtTime.get(time) === text)) line[key] = value;
        else if (targetCounts.get(text) === 1 && uniqueOriginals.get(text)) {
          var original = uniqueOriginals.get(text);
          var matched = byTime.get(Math.round(original.startMs));
          if (matched) line[key] = matched;
        }
      });
    }

    function nativeTextLines(lines, offsetMs) {
      return (Array.isArray(lines) ? lines : []).filter(function (line) { return finite(line.time) && str(line.lyric); }).map(function (line) {
        return { startMs: Math.round(Number(line.time) * 1000 + (offsetMs || 0)), text: line.lyric };
      });
    }

    function attachPublicTranslations(lines, payload) {
      var originals = lrcLines(payload.lrc && payload.lrc.lyric);
      ['ytlrc', 'ttlrc', 'tlyric'].forEach(function (field) {
        attachTranslations(lines, lrcLines(payload[field] && payload[field].lyric), 'translation', field === 'ytlrc' ? null : originals);
      });
      ['yromalrc', 'romalrc'].forEach(function (field) {
        attachTranslations(lines, lrcLines(payload[field] && payload[field].lyric), 'romanization', field === 'yromalrc' ? null : originals);
      });
    }

    function completeLineEnds(lines) {
      lines.forEach(function (line, index) {
        if (line.endMs === null && lines[index + 1] && finite(line.startMs) && lines[index + 1].startMs > line.startMs) line.endMs = lines[index + 1].startMs;
      });
      return lines;
    }

    function lyricOffsetMs(lyrics) {
      if (!nativeLyricRef || !snapshot.track || str(nativeLyricRef.resourceTrackId) !== snapshot.track.id) return 0;
      // Native LRC rows already include the user's offset. YRC and public
      // lyrics retain their original timestamps; consumers shift their clock.
      if (lyrics.kind !== 'word' && lyrics.source.indexOf('ncm-lyric-store:') === 0) return 0;
      return finite(nativeLyricRef.offset) ? Number(nativeLyricRef.offset) * 1000 : 0;
    }

    function useLyrics(lyrics, rank) {
      if (rank < lyricRank) return;
      lyricRank = rank;
      if (publicLyricPayload && lyrics.status === 'ready') {
        var hadTranslation = lyrics.lines.some(function (line) { return !!str(line.translation); });
        attachPublicTranslations(lyrics.lines, publicLyricPayload);
        if (!hadTranslation && lyrics.lines.some(function (line) { return !!str(line.translation); })) lyrics.translationSource = 'music.163.com';
      }
      lyrics.translationAvailable = lyrics.lines.some(function (line) { return !!str(line.translation); });
      lyrics.offsetMs = lyricOffsetMs(lyrics);
      snapshot.lyrics = lyrics;
    }

    function fromNativeLyrics(value) {
      if (!value || !snapshot.track || str(value.resourceTrackId) !== snapshot.track.id) return false;
      if (value.displayType === 'pure') {
        useLyrics({ status: 'instrumental', source: 'ncm-lyric-store', kind: 'none', lines: [], reason: '客户端标记为纯音乐' }, 3);
        return true;
      }
      var info = value.yrcInfo || {};
      var lines = yrcLines(info.yrc);
      if (lines.length) {
        attachTranslations(lines, lrcLines(info.yrcTrans), 'translation');
        attachTranslations(lines, lrcLines(info.yrcRoma), 'romanization');
        var nativeOriginals = nativeTextLines(value.lyricLines, finite(value.offset) ? Number(value.offset) * 1000 : 0);
        attachTranslations(lines, nativeTextLines(value.tlyricLines), 'translation', nativeOriginals);
        attachTranslations(lines, nativeTextLines(value.romaLyricLines), 'romanization', nativeOriginals);
        useLyrics({ status: 'ready', source: 'ncm-lyric-store:yrc', kind: 'word', lines: lines, reason: '' }, 4);
        return true;
      }
      if (!Array.isArray(value.lyricLines) || !value.lyricLines.length) return false;
      var timed = value.scrollable === true || value.currentUsedLyric === 'yrc';
      lines = value.lyricLines.map(function (line, index) {
        var time = timed && finite(line.time) ? Number(line.time) * 1000 : null;
        var result = { startMs: time === null ? null : Math.round(time), endMs: null, text: line.lyric };
        var translation = value.tlyricLines && value.tlyricLines[index];
        var romanization = value.romaLyricLines && value.romaLyricLines[index];
        var originalTime = time === null ? null : Math.round(time + (finite(value.offset) ? Number(value.offset) * 1000 : 0));
        if (translation && finite(translation.time) && Math.round(Number(translation.time) * 1000) === originalTime) result.translation = translation.lyric;
        if (romanization && finite(romanization.time) && Math.round(Number(romanization.time) * 1000) === originalTime) result.romanization = romanization.lyric;
        return result;
      }).filter(function (line) { return typeof line.text === 'string' && line.text.trim(); });
      if (!lines.length) return false;
      useLyrics({ status: 'ready', source: 'ncm-lyric-store:' + str(value.currentUsedLyric), kind: timed ? 'line' : 'plain', lines: completeLineEnds(lines), reason: timed ? '' : '来源未提供同步时间' }, 2);
      return true;
    }

    function fromPublicLyrics(payload, url) {
      if (payload.nolyric === true || payload.pureMusic === true) return { status: 'instrumental', source: 'music.163.com', sourceUrl: url, kind: 'none', lines: [], reason: '官方歌词接口标记为纯音乐' };
      var lines = yrcLines(payload.yrc && payload.yrc.lyric);
      var wordTimed = lines.length > 0;
      if (!wordTimed) lines = lrcLines(payload.lrc && payload.lrc.lyric);
      if (!lines.length) {
        var raw = str(payload.lrc && payload.lrc.lyric);
        var plain = raw.split(/\r?\n/).filter(function (line) { return line.trim() && !/^\s*[\[{]/.test(line); });
        if (plain.length) return { status: 'ready', source: 'music.163.com', sourceUrl: url, kind: 'plain', lines: plain.map(function (text) { return { startMs: null, endMs: null, text: text }; }), reason: '来源未提供同步时间' };
        return { status: 'unavailable', source: 'music.163.com', sourceUrl: url, kind: 'none', lines: [], reason: payload.uncollected ? '官方暂未收录歌词' : '官方接口未返回可用歌词' };
      }
      attachPublicTranslations(lines, payload);
      return { status: 'ready', source: 'music.163.com', sourceUrl: url, kind: wordTimed ? 'word' : 'line', lines: completeLineEnds(lines), reason: '' };
    }

    function fetchPublicLyrics() {
      var track = snapshot.track;
      if (!track || !/^\d+$/.test(track.id) || /local|voice/i.test(track.resourceType) || lyricRequestKey === trackKey || typeof host.fetch !== 'function') return;
      lyricRequestKey = trackKey;
      var requestedKey = trackKey;
      var url = 'https://music.163.com/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=' + encodeURIComponent(track.id);
      lyricRequest = new host.AbortController();
      var controller = lyricRequest;
      var timeout = host.setTimeout(function () { controller.abort(); }, 10000);
      // Public current-song request only. Never use the client's cookie/session bridge.
      host.fetch(url, { credentials: 'omit', signal: controller.signal }).then(function (response) {
        if (!response.ok) throw new Error('歌词请求 HTTP ' + response.status);
        return response.json();
      }).then(function (payload) {
        if (disposed || controller.signal.aborted || lyricRequest !== controller || requestedKey !== trackKey) return;
        publicLyricPayload = payload;
        var result = fromPublicLyrics(payload, url);
        if (snapshot.lyrics.status === 'ready' && lyricRank >= 3) {
          // Enrich native YRC without replacing its verified original word clock.
          var enriched = Object.assign({}, snapshot.lyrics, { lines: snapshot.lyrics.lines.map(function (line) { return Object.assign({}, line); }) });
          attachPublicTranslations(enriched.lines, payload);
          if (enriched.lines.some(function (line) { return str(line.translation); })) enriched.translationSource = 'music.163.com';
          useLyrics(enriched, lyricRank);
        } else useLyrics(result, result.kind === 'word' ? 4 : result.status === 'ready' || result.status === 'instrumental' ? 2 : 1);
        emit();
      }).catch(function (error) {
        if (disposed || lyricRequest !== controller || requestedKey !== trackKey) return;
        if (!lyricRank) {
          snapshot.lyrics = { status: 'unavailable', source: 'music.163.com', sourceUrl: url, kind: 'none', lines: [], reason: error.name === 'AbortError' ? '歌词请求超时' : '官方歌词请求失败：' + str(error.message) };
          emit();
        }
      }).finally(function () { host.clearTimeout(timeout); if (lyricRequest === controller) lyricRequest = null; });
    }

    function sample() {
      if (disposed) return snapshot;
      try {
        var candidate = resolveStore();
        if (candidate !== store) {
          if (offStore) offStore();
          store = candidate;
          offStore = store ? store.subscribe(sample) : null;
        }
        var current = readCurrent();
        snapshot.detailState = current.detail && current.detail.pageState || 'closed';
        snapshot.detailFullscreen = !!(current.detail && current.detail.isVinylFullscreen && current.windowFullscreen !== false);
        playing = current.playing;
        var track = normalizeTrack(playing);
        var key = track ? track.resourceType + ':' + track.id : '';
        var coverColor = current.detail && current.detail.topColor;
        // The previous song's palette can survive until the new artwork is ready.
        if (key !== trackKey) snapshot.coverColor = null;
        if (track && track.coverUrl && coverColor && coverColor !== previousCoverColor) {
          var rgb = [coverColor.r, coverColor.g, coverColor.b];
          snapshot.coverColor = rgb.every(function (n) { return Number.isInteger(n) && n >= 0 && n <= 255; }) ? rgb : null;
        }
        previousCoverColor = coverColor;
        if (key !== trackKey) {
          if (lyricRequest) lyricRequest.abort();
          lyricRequest = null;
          trackKey = key;
          nativeLyricRef = null;
          lyricRequestKey = '';
          publicLyricPayload = null;
          lyricRank = 0;
          snapshot.lyrics = emptyLyrics(track ? 'loading' : 'unavailable', track ? '正在读取当前歌曲歌词' : '尚未读取到当前歌曲');
        }
        snapshot.track = track;
        snapshot.diagnostics.metadataSource = track ? track.source : 'unavailable';
        var identity = key + ':' + str(playing && playing.playId);
        if (identity !== clockIdentity) {
          clockIdentity = identity;
          resetVisualClock('track');
          visualContext = '';
          nativeProgressElement = null;
          nativeInteractionUntil = 0;
          previousNativePositionMs = nativePositionMs;
          clockAwaitingChange = nativePositionMs !== null;
          nativePositionMs = null;
          nativeChangedAt = 0;
          clockAdvancing = false;
          forwardSamples = 0;
          forwardEvidenceUntil = 0;
          observedNativeMotion = false;
          lastHostPlaybackState = 'unknown';
          lastButtonPlaybackState = 'unknown';
          pendingSeek = null;
          progress = { positionMs: null, sampledAt: Date.now(), source: 'unavailable' };
        }
        var clock = sampleDomProgress();
        if (current.lyric !== nativeLyricRef) {
          nativeLyricRef = current.lyric;
          fromNativeLyrics(current.lyric);
        }
        snapshot.lyrics.offsetMs = lyricOffsetMs(snapshot.lyrics);
        if (track && (lyricRank < 3 || snapshot.lyrics.status === 'ready' && !snapshot.lyrics.translationAvailable)) fetchPublicLyrics();
        if (track && !lyricRank && (/local|voice/i.test(track.resourceType) || !/^\d+$/.test(track.id))) snapshot.lyrics = emptyLyrics('unavailable', '当前曲目未提供可用的原生歌词');
        updatePlayback(clock);
        updateTools();
        emit();
        if (closeWhenOpened && snapshot.detailState === 'opened') {
          closeWhenOpened = false;
          host.setTimeout(function () { if (!disposed && snapshot.detailState === 'opened') closeDetail(); }, 0);
        }
        if (snapshot.detailState === 'closed') closeWhenOpened = false;
      } catch (error) { report(error); emit(); }
      return snapshot;
    }

    function closeDetail() {
      if (disposed) return;
      if (snapshot.detailState === 'opening') {
        closeWhenOpened = true;
        return;
      }
      // This control drives the native vinyl animation and clears fullscreen mode.
      var collapse = doc.querySelector('[data-testid="tid_vinyl_unfold_btn"]');
      if (collapse && snapshot.detailState === 'opened') collapse.click();
    }

    function command(action, argument) {
      if (disposed) return Promise.resolve({ ok: false, source: 'none', error: '桥接已关闭' });
      sample();
      var capability = { togglePlay: 'playPause', previous: 'previous', next: 'next', seek: 'seek' }[action];
      if (!snapshot.capabilities[capability]) return Promise.resolve({ ok: false, source: 'none', error: '当前宿主不提供此控制' });
      try {
        var dispatch = null;
        if (action === 'seek') {
          if (!finite(argument)) return Promise.resolve({ ok: false, source: 'none', error: '跳转时间必须为毫秒数' });
          var trial = playing.freeTrialInfo || {};
          var start = seconds(trial.start) || 0;
          var end = seconds(trial.end);
          var target = Math.max(start, Math.min(Number(argument), end === null ? snapshot.track.durationMs : Math.min(end, snapshot.track.durationMs)));
          dispatch = { type: 'playing/setPlayingPosition', payload: { duration: (target - start) / 1000 } };
          pendingSeek = { positionMs: target, requestedAt: Date.now() };
          resetVisualClock('seek-request');
          clockAdvancing = false;
        } else {
          var hostState = stateName(playing && playing.playingState);
          var directPause = action === 'togglePlay' && snapshot.playback.state === 'playing' && hostState !== 'playing';
          var directResume = action === 'togglePlay' && snapshot.diagnostics.playbackStateSource === 'native-stationary' && hostState === 'playing';
          if ((directPause || directResume) && playing.playId && host.channel && typeof host.channel.call === 'function') {
            // Verified native ABI: (playId, resumeOrPauseId). This is a request,
            // not a registerCall; it leaves the client's event dispatch untouched.
            var verb = directPause ? 'pause' : 'resume';
            var requestId = str(playing.resourceTrackId) + '|' + verb + '|' + Date.now().toString(36);
            host.channel.call(directPause ? 'audioplayer.pause' : 'audioplayer.play', function () {}, [playing.playId, requestId]);
            forwardSamples = 0;
            forwardEvidenceUntil = 0;
            observedNativeMotion = false;
            clockAdvancing = false;
            return Promise.resolve({ ok: true, source: 'native-audioplayer', confirmed: false });
          }
          var button = playerButton(action === 'togglePlay' ? 'play' : action);
          if (isEnabled(button)) {
            button.click();
            return Promise.resolve({ ok: true, source: 'native-player-button', confirmed: false });
          }
          if (action === 'togglePlay') dispatch = { type: 'playing/switchResumeOrPause', payload: { triggerScene: 'miniBar' } };
          else if (playing.playingMode === 'playFm') dispatch = { type: action === 'previous' ? 'fmPlaying/playPre' : 'fmPlaying/playNext', payload: {} };
          else dispatch = { type: 'playingList/jump2Track', payload: { flag: action === 'previous' ? -1 : 1, type: 'call', triggerScene: 'miniBar' } };
        }
        // ok means the native action was submitted. Progress/state change comes from the host.
        store.dispatch(dispatch);
        return Promise.resolve({ ok: true, source: 'ncm-store', confirmed: false });
      } catch (error) {
        report(error);
        return Promise.resolve({ ok: false, source: 'ncm-store', error: lastError });
      }
    }

    function visibilityChanged() {
      resetVisualClock('visibility');
      clockAdvancing = false;
      forwardSamples = 0;
      forwardEvidenceUntil = 0;
      if (progress.positionMs !== null) progress.sampledAt = Date.now();
      sample();
    }

    function nativeProgressInteraction(event) {
      if (event.type === 'keydown' && !/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(event.key)) return;
      var target = event.target;
      var container = target && typeof target.closest === 'function' && target.closest('[aria-label="播放进度调节"]');
      if (!container || container.closest('[data-ncm-immersive]')) return;
      // Observe native pointer/keyboard seek intent only; leave the original
      // handlers, propagation and the native audio player's callbacks untouched.
      nativeInteractionUntil = Date.now() + 2000;
      forwardSamples = 0;
      forwardEvidenceUntil = 0;
      clockAdvancing = false;
      resetVisualClock('native-seek');
    }

    // Completely passive: never register, replace or remove native RPC callbacks.
    // The global legacy SDK and app SDK have separate callback maps but share the
    // same channel source ('websdk'); registering there can replace the app clock.
    var timer = host.setInterval(sample, 200);
    doc.addEventListener('visibilitychange', visibilityChanged);
    doc.addEventListener('pointerdown', nativeProgressInteraction, true);
    doc.addEventListener('keydown', nativeProgressInteraction, true);
    var api = {
      version: '1.4.0',
      clockSource: 'native-minibar',
      getSnapshot: function () { return snapshot; },
      closeDetail: closeDetail,
      setDetailFullscreen: function (enabled) {
        if (disposed || !store || !readCurrent().detail) return null;
        return Promise.resolve(store.dispatch({ type: 'page:vinylPage/toggleFullscreen', payload: { fullscreen: !!enabled } }));
      },
      cycleMode: cycleMode,
      setVolume: setVolume,
      openCollection: openCollection,
      openQueue: openQueue,
      searchSongs: searchSongs,
      recentHistory: recentHistory,
      characterHistory: characterHistory,
      musicTags: musicTags,
      songMusicInfo: songMusicInfo,
      enqueueSong: enqueueSong,
      openSearch: openSearch,
      miniAction: async function (name, value) {
        if (!store || disposed || !(store.getState().app || {}).isMiniMode) return false;
        if (name === 'play' || name === 'previous' || name === 'next' || name === 'seek') {
          return (await command(name === 'play' ? 'togglePlay' : name, value)).ok;
        }
        if (name === 'volumeUp' || name === 'volumeDown') {
          if (!snapshot.tools.volumeAvailable || !Number.isFinite(snapshot.tools.volume)) return false;
          setVolume(snapshot.tools.volume + (name === 'volumeUp' ? 5 : -5));
          return true;
        }
        if (name === 'lyrics') {
          var lyricButton = doc.querySelector('footer [data-testid="tid_playbar_lyric_btn"]');
          if (!lyricButton) return false;
          lyricButton.click();
        } else if (name === 'menu') {
          store.dispatch({ type: 'async:action/popMenu', payload: { resource: {}, resourceType: 'miniMode', mode: 1 } });
        } else if (name === 'restore' || name === 'close' || name === 'collection') {
          await store.dispatch({ type: 'app/exitMiniMode', payload: { actionId: name === 'close' ? 'dummy' : 'switchToFullMode' } });
          if (name === 'collection') return (await openCollection()).ok;
        } else return false;
        return true;
      },
      sample: sample,
      subscribe: function (listener) {
        if (typeof listener !== 'function') throw new TypeError('subscribe requires a function');
        if (disposed) return function () {};
        listeners.add(listener);
        try { listener(snapshot); }
        catch (error) { listeners.delete(listener); throw error; }
        return function () { listeners.delete(listener); };
      },
      togglePlay: function () { return command('togglePlay'); },
      previous: function () { return command('previous'); },
      next: function () { return command('next'); },
      seek: function (milliseconds) { return command('seek', milliseconds); },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        host.clearInterval(timer);
        if (progressObserver) progressObserver.disconnect();
        observedProgressElements = [];
        doc.removeEventListener('visibilitychange', visibilityChanged);
        doc.removeEventListener('pointerdown', nativeProgressInteraction, true);
        doc.removeEventListener('keydown', nativeProgressInteraction, true);
        if (offStore) offStore();
        if (lyricRequest) lyricRequest.abort();
        searchWaiters.forEach(function (cancel) { cancel(); });
        searchWaiters.clear();
        songChoices.clear();
        nativeSongSearch = null;
        nativeHistory = null;
        nativeListeningRank = nativeMusicTags = nativeSongLyrics = null;
        musicTagCache.clear();
        listeners.clear();
      }
    };
    sample();
    return api;
  }

  if (host.NCMImmersiveBridge && typeof host.NCMImmersiveBridge.dispose === 'function') host.NCMImmersiveBridge.dispose();
  host.createNCMImmersiveBridge = createBridge;
  host.NCMImmersiveBridge = createBridge();
})(window);
