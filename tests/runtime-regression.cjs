const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
// Offline fixtures only. No client connection, network requests or packages.
const project = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(project, 'src/renderer', 'bridge.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(project, 'src/renderer', 'view.js'), 'utf8');
const desktopSource = fs.readFileSync(path.join(project, 'src/renderer', 'desktop-lyrics.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fixture(clientApi) {
  const requests = [], timers = new Map(), actions = [];
  const listeners = new Set();
  let timer = 0, collapseCount = 0;
  const state = { playing: { resourceTrackId: '1', resourceName: 'A', resourceType: 'track', resourceDuration: 120 },
    'async:lyric': null, 'page:vinylPage': { pageState: 'opened' } };
  const store = { getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, dispatch: action => actions.push(action) };
  const root = { _reactRootContainer: { _internalRoot: { current: { memoizedProps: { store } } } } };
  const document = { getElementById: id => id === 'root' ? root : null, querySelectorAll: () => [],
    querySelector: selector => selector.includes('tid_vinyl_unfold_btn') ? { click() { collapseCount++; } } : null,
    addEventListener() {}, removeEventListener() {} };
  const window = { document, console, AbortController, NcmClientApi: clientApi,
    setInterval: () => ++timer, clearInterval() {},
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve: payload => resolve({ ok: true, json: () => Promise.resolve(payload) }), reject })); } };
  vm.runInNewContext(bridgeSource, { window, console });
  return { bridge: window.NCMImmersiveBridge, state, store, root, requests, timers, actions, listeners, document, collapseCount: () => collapseCount };
}

