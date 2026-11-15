/* Offline native-clock replay. Loads the real bridge API and the real view clock
   readers in isolated VMs. It never connects to the client or uses the network. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const project = path.resolve(__dirname, '..');
const options = { bridge: path.join(project, 'src/renderer', 'bridge.js'), view: path.join(project, 'src/renderer', 'view.js'), report: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options) || !process.argv[i + 1]) throw Error('Usage: node ncm-clock-replay.cjs [--bridge file] [--view file] [--report file]');
  options[key] = path.resolve(process.argv[i + 1]);
}
const bridgeSource = fs.readFileSync(options.bridge, 'utf8');
const viewSource = fs.readFileSync(options.view, 'utf8');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const extract = name => {
  const match = viewSource.match(new RegExp('    function ' + name + '\\([^]*?\\n    }'));
  if (!match) throw Error('The real view function is missing: ' + name);
  return match[0];
};

function fixture() {
  let now = 100000, nextTimer = 0;
  const timers = new Map(), dispatched = [], subscribers = new Set(), documentListeners = new Map();
  const playing = {
    resourceTrackId: '1001', resourceName: 'Replay A', resourceType: 'track', resourceDuration: 120,
    resourceArtists: [{ name: 'Fixture artist' }], playId: 'play-A', playingState: 2,
    playingMode: 'playCycle', playingVolume: 0.5, freeTrialInfo: {}, isLoadingFirst: false
  };
  const state = { playing, 'async:lyric': null, 'page:vinylPage': { pageState: 'opened' } };
  const store = { getState: () => state, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, dispatch: action => dispatched.push(action) };
  let dragging = false, loading = false;
  const container = { classList: { contains: name => name === 'slider-vinyl' || name === 'dragging' && dragging }, querySelector: selector => selector === '.thumb.loading' && loading ? {} : null };
  const ownerProps = { resourceTrackId: '1001', resourceDuration: 120 };
  const slider = { value: '10', min: '0', max: '120', __reactFiberReplay: { memoizedProps: ownerProps }, closest: selector => selector === '[aria-label="播放进度调节"]' ? container : null };
  const button = kind => ({ disabled: false, closest: () => null, classList: { contains: () => false }, getAttribute: name => {
    if (name === 'data-log' && kind === 'play') return JSON.stringify({ params: { type: playing.playingState === 2 ? 'pause' : 'play' } });
    if (name === 'title') return kind === 'play' ? playing.playingState === 2 ? '暂停' : '播放' : kind === 'previous' ? '上一首' : '下一首';
    return null;
  }, click() { throw Error('Replay does not click native controls'); } });
  const buttons = { btn_pc_minibar_play: button('play'), btn_pc_previous: button('previous'), btn_pc_next: button('next') };
  const root = { _reactRootContainer: { _internalRoot: { current: { memoizedProps: { store } } } } };
  const doc = { hidden: false, getElementById: id => id === 'root' ? root : buttons[id] || null,
    querySelectorAll: selector => selector === '[aria-label="播放进度调节"] input[type="range"]' ? [slider] : [],
    querySelector: () => null,
    addEventListener(name, fn, capture = false) { const key = name + ':' + capture; if (!documentListeners.has(key)) documentListeners.set(key, new Set()); documentListeners.get(key).add(fn); },
    removeEventListener(name, fn, capture = false) { const set = documentListeners.get(name + ':' + capture); if (set) set.delete(fn); } };
  const host = { document: doc, console,
    setInterval(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay, at: now + delay }); return id; },
    clearInterval: id => timers.delete(id), setTimeout: () => ++nextTimer, clearTimeout() {} };
  class ReplayDate extends Date { static now() { return now; } }
  const context = vm.createContext({ window: host, Date: ReplayDate, console });
  vm.runInContext(bridgeSource, context, { filename: options.bridge });
  const api = host.NCMImmersiveBridge;
  // These are the same clock readers called by renderPosition/getState. No copied
  // interpolation algorithm is maintained by this test.
  const view = vm.runInNewContext(`let snapshot=null;
    const finite=value=>typeof value==='number'&&Number.isFinite(value);
    ${extract('getDuration')}
    ${extract('currentPosition')}
    ({read(next){snapshot=next;return {label:currentPosition(),visual:currentPosition(true)};}})`, { Date: ReplayDate });
  const rows = [];
  function advance(at) {
    const target = 100000 + at;
    while (true) {
      const due = Array.from(timers.values()).filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at; due.at += due.delay; due.fn();
    }
    now = target;
  }
  function native(change) {
    if ('position' in change) slider.value = String(change.position / 1000);
    if ('state' in change) playing.playingState = change.state;
    if ('dragging' in change) dragging = change.dragging;
    if ('loading' in change) loading = change.loading;
    if ('hidden' in change) {
      doc.hidden = change.hidden;
      for (const fn of documentListeners.get('visibilitychange:false') || []) fn();
    }
    if (change.track) {
      playing.resourceTrackId = change.track; playing.playId = 'play-' + change.track;
      playing.resourceName = 'Replay ' + change.track; ownerProps.resourceTrackId = change.track;
    }
    api.sample();
  }
  function capture(at) {
    const snapshot = api.getSnapshot(), display = view.read(snapshot);
    if (snapshot.diagnostics.lastError) throw Error(snapshot.diagnostics.lastError);
    rows.push({ at, track: snapshot.track && snapshot.track.id, state: snapshot.playback.state,
      raw: snapshot.playback.positionMs, label: display.label, visual: display.visual,
      epoch: snapshot.playback.clockEpoch, reason: snapshot.playback.clockReason,
      rate: snapshot.playback.visualClock && snapshot.playback.visualClock.rate });
  }
  function seek(target) {
    api.seek(target).then(result => { if (!result.ok) throw Error('Seek was rejected: ' + result.error); });
    const action = dispatched[dispatched.length - 1];
    if (!action || action.type !== 'playing/setPlayingPosition' || action.payload.duration !== target / 1000) throw Error('Wrong native seek dispatch');
  }
  function run(until, events) {
    for (let at = 0; at <= until; at += 20) {
      advance(at);
      for (const event of events.filter(event => event.at === at)) event.seek === undefined ? native(event) : seek(event.seek);
      capture(at);
    }
    api.dispose();
    if (timers.size || subscribers.size || Array.from(documentListeners.values()).some(set => set.size)) throw Error('dispose left timers, store subscriptions or document handlers attached');
    return rows;
  }
  return { run };
}

const warm = [0, 1000, 2000, 3000].map(at => ({ at, position: 10000 + at }));
function noRegression(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].visual !== null && rows[i - 1].visual !== null && rows[i].visual < rows[i - 1].visual - 0.01)
      throw Error(`Visual clock regressed at ${rows[i].at}ms: ${rows[i - 1].visual} -> ${rows[i].visual}`);
  }
}
const cases = [
  { name: 'continuous-fractional-reanchor', until: 6000, events: [
    { at: 0, position: 10000 }, { at: 1000, position: 11000 }, { at: 2000, position: 12000 },
    { at: 3000, position: 12682 }, { at: 4000, position: 13682 }, { at: 5000, position: 14682 }, { at: 6000, position: 15682 }
  ], check(rows) {
    noRegression(rows);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].label !== null && rows[i - 1].label !== null && Math.floor(rows[i].label / 1000) < Math.floor(rows[i - 1].label / 1000))
        throw Error('The visible native second regressed');
    }
  } },
  { name: 'pause-resume', until: 8000, events: [...warm, { at: 3600, position: 13600, state: 1 }, { at: 5000, position: 13600, state: 2 }, { at: 6000, position: 14600 }, { at: 7000, position: 15600 }, { at: 8000, position: 16600 }], check(rows) {
    const paused = rows.filter(row => row.at >= 3600 && row.at < 5000);
    if (paused.some(row => row.state !== 'paused' || row.visual !== paused[0].visual)) throw Error('Paused clock did not freeze');
    const resumed = rows.find(row => row.at === 5000);
    if (resumed.visual < 13600 || resumed.visual > 13700) throw Error('Resume added paused wall time');
    if (rows[rows.length - 1].raw < 16600) throw Error('Native progress did not resume');
  } },
  ...[{ name: 'overlay-forward-seek', target: 60000 }, { name: 'overlay-backward-seek', target: 2000 }].map(({ name, target }) => ({
    name, until: 5700, events: [...warm, { at: 3500, seek: target }, { at: 3700, position: target }, { at: 4700, position: target + 1000 }, { at: 5700, position: target + 2000 }],
    check(rows) {
      const before = rows.find(row => row.at === 3480), requested = rows.find(row => row.at === 3500), acknowledged = rows.find(row => row.at === 3700);
      if (acknowledged.raw !== target || Math.abs(acknowledged.visual - target) > 100) throw Error('Native seek acknowledgement was not accepted');
      if (typeof before.epoch === 'number' && requested.epoch <= before.epoch) throw Error('Seek did not change clockEpoch');
    }
  })),
  { name: 'native-backward-drag', until: 5700, events: [...warm, { at: 3500, position: 4000, dragging: true }, { at: 3700, position: 4200, dragging: false }, { at: 4700, position: 5200 }, { at: 5700, position: 6200 }], check(rows) {
    const dragged = rows.find(row => row.at === 3500);
    if (dragged.raw !== 4000 || Math.abs(dragged.visual - 4000) > 100) throw Error('A real backward drag was wrongly clamped');
  } },
  { name: 'track-switch-stale-native-value', until: 5700, events: [...warm, { at: 3500, track: '1002' }, { at: 3700, position: 0 }, { at: 4700, position: 1000 }, { at: 5700, position: 2000 }], check(rows) {
    const changed = rows.find(row => row.at === 3500), fresh = rows.find(row => row.at === 3700);
    if (changed.track !== '1002' || changed.raw !== null || changed.visual !== null) throw Error('New track borrowed the previous track clock');
    if (fresh.raw !== 0 || fresh.visual !== 0) throw Error('New track did not start from its real zero');
    if (typeof changed.epoch === 'number' && changed.epoch <= rows.find(row => row.at === 3480).epoch) throw Error('Track did not change clockEpoch');
  } },
  ...[{ name: 'native-positive-1095-per-second', step: 1095, count: 8 }, { name: 'repeated-positive-682-per-second', step: 682, count: 15 }, { name: 'slow-positive-400-per-second-bounded-lead', step: 400, count: 45 }].map(({ name, step, count }) => ({
    name, until: 2000 + count * 1000,
    events: [{ at: 0, position: 10000 }, { at: 1000, position: 11000 }, { at: 2000, position: 12000 }, ...Array.from({ length: count }, (_, i) => ({ at: 3000 + i * 1000, position: 12000 + step * (i + 1) }))],
    check(rows) {
      noRegression(rows);
      const epochs = new Set(rows.filter(row => row.at >= 2100).map(row => row.epoch));
      if (epochs.size !== 1) throw Error('Ordinary continuous positive samples changed clockEpoch');
      if (rows.some(row => row.raw !== null && row.visual - row.raw > 2500)) throw Error('Visual lead accumulated without a bound');
    }
  })),
  { name: 'interpolation-expiry-without-raw-rollback', until: 3400, events: warm.slice(0, 3), check(rows) {
    noRegression(rows);
    const frozen = rows.filter(row => row.at >= 3260);
    if (frozen.some(row => Math.abs(row.visual - frozen[0].visual) > 0.01)) throw Error('Expired visual horizon did not freeze');
  } },
  ...[{ name: 'background-return-no-wall-time', key: 'hidden' }, { name: 'buffering-freeze-and-return', key: 'loading' }].map(({ name, key }) => ({
    name, until: 7000, events: [...warm, { at: 3600, position: 13600, [key]: true }, { at: 5600, position: 13600, [key]: false }, { at: 6600, position: 14600 }],
    check(rows) {
      const frozen = rows.filter(row => row.at >= 3600 && row.at < 5600);
      if (frozen.some(row => row.visual !== frozen[0].visual)) throw Error('Clock advanced while hidden/buffering');
      const returned = rows.find(row => row.at === 5600);
      if (Math.abs(returned.visual - 13600) > 100) throw Error('Return accumulated unavailable wall time');
    }
  })),
  { name: 'small-native-negative-delta-is-real-seek', until: 4500, events: [...warm, { at: 3500, position: 12900 }, { at: 4500, position: 13900 }], check(rows) {
    const before = rows.find(row => row.at === 3480), moved = rows.find(row => row.at === 3500);
    if (Math.abs(moved.visual - 12900) > 1 || moved.raw !== 12900) throw Error('A legitimate -100ms native move was watermarked away');
    if (typeof before.epoch === 'number' && moved.epoch <= before.epoch) throw Error('Small native negative delta did not reset clockEpoch');
  } }
];

const results = cases.map(test => {
  let rows = [];
  try { rows = fixture().run(test.until, test.events); test.check(rows); console.log('PASS ' + test.name); return { name: test.name, pass: true, rows }; }
  catch (error) { console.log('FAIL ' + test.name + ': ' + error.message); return { name: test.name, pass: false, error: error.message, rows }; }
});
const report = { source: { bridge: options.bridge, view: options.view, bridgeSha256: hash(bridgeSource), viewSha256: hash(viewSource) }, note: 'Offline fixtures only; no client/network connection or real playback operations.', results };
if (options.report) fs.writeFileSync(options.report, JSON.stringify(report, null, 2));
console.log(`${results.filter(result => result.pass).length}/${results.length} cases passed.`);
if (results.some(result => !result.pass)) process.exitCode = 1;
