const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Offline contract fixtures: never connect to or change the real player's queue.
const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer', 'bridge.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const searches = [], histories = [], ranks = [], tagRequests = [], lyricRequests = [], actions = [], listeners = new Set();
  let collapseCount = 0, addEffect = () => {};
  const state = { playing: {}, 'page:vinylPage': { pageState: 'opened' }, playingList: { curPlayingList: [] } };
  const store = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch(action) {
      actions.push(action);
      return action.type === 'playing/play' ? addEffect(action) : Promise.resolve();
    }
  };
  const root = { _reactRootContainer: { _internalRoot: { current: { memoizedProps: { store } } } } };
  const document = {
    getElementById: id => id === 'root' ? root : null,
    querySelectorAll: () => [],
    querySelector: selector => selector.includes('tid_vinyl_unfold_btn') ? { click() { collapseCount++; } } : null,
    addEventListener() {}, removeEventListener() {}
  };
  function nativeApiModule() { return '/api/search/song/list/page /api/play-record/song/list /api/v1/play/record /api/star/song/filter/tag/list /api/song/lyric/v1'; }
  const loader = id => {
    if (!loader.c[id]) {
      const module = { exports: {} };
      loader.c[id] = module;
      loader.m[id](module, module.exports, loader);
    }
    return loader.c[id].exports;
  };
  loader.m = { 15: nativeApiModule };
  loader.c = { 15: { exports: { dg(query, options) {
    return new Promise((resolve, reject) => searches.push({ query, options, resolve, reject }));
  }, Ke(query, uid) {
    return new Promise((resolve, reject) => histories.push({ query, uid, resolve, reject }));
  }, Uh(query) {
    return new Promise((resolve, reject) => ranks.push({ query, resolve, reject }));
  }, lc(query) {
    return new Promise((resolve, reject) => tagRequests.push({ query, resolve, reject }));
  }, Gg(query) {
    return new Promise((resolve, reject) => lyricRequests.push({ query, resolve, reject }));
  } } } };
  const jsonp = [];
  jsonp.push = entry => {
    Array.prototype.push.call(jsonp, entry);
    Object.assign(loader.m, entry[1]);
    for (const [id] of entry[2]) loader(id);
  };
  const window = { document, console, AbortController, webpackJsonp: jsonp,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {} };
  for (const [name, marker] of Object.entries({dg:"/api/search/song/list/page",Ke:"/api/play-record/song/list",Uh:"/api/v1/play/record",lc:"/api/star/song/filter/tag/list",Gg:"/api/song/lyric/v1"})) {
    loader.c[15].exports[name].toString = () => "query => request(\"" + marker + "\", query)";
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/client-api.js"), "utf8") + "\n" + source, { window, console });
  return { bridge: window.NCMImmersiveBridge, searches, histories, ranks, tagRequests, lyricRequests, actions, state, loader, jsonp,
    collapseCount: () => collapseCount, setAddEffect(fn) { addEffect = fn; } };
}

function song(id, name = '同名歌曲') {
  return { id, name, artists: [{ name: '社团甲' }, { name: '歌手乙' }],
    album: { name: '专辑', picUrl: 'https://example.test/cover.jpg' }, duration: 216573,
    privilege: { maxPlayBr: 320000 }, noCopyrightRcmd: { type: 1, songId: '999' } };
}