(async () => {
  const f = fixture();
  f.state.playing.resourceTrackId = '2'; f.bridge.sample();
  f.state.playing.resourceTrackId = '1'; f.bridge.sample();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve({ lrc: { lyric: '[00:01.000]new A' } }); await flush();
  f.requests[0].resolve({ lrc: { lyric: '[00:01.000]stale A' } }); await flush();
  assert.equal(f.bridge.getSnapshot().lyrics.lines[0].text, 'new A');
  assert.equal(f.requests[0].options.signal.aborted, true);
  console.log('PASS A-B-A lyric request identity');

  f.state['async:lyric'] = { resourceTrackId: '1', offset: 2,
    yrcInfo: { yrc: '[1000,800](1000,800,0)first\n[5000,800](5000,800,0)second' } };
  f.bridge.sample();
  assert.equal(f.bridge.getSnapshot().lyrics.offsetMs, 2000);
  assert.equal(f.bridge.getSnapshot().lyrics.lines[1].startMs, 5000);
  f.state.playing.resourceTrackId = '3';
  f.state['async:lyric'] = { resourceTrackId: '3', offset: 2, scrollable: true, currentUsedLyric: 'lrc',
    lyricLines: [{ time: -1, lyric: 'first' }, { time: 3, lyric: 'second' }] };
  f.bridge.sample();
  assert.equal(f.bridge.getSnapshot().lyrics.offsetMs, 0);
  assert.equal(f.bridge.getSnapshot().lyrics.lines[0].startMs, -1000);
  console.log('PASS YRC offset metadata and already-shifted negative native LRC');
  let calls = 0;
  assert.throws(() => f.bridge.subscribe(() => { calls++; throw Error('initial callback'); }), /initial callback/);
  f.bridge.sample();
  assert.equal(calls, 1);
  f.bridge.dispose();
  f.bridge.closeDetail();
  assert.equal(f.bridge.setDetailFullscreen(true), null);
  assert.equal(f.collapseCount(), 0);
  assert.equal(f.actions.length, 0);
  console.log('PASS rejected subscriber cleanup and disposed native commands');

  // Some player styles unmount the native header after five seconds of inactivity.
  // React commits the restored button after Redux has notified its subscribers.
  const nativeControls = {};
  const detail = fixture(nativeControls);
  const page = detail.state['page:vinylPage'];
  const initialTimers = new Set(detail.timers.keys());
  let buttonMounted = false, collapses = 0;
  const query = detail.document.querySelector;
  detail.document.querySelector = selector => selector.includes('tid_vinyl_unfold_btn')
    ? buttonMounted && { click() { collapses++; page.pageState = 'closing'; detail.bridge.sample(); } }
    : query(selector);
  detail.store.dispatch = action => {
    assert.equal(action.type, 'page:vinylPage/onUpdate');
    assert.equal(action.payload.externalBarHidden, false);
    Object.assign(page, action.payload);
    detail.bridge.sample();
  };
  function finishRender() {
    detail.bridge.sample();
    for (const [id, fn] of Array.from(detail.timers)) {
      if (initialTimers.has(id)) continue;
      detail.timers.delete(id);
      fn();
    }
  }
  page.externalBarHidden = true;
  detail.bridge.closeDetail();
  assert.equal(page.externalBarHidden, false, 'restore the auto-hidden native header');
  buttonMounted = true;
  finishRender();
  assert.equal(page.pageState, 'closing');
  assert.equal(collapses, 1);
  page.pageState = 'closed'; detail.bridge.sample();
  // The visual effect/fullscreen layout can keep its header unmounted even after waking.
  buttonMounted = false;
  nativeControls.closeVinylPage = () => {
    collapses++;
    page.pageState = 'closing';
    detail.bridge.sample();
  };
  page.pageState = 'opening'; detail.bridge.sample();
  detail.bridge.closeDetail(); detail.bridge.closeDetail();
  assert.equal(collapses, 1, 'wait until the opening animation finishes');
  page.pageState = 'opened'; finishRender();
  assert.equal(collapses, 2, 'two early clicks collapse the new page once');
  page.pageState = 'closed'; detail.bridge.sample();
  page.pageState = 'opening'; detail.bridge.sample();
  detail.bridge.closeDetail();
  page.pageState = 'opened'; detail.bridge.sample();
  page.pageState = 'closed'; detail.bridge.sample();
  page.pageState = 'opened'; finishRender();
  assert.equal(collapses, 2, 'a later open starts with no queued close');
  detail.bridge.dispose();
  console.log('PASS collapse after the native header unmounts, during opening and on reopen');

  const timeout = fixture();
  [...timeout.timers.values()][0]();
  timeout.requests[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); await flush();
  assert.equal(timeout.bridge.getSnapshot().lyrics.status, 'unavailable');
  assert.equal(timeout.bridge.getSnapshot().lyrics.reason, '歌词请求超时');
  timeout.bridge.dispose();
  console.log('PASS current lyric timeout remains visible');

  const d = fixture(), callsToNative = [], prefs = new Map([
    ['ncm-immersive.word', 'off'], ['ncm-immersive.fontFamily', 'corsiva']
  ]);
  d.state.setting = { lyricFont: 'native', lyricFontSize: 36, lyricFontStyle: 0,
    showLyric: true, lyricLineMode: 1, lyricComposition: 'horizontal' };
  d.state.playing.playingState = 1;
  d.state['async:lyric'] = { resourceTrackId: '1', displayType: 'default', scrollable: true,
    lyricLines: [{ time: 0, lyric: 'first' }] };
  const container = { classList: { contains: () => false }, querySelector: () => null };
  const slider = { value: '0', min: '0', max: '120',
    closest: selector => selector === '[aria-label="播放进度调节"]' ? container : null };
  d.document.querySelectorAll = selector => selector === '[aria-label="播放进度调节"] input[type="range"]' ? [slider] : [];
  d.bridge.sample();
  const original = function (...args) { callsToNative.push({ self: this, args }); return 'native result'; };
  const context = { window: { channel: { call: original } }, document: d.document,
    localStorage: { getItem: key => prefs.get(key) }, console };
  vm.runInNewContext(desktopSource, context);
  const stop = context.watchDesktopLyrics(d.bridge), channel = context.window.channel;
  const caption = JSON.parse(stop.caption(''));
  assert.equal(caption.text, 'first');
  assert.equal(callsToNative.at(-1).args[2][2], 'Monotype Corsiva');
  const payload = { yrc: 'native YRC', lrc: '[00:00]first', tlrc: '[00:00]译文' }, callback = () => {};
  channel.call('player.setLyrics', callback, [payload]);
  assert.equal(callsToNative.at(-1).args[2][0].yrc, '');
  assert.equal(callsToNative.at(-1).args[2][0].tlrc, payload.tlrc);
  assert.equal(callsToNative.at(-1).args[1], callback);
  prefs.set('ncm-immersive.word', 'on'); d.bridge.sample();
  assert.equal(callsToNative.at(-1).args[2][0].yrc, payload.yrc);
  d.state.setting.lyricFont = '楷体';
  channel.call('player.setLRCFont', callback, ['42', '0', '楷体']); d.bridge.sample();
  assert.equal(stop.getState().fontFamily, '楷体');
  const immersive = channel.call;
  channel.call = function (...args) { return immersive.apply(this, args); };
  stop();
  assert.equal(callsToNative.at(-1).args[2][0].yrc, payload.yrc);
  assert.equal(callsToNative.filter(call => call.args[0] === 'player.setLRCColor').length, 0);
  assert.equal(channel.call('player.setLyrics', callback, [payload]), 'native result');
  assert.equal(callsToNative.at(-1).args[1], callback);
  assert.equal(callsToNative.at(-1).args[2][0], payload);
  assert.equal(callsToNative.at(-1).self, channel);
  const reinjected = context.watchDesktopLyrics(d.bridge);
  const freshCaption = JSON.parse(reinjected.caption(caption.key));
  assert.notEqual(freshCaption.key, caption.key);
  assert.equal(freshCaption.text, 'first');
  reinjected();
  d.state.setting.lyricColor = ['#eeeeee', '#dddddd', '#ffdddd', '#ffaaaa'];
  d.state.setting.lyricOutLine = ['#444444', '#663333'];
  let palette = null;
  const themed = context.watchDesktopLyrics(d.bridge, () => palette);
  const originalCaption = JSON.parse(themed.caption(''));
  palette = { id: 'reimu', background: '#30191b', foreground: '#fff6e8', muted: '#d8c0b2', accent: '#f3b0a7', accentText: '#30191b' };
  const themedCaption = JSON.parse(themed.caption(originalCaption.key));
  assert.notEqual(themedCaption.key, originalCaption.key, 'theme changes resend the current line');
  assert.deepEqual(themedCaption.color, [palette.muted, palette.muted, palette.accent, palette.accent]);
  assert.equal(themedCaption.palette.id, 'reimu');
  assert.equal(JSON.parse(themed.caption(themedCaption.key)).text, undefined, 'stable theme keeps compact progress packets');
  palette = { ...palette, accent: '#abcdef' };
  const customCaption = JSON.parse(themed.caption(themedCaption.key));
  assert.equal(customCaption.color[2], '#abcdef', 'custom highlight updates without a track change');
  prefs.set('ncm-immersive.captionTheme', 'off');
  const nativeCaption = JSON.parse(themed.caption(customCaption.key));
  assert.equal(nativeCaption.palette, null);
  assert.deepEqual(nativeCaption.color, d.state.setting.lyricColor, 'native custom colors survive theme following');
  assert.deepEqual(nativeCaption.outline, d.state.setting.lyricOutLine);
  prefs.set('ncm-immersive.captionTheme', 'on');
  palette = null;
  assert.equal(JSON.parse(themed.caption('')).palette, null, 'cover mode restores native colors');
  themed();
  vm.runInNewContext(fs.readFileSync(path.join(project, 'src/renderer', 'minibar.js'), 'utf8'), context);
  const mini = context.makeMiniSnapshot(d.bridge, { key: '', thumbnail: '' }, () => palette);
  assert.equal(JSON.parse(mini('')).palette, null);
  palette = { id: 'patchouli', background: '#21182c', foreground: '#f8effc', muted: '#cdbbd8', accent: '#d9bde8', accentText: '#21182c' };
  assert.deepEqual(JSON.parse(mini('')).palette, palette, 'mini player receives same-track theme changes');
  palette = null;
  assert.equal(JSON.parse(mini('')).palette, null);
  console.log('PASS shared mini/caption theme, compact updates, custom accent and native color restore');
  const failBridge = { getSnapshot: () => d.bridge.getSnapshot(), subscribe() { throw Error('subscription failed'); } };
  const before = channel.call;
  assert.throws(() => context.watchDesktopLyrics(failBridge), /subscription failed/);
  assert.equal(channel.call, before);
  d.bridge.dispose();
  console.log('PASS native lyric/font preferences, wrapper cleanup and failed-start restoration');
  console.log('PASS reinjected desktop caption sends a fresh full line');

  // Poll the real caption producer with a controllable native clock. A short
  // missing sample must preserve surface ownership; only ready packets carry ink.
  let captionNow = 0;
  const captionState = { setting: { showLyric: true, lyricComposition: 'horizontal', lyricLineMode: 1,
    lyricFont: 'native', lyricFontSize: 36 }, playing: { playingState: 2, playId: 'first-play' },
    'async:lyric': { resourceTrackId: '1', displayType: 'default', scrollable: true,
      lyricLines: [{ time: 0, lyric: 'song A' }] } };
  let captionSnapshot = { track: { id: '1', resourceType: 'track' }, lyrics: { lines: [] }, diagnostics: {},
    playback: { positionMs: 1000, durationMs: 120000, state: 'playing',
      visualClock: { positionMs: 1000, sampledAt: 0, maxInterpolationMs: 1250 } } };
  const captionRoot = { _reactRootContainer: { _internalRoot: { current: { memoizedProps: {
    store: { getState: () => captionState, dispatch() {} }
  } } } } };
  const captionDocument = { hidden: false, getElementById: () => captionRoot };
  const captionPrefs = new Map();
  const captionSerializations = [];
  const captionContext = { window: { channel: { call() {} } }, document: captionDocument,
    localStorage: { getItem: key => captionPrefs.get(key) }, Date: { now: () => captionNow },
    JSON: { stringify(value) { captionSerializations.push(value); return JSON.stringify(value); } } };
  vm.runInNewContext(desktopSource, captionContext);
  let syncCaption;
  const captionBridge = { getSnapshot: () => captionSnapshot, sample: () => captionSnapshot,
    subscribe(fn) { syncCaption = fn; fn(captionSnapshot); return () => {}; } };
  const captions = captionContext.watchDesktopLyrics(captionBridge);
  const readyCaption = JSON.parse(captions.caption(''));
  assert.equal(readyCaption.status, 'ready');
  assert.equal(readyCaption.composition, 'horizontal');
  assert.equal(readyCaption.background, true);
  assert.deepEqual([readyCaption.fontSize, readyCaption.translationFontSize, readyCaption.captionScale], [36, 18, 1]);
  captionDocument.hidden = true; captionNow = 180;
  const warmupCaption = JSON.parse(captions.caption(readyCaption.key));
  assert.equal(warmupCaption.status, 'transient', 'hidden native-clock warmup keeps the surface');
  assert.equal(warmupCaption.identity, readyCaption.identity);
  assert.equal(warmupCaption.text, undefined, 'uncertain timing never resends stale lyrics');
  captionDocument.hidden = false; captionNow = 360;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).key, readyCaption.key, 'short gaps reuse the current full line');
  captionSnapshot.playback.positionMs = NaN;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).status, 'transient', 'a missing position sample preserves the surface');
  captionSnapshot.playback.positionMs = 1000;
  for (const [at, positionMs] of [[1000, 2000], [2000, 3000]]) {
    captionNow = at; captionSnapshot.playback.positionMs = positionMs;
    captions.caption(readyCaption.key);
  }
  captionNow = 3500;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).status, 'transient', 'stalled progress is a bounded host hold');
  captionNow = 3600; captionSnapshot.playback.positionMs = 4600;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).status, 'ready', 'fresh native progress resumes the same surface');
  captionDocument.hidden = true;
  captionState.playing.isLoadingFirst = true;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).status, 'transient', 'hidden buffering clears uncertain ink');
  captionState.playing.isLoadingFirst = false; captionDocument.hidden = false;
  assert.equal(JSON.parse(captions.caption(readyCaption.key)).status, 'ready', 'buffering recovery reuses the surface');
  captionDocument.hidden = true;
  captionState.playing.playingState = 1; captionSnapshot.playback.state = 'paused';
  const pausedCaption = JSON.parse(captions.caption(readyCaption.key));
  assert.equal(pausedCaption.status, 'ready', 'a real pause remains a supported caption');
  assert.equal(pausedCaption.playing, false);
  const nativeCaptionLyrics = captionState['async:lyric'];
  Object.assign(nativeCaptionLyrics, { offset: 2, tlyricLines: [{ time: 2, lyric: '歌 A' }],
    romaLyricLines: [{ time: 2, lyric: 'songu A' }],
    yrcInfo: { yrc: '[2000,5000](2000,5000,0)song A', yrcRoma: '[00:02]word songu A' } });
  captionSnapshot.lyrics = { kind: 'word', source: 'music.163.com', lines: [{ startMs: 2000, endMs: 7000,
    text: 'song A', translation: '歌 A', romanization: 'public songu A', words: [{ text: 'song A', startMs: 2000, durationMs: 5000 }] }] };
  captionPrefs.set('ncm-immersive.word', 'off');
  assert.equal(JSON.parse(captions.caption('')).translation, '歌 A', 'native LRC translation retains its offset');
  // NetEase's real setting and desktop-menu effects store "roman".
  captionState.setting.lyricMode = 'roman';
  captionPrefs.set('ncm-immersive.translation', 'off');
  const romanizedCaption = JSON.parse(captions.caption(''));
  assert.equal(romanizedCaption.translation, 'songu A', 'native romanization keeps the custom caption with translation disabled');
  nativeCaptionLyrics.romaLyricLines = [{ time: 2, lyric: 'updated songu A' }];
  assert.equal(JSON.parse(captions.caption(romanizedCaption.key)).translation, 'updated songu A', 'romanization source changes invalidate line data');
  captionPrefs.set('ncm-immersive.word', 'on');
  const wordRomanized = JSON.parse(captions.caption(''));
  assert.equal(wordRomanized.translation, 'word songu A');
  assert.equal(wordRomanized.words[0].startMs, 0, 'native YRC romanization shares the original word offset');
  captionSerializations.length = 0;
  const compactWordCaption = JSON.parse(captions.caption(wordRomanized.key));
  assert.equal(compactWordCaption.text, undefined);
  assert.equal(captionSerializations.length, 1, 'steady word progress serializes only the compact packet');
  assert.equal(captionSerializations[0].words, undefined, 'steady progress does not serialize the full word data');
  nativeCaptionLyrics.yrcInfo.yrcRoma = '[00:02]updated word songu A';
  assert.equal(JSON.parse(captions.caption(wordRomanized.key)).translation, 'updated word songu A');
  nativeCaptionLyrics.yrcInfo = {};
  assert.equal(JSON.parse(captions.caption('')).translation, 'public songu A', 'enriched word lyrics keep their romanization');
  captionSnapshot.lyrics = { lines: [] };
  nativeCaptionLyrics.romaLyricLines = [];
  const missingRomanization = JSON.parse(captions.caption(''));
  assert.equal(missingRomanization.status, 'ready', 'roman mode without an available transliteration keeps the custom surface');
  assert.equal(missingRomanization.text, 'song A');
  assert.equal(missingRomanization.translation, '');
  captionState.setting.lyricMode = 'none';
  assert.equal(JSON.parse(captions.caption('')).translation, '', 'original mode hides the secondary text');
  captionPrefs.set('ncm-immersive.captionFontSize', '48');
  captionPrefs.set('ncm-immersive.captionTranslationSize', '22');
  captionPrefs.set('ncm-immersive.captionScale', '1.25');
  captionPrefs.set('ncm-immersive.lyricSize', '60');
  captionPrefs.set('ncm-immersive.translationSize', '30');
  const resizedCaption = JSON.parse(captions.caption(''));
  assert.deepEqual([resizedCaption.fontSize, resizedCaption.translationFontSize, resizedCaption.captionScale], [48, 22, 1.25]);
  assert.deepEqual({ ...captions.getState().preferences }, { captionFontSize: 48, captionTranslationSize: 22, captionScale: 1.25, captionBackground: true });
  captionPrefs.set('ncm-immersive.captionBackground', 'off');
  const clearCaption = JSON.parse(captions.caption(resizedCaption.key));
  assert.equal(clearCaption.background, false, 'the caption plate can be hidden without releasing the lyric surface');
  assert.equal(clearCaption.text, resizedCaption.text);
  captionSnapshot.track = { id: '2', resourceType: 'track' };
  captionSnapshot.lyrics = { lines: [] };
  const changingCaption = JSON.parse(captions.caption(readyCaption.key));
  assert.equal(changingCaption.status, 'transient');
  assert.notEqual(changingCaption.identity, readyCaption.identity);
  assert.equal(changingCaption.text, undefined, 'a track gap cannot display the previous song');
  captionState['async:lyric'] = { resourceTrackId: '2', displayType: 'default', scrollable: true,
    lyricLines: [{ time: 0, lyric: 'song B' }] };
  const nextCaption = JSON.parse(captions.caption(readyCaption.key));
  assert.equal(nextCaption.text, 'song B');
  assert.notEqual(nextCaption.key, readyCaption.key);
  captionState.playing.playId = 'repeat-play';
  assert.notEqual(JSON.parse(captions.caption(nextCaption.key)).key, nextCaption.key, 'a new play identity resends the full line');
  let reopenedLineReads = 0;
  captionState['async:lyric'].lyricLines = [{ time: 0, get lyric() { reopenedLineReads++; return 'song B'; } }];
  const beforeClose = JSON.parse(captions.caption(''));
  const readsBeforeClose = reopenedLineReads;
  captionState.setting.showLyric = false;
  syncCaption(captionSnapshot);
  captionState.setting.showLyric = true;
  syncCaption(captionSnapshot);
  const reopenedCaption = JSON.parse(captions.caption(beforeClose.key));
  assert.notEqual(reopenedCaption.key, beforeClose.key, 'closing without a final caption poll releases the cached full line');
  assert.equal(reopenedCaption.text, 'song B');
  assert.ok(reopenedLineReads > readsBeforeClose, 'reopening rebuilds parsed lyrics released by the setting subscription');
  captionState.setting.showLyric = false;
  assert.equal(captions.caption(nextCaption.key), 'null', 'closing immediately releases the native surface');
  captionState.setting.showLyric = true; captionState.setting.lyricComposition = 'vertical';
  const verticalCaption = JSON.parse(captions.caption(nextCaption.key));
  assert.equal(verticalCaption.status, 'ready', 'native vertical mode keeps the custom lyric surface');
  assert.equal(verticalCaption.composition, 'vertical');
  assert.equal(verticalCaption.text, 'song B');
  captionState.setting.lyricComposition = 'horizontal';
  assert.equal(JSON.parse(captions.caption(verticalCaption.key)).composition, 'horizontal', 'composition changes resend the full line');
  captionState['async:lyric'].displayType = 'instrumental';
  assert.equal(captions.caption(nextCaption.key), 'null', 'explicit native no-lyric modes release immediately');
  captions();
  console.log('PASS caption transient gaps, native lyric modes, independent sizing, pause, song identity and immediate release');

  // Exercise the real view's line construction and painter clock with one
  // small DOM fixture; no copied offset or line-selection algorithm.
  const extract = name => viewSource.match(new RegExp('    function ' + name + '\\([^]*?\\n    }'))[0];
  function node() { return { dataset: {}, children: [], style: { setProperty() {} },
    classList: { add() {}, toggle() {} }, getAttribute() {}, setAttribute() {}, removeAttribute() {},
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    appendChild(child) { this.children.push(child); this.firstElementChild ||= child; } }; }
  const env = { document: { createElement: node, createDocumentFragment: node }, clearTimeout, Date, console,
    finite: Number.isFinite, time: String, timedWords: line => line.words || [],
    lines: [{ startMs: 1000, text: 'first', words: [{ startMs: 1000, durationMs: 800, text: 'first' }] },
      { startMs: 5000, text: 'second', words: [{ startMs: 5000, durationMs: 800, text: 'second' }] }],
    lyricOffsetMs: 2000, snapshot: { capabilities: { seek: true } }, lyricTrack: node(),
    wordRows: [], lineStarts: [], lyricInk: null, curveRows: null, hasWordTiming: false, hasLineTiming: false,
    suspendedTabIndexes: new Map(), focusBeforeNativeDialog: null,
    activeLine: -1, view: node(), viewport: {}, manualUntil: 0, resumeTimer: 0, opened: true,
    seekPreview: null, dragging: false, progress: { ...node(), max: '1', valueAsNumber: 0 },
    positionLabel: {}, durationLabel: {}, $: node,
    currentPosition: () => 3200, getDuration: () => 120000, lyricMode: () => 'word', centerLine() {}, updateLyricCurve() {},
    measureLyricInk: () => ({}), paintLyricInk: (_ink, position) => { env.paintedPosition = position; } };
  env.lyricTrack.appendChild = function (fragment) { this.children = fragment.children; };
  vm.createContext(env);
  vm.runInContext(extract('clearLyrics') + '\n' + extract('buildLyrics') + '\nbuildLyrics();', env);
  assert.equal(env.lyricTrack.children[1].dataset.startMs, '3000');
  vm.runInContext(extract('renderPosition') + '\nrenderPosition(false);', env);
  assert.equal(env.activeLine, 1);
  assert.equal(env.paintedPosition, 5200);
  console.log('PASS view lyric seek target and word painter share native offset');
})().catch(error => { console.error(error); process.exitCode = 1; });