(async () => {
  const f = fixture();
  const results = f.bridge.searchSongs('  歌名 社团  ');
  assert.equal(f.searches.length, 1);
  assert.equal(f.actions.length, 0, 'search cannot change navigation or playback');
  assert.deepEqual(plain(f.searches[0].query), { keyword: '歌名 社团', scene: 'normal', limit: 20, offset: 0, needCorrect: false, channel: 'suggest' });
  assert.equal(f.jsonp.length, 0, 'temporary webpack entry is removed');
  assert.deepEqual(Object.keys(f.loader.m), ['15']);
  assert.deepEqual(Object.keys(f.loader.c), ['15']);
  const credited = Object.assign(song('101'), {
    alias: ['東方星蓮船より “小さな小さな賢将”', ''],
    transNames: ['同名歌曲中文名', '東方星蓮船より “小さな小さな賢将”']
  });
  f.searches[0].resolve({ list: [credited, song('101'), song('102', '同名歌曲 (Live)'), song('invalid')] });
  assert.deepEqual(plain(await results), [
    { id: '101', title: '同名歌曲', aliases: ['東方星蓮船より “小さな小さな賢将”', '同名歌曲中文名'], artists: ['社团甲', '歌手乙'], album: '专辑', durationMs: 216573, coverUrl: 'https://example.test/cover.jpg' },
    { id: '102', title: '同名歌曲 (Live)', aliases: [], artists: ['社团甲', '歌手乙'], album: '专辑', durationMs: 216573, coverUrl: 'https://example.test/cover.jpg' }
  ]);
  assert.equal(f.actions.length, 0, 'different versions remain choices, never auto-enqueued');
  assert.deepEqual(plain(await f.bridge.enqueueSong('999')), { ok: false, error: '请先搜索并选择要加入的网易云版本' });
  assert.equal(f.actions.length, 0);
  assert.equal((await f.bridge.enqueueSong('101')).ok, false, 'a submitted effect without a confirmed queue update is not success');
  assert.equal(f.actions[0].type, 'playing/play');
  assert.deepEqual(plain(f.actions[0].payload.options), { play: false, clear: false, playId: '101' });
  assert.deepEqual(plain(f.actions[0].payload.tracks[0].privilege), { maxPlayBr: 320000 }, 'native availability data survives');
  assert.equal(f.actions[0].payload.tracks[0].noCopyrightRcmd, null, 'the selected version cannot be substituted');

  const releases = [];
  f.setAddEffect(action => new Promise(resolve => releases.push(() => {
    const track = action.payload.tracks[0];
    f.state.playingList.curPlayingList = [...f.state.playingList.curPlayingList.filter(item => item.track.id !== track.id), {track}];
    resolve();
  })));
  const first = f.bridge.enqueueSong('101'), second = f.bridge.enqueueSong('102');
  await flush();
  assert.equal(releases.length, 1, 'queue mutations are serialized');
  releases[0]();
  assert.equal((await first).confirmed, true);
  await flush();
  assert.equal(releases.length, 2);
  releases[1]();
  assert.equal((await second).ok, true);
  assert.deepEqual(f.state.playingList.curPlayingList.map(item => item.track.id), ['101', '102']);
  const actionCount = f.actions.length;
  const repeated = f.bridge.enqueueSong('101');
  await flush();
  assert.equal(f.actions.length, actionCount + 1, 'an explicit repeat still reaches native availability and queue handling');
  assert.equal(releases.length, 3);
  releases[2]();
  assert.equal((await repeated).alreadyQueued, true);
  assert.deepEqual(f.state.playingList.curPlayingList.map(item => item.track.id), ['102', '101'], 'the native mock owns deduplication and reinsertion order');
  f.setAddEffect(() => Promise.reject(Error('原生权限检查失败')));
  assert.match((await f.bridge.enqueueSong('101')).error, /原生权限检查失败/, 'existing membership cannot bypass a rejected native request');
  f.setAddEffect(action => {
    const track = action.payload.tracks[0];
    f.state.playingList.curPlayingList = [...f.state.playingList.curPlayingList.filter(item => item.track.id !== track.id), {track}];
    return Promise.resolve();
  });
  assert.equal((await f.bridge.enqueueSong('101')).ok, true, 'a failed repeat can be explicitly retried');
  assert.equal(f.actions.length, actionCount + 3);
  assert.ok(f.actions.every(action => action.type === 'playing/play' && action.payload.options.play === false && action.payload.options.clear === false), 'every request preserves playback and delegates queue mutation to the native effect');
  console.log('PASS native search choices, exact-version availability data and repeated serialized native queue requests');

  const aborted = new AbortController();
  const pending = f.bridge.searchSongs('取消', { signal: aborted.signal });
  aborted.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  f.searches.at(-1).resolve({ list: [song('103')] });
  await flush();
  assert.equal((await f.bridge.enqueueSong('103')).ok, false, 'an aborted result cannot become an enqueue choice');
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  const before = f.searches.length;
  await assert.rejects(f.bridge.searchSongs('取消', { signal: alreadyAborted.signal }), { name: 'AbortError' });
  assert.equal(f.searches.length, before);
  assert.deepEqual(plain(await f.bridge.searchSongs('  ')), []);
  await assert.rejects(f.bridge.searchSongs('字'.repeat(161)), /160/);
  const failed = f.bridge.searchSongs('网络失败');
  f.searches.at(-1).reject({ code: 405, msg: '原生搜索暂不可用' });
  await assert.rejects(failed, /原生搜索暂不可用/);
  const disposed = f.bridge.searchSongs('关闭桥接');
  f.bridge.dispose();
  await assert.rejects(disposed, { name: 'AbortError' });
  assert.equal((await f.bridge.enqueueSong('101')).ok, false);
  assert.equal((await f.bridge.openSearch('搜索')).ok, false);
  console.log('PASS cancellation, invalid queries, native errors and disposed pending work');

  const bounded = fixture();
  for (let page = 0; page < 10; page++) {
    const request = bounded.bridge.searchSongs('候选 ' + page);
    bounded.searches.at(-1).resolve({ list: Array.from({ length: 20 }, (_, index) => song(String(1000 + page * 20 + index))) });
    await request;
  }
  const refresh = bounded.bridge.searchSongs('再次找到早期歌曲');
  bounded.searches.at(-1).resolve({ list: [song('1000', '重新搜索的版本')] });
  await refresh;
  const newest = bounded.bridge.searchSongs('最新歌曲');
  bounded.searches.at(-1).resolve({ list: [song('1200')] });
  await newest;
  assert.equal((await bounded.bridge.enqueueSong('1001')).ok, false, 'the oldest unrefreshed choice expires above 200 entries');
  assert.equal(bounded.actions.length, 0, 'an expired choice cannot submit a queue action');
  bounded.setAddEffect(action => {
    bounded.state.playingList.curPlayingList.push({ track: action.payload.tracks[0] });
    return Promise.resolve();
  });
  assert.equal((await bounded.bridge.enqueueSong('1000')).ok, true, 'a repeated search refreshes the choice order');
  assert.equal(bounded.actions[0].payload.tracks[0].name, '重新搜索的版本');
  assert.equal((await bounded.bridge.enqueueSong('1200')).ok, true, 'the newest choice remains available');
  bounded.bridge.dispose();
  console.log('PASS bounded search choices, refreshed order and current-version enqueue');

  const navigation = fixture();
  const query = '幽闭星光 / A&B';
  assert.equal((await navigation.bridge.openSearch(query)).ok, true);
  assert.equal(navigation.collapseCount(), 1);
  assert.deepEqual(plain(navigation.actions[0]), { type: 'async:action/doAction', payload: { actionId: 'link', data: {
    to: { linkPath: '/searchResults/' + encodeURI(encodeURIComponent(query)), state: { channel: 'suggest', catagory: 1 } }, resource: {}, resourceType: 'unknown'
  } } });
  assert.equal((await navigation.bridge.openSearch('字'.repeat(161))).ok, false);
  navigation.bridge.dispose();
  const unsupported = fixture();
  unsupported.loader.m[15] = function unsupportedModule() {};
  await assert.rejects(unsupported.bridge.searchSongs('歌名'), /结构已变化/);
  assert.equal(unsupported.searches.length, 0);
  assert.equal(unsupported.jsonp.length, 0);
  unsupported.bridge.dispose();
  console.log('PASS native search navigation encoding and unsupported-client refusal');

  const history = fixture();
  const records = history.bridge.recentHistory();
  assert.deepEqual(plain(history.histories[0].query), { limit: 50, offset: 0 });
  history.histories[0].resolve([Object.assign(song('999'), { playtime: 1 }),
    ...Array.from({ length: 55 }, (_, i) => Object.assign(song(String(2000 + i)), { playtime: 100 + i })),
    Object.assign(song('2054'), { playtime: 154 })]);
  const recent = plain(await records);
  assert.equal(recent.length, 50);
  assert.equal(recent[0].id, '2054');
  assert.equal(new Set(recent.map(track => track.id)).size, 50);
  assert.ok(recent.every(track => !('playtime' in track) && !('uid' in track)));
  assert.deepEqual(history.actions, [], 'reading history never dispatches playback, queue or navigation changes');
  assert.equal(history.jsonp.length, 0);
  const controller = new AbortController();
  const canceledHistory = history.bridge.recentHistory({ signal: controller.signal });
  controller.abort();
  await assert.rejects(canceledHistory, { name: 'AbortError' });
  history.histories.at(-1).resolve([song('88')]);
  const disposedHistory = history.bridge.recentHistory(); history.bridge.dispose();
  await assert.rejects(disposedHistory, { name: 'AbortError' });
  console.log('PASS genuine recent-history transport, newest-first deduplication, privacy boundary, cancellation and zero player actions');

  const quiz = fixture();
  assert.equal(quiz.ranks.length + quiz.histories.length + quiz.tagRequests.length + quiz.lyricRequests.length, 0, 'new quiz APIs stay idle until explicitly invoked');
  const selection = quiz.bridge.characterHistory();
  await flush();
  assert.equal(quiz.ranks[0].query.type, 'all');
  quiz.ranks[0].resolve([
    {...song('701'), duration: 1000, playCount: 100, score: 100},
    {...song('702'), duration: 10000, playCount: 50, score: 1}, song('703')
  ]);
  quiz.histories[0].resolve([
    ...Array.from({length: 35}, (_, i) => ({...song(String(800 + i)), playtime: 1000 + i})),
    {...song('800'), playtime: 2000}
  ]);
  const selected = plain(await selection);
  assert.deepEqual(selected.topTracks.map(track => [track.id, track.estimatedListeningMs]), [['702', 500000], ['701', 100000]], 'estimated duration uses play counts and song length, never native score');
  assert.equal(selected.timeBasis, 'estimated');
  assert.equal(selected.recentTracks.length, 30); assert.equal(selected.recentTracks[0].id, '800');
  assert.equal(new Set(selected.recentTracks.map(track => track.id)).size, 30);
  assert.ok(selected.topTracks.every(track => !('score' in track) && !('uid' in track)));
  assert.equal(selected.warnings.length, 1, 'missing historical counts are reported instead of invented');
  const partial = quiz.bridge.characterHistory(); await flush();
  quiz.ranks.at(-1).reject(Error('rank unavailable')); quiz.histories.at(-1).resolve([{...song('800'), playtime: 2000}]);
  const available = await partial;
  assert.equal(available.topAvailable, false); assert.equal(available.recentAvailable, true);
  assert.equal(available.recentTracks.length, 1); assert.equal(available.warnings.length, 1);

  const tags = quiz.bridge.musicTags(selected.topTracks); await flush();
  assert.deepEqual(JSON.parse(quiz.tagRequests[0].query.trackIds), [{id: 702, at: 0}, {id: 701, at: 0}]);
  quiz.tagRequests[0].resolve({code: 200, data: {tagCategory: [{tagNames: ['未命中标签']}], tagTrackMapping: {'古典': [701], '摇滚': [702, 999], '未命中标签': []}}});
  assert.deepEqual(plain(await tags), {tagsById: {'701': ['古典'], '702': ['摇滚']}, warnings: []}, 'only per-song memberships count, not the global filter options');
  const info = quiz.bridge.songMusicInfo({id: '701'}); await flush();
  assert.equal(quiz.tagRequests.length, 1, 'per-song reads reuse the batch tags');
  quiz.lyricRequests[0].resolve({code: 200, lrc: {lyric: '[00:01]moon'}, tlyric: {lyric: '[00:01]月光'}});
  assert.deepEqual(plain(await info), {tags: ['古典'], lyrics: '[00:01]moon\n[00:01]月光', warnings: []});
  const failedLyric = quiz.bridge.songMusicInfo({id: '702'}, {tags: ['摇滚']}); await flush();
  quiz.lyricRequests.at(-1).reject(Error('lyric unavailable'));
  assert.deepEqual(plain(await failedLyric), {tags: ['摇滚'], lyrics: '', warnings: ['歌词读取失败']});
  const failedTags = quiz.bridge.musicTags([{id: '701'}]); await flush();
  quiz.tagRequests.at(-1).reject(Error('tags unavailable'));
  const tagFallback = plain(await failedTags);
  assert.deepEqual(tagFallback.tagsById, {'701': ['古典']}); assert.equal(tagFallback.warnings.length, 1);
  const cancelInfo = new AbortController();
  const pendingInfo = quiz.bridge.songMusicInfo({id: '702'}, {tags: [], signal: cancelInfo.signal}); await flush();
  cancelInfo.abort(); await assert.rejects(pendingInfo, {name: 'AbortError'});
  quiz.lyricRequests.at(-1).resolve({code: 200, noLyric: true});
  const closing = quiz.bridge.musicTags([{id: '703'}]); await flush(); quiz.bridge.dispose();
  await assert.rejects(closing, {name: 'AbortError'});
  quiz.tagRequests.at(-1).resolve({code: 200, data: {tagTrackMapping: {}}});
  assert.equal(quiz.actions.length, 0, 'history, tags and lyrics never dispatch playback, navigation or queue actions');
  assert.equal(quiz.jsonp.length, 0);
  console.log('PASS estimated top-30/recent-30 selection, partial failures, real tag membership, lyrics, bounded metadata reuse and quiz cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
