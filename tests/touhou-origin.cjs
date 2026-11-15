const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const source = ['touhou-names.js', 'touhou-origin.js'].map(name => fs.readFileSync(path.join(project, 'src/renderer', name), 'utf8')).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));

// Actual THBWiki responses read 2026-11-14, reduced to the relevant rows.
// https://thwiki.cc/album.php?m=st&v=SkyDrive&o=1&d=kv&l=10
const skySearch = { '1111887': ['SkyDrive!', 'Blooming Daydream the instrumental'], '1117689': ['SkyDrive!', 'Blooming Daydream'] };
// https://thwiki.cc/album.php?m=sa&v=Blooming%20Daydream&o=1&d=kv&l=5
const skyAlbums = { '92118': ['Blooming Daydream', 'Amateras Records'], '92716': ['Blooming Daydream the instrumental', 'Amateras Records'] };
// https://thwiki.cc/album.php?m=gt&i=1111887,1117689,1312676,1312681&p=name%20discno%20trackno%20circle%20artist%20ogmusic%20ogwork%20arrange%20vocal%20compose%20lyric&d=kv
const trackData = {
  '1111887': { name: ['SkyDrive!'], discno: [1], trackno: [1], circle: ['Amateras Records'], artist: ['Tracy'], ogmusic: ['デザイアドライブ'], ogwork: ['东方神灵庙'], arrange: ['Tracy'], vocal: '', compose: '', lyric: '' },
  '1117689': { name: ['SkyDrive!'], discno: [1], trackno: [1], circle: ['Amateras Records'], artist: ['築山さえ'], ogmusic: ['デザイアドライブ'], ogwork: ['东方神灵庙'], arrange: ['Tracy'], vocal: ['築山さえ'], compose: '', lyric: ['築山さえ'] },
  '1312676': { name: ['That Full Moon Over The Haunted Ship'], discno: [1], trackno: [4], circle: ['Alstroemeria Records'], artist: ['綾倉盟'], ogmusic: ['幽霊客船の時空を越えた旅', 'キャプテン・ムラサ'], ogwork: ['东方星莲船'], arrange: ['かめりあ'], vocal: ['綾倉盟'], compose: '', lyric: ['かめりあ'] },
  '1312681': { name: ['Lapse(ZYTOKINE REMIX)'], discno: [1], trackno: [9], circle: ['Alstroemeria Records'], artist: ['nachi'], ogmusic: ['Complete Darkness'], ogwork: ['东方封魔录'], arrange: ['Masayoshi Minoshima', '隣人'], vocal: ['nachi'], compose: '', lyric: ['かめりあ'] }
};
const skyTrack = { id: 'netease-1', title: 'SkyDrive!', album: 'Blooming Daydream', artists: ['築山さえ'] };

// Live action=ask response for [[曲目原曲::デザイアドライブ]], limit=2,
// read 2026-11-14. Page-valued printouts are reduced to their fulltext.
const semanticPage = title => ({ fulltext: title });
const relatedData = {
  '＃EAF4FC#2': { fulltext: '＃EAF4FC#2', printouts: {
    name: ['Mindache'], discno: [1], trackno: [2], circle: [semanticPage('IbEthics')],
    ogmusic: ['Desire Drive', '古老的元神'].map(semanticPage), ogwork: [semanticPage('东方神灵庙')],
    arrange: [semanticPage('どるふぃん')], vocal: [semanticPage('がむ')], dub: [], compose: [], lyric: [semanticPage('がむ')]
  } },
  '-80538738812075974³+80435758145817515³+12602123297335631³#3': {
    fulltext: '-80538738812075974³+80435758145817515³+12602123297335631³#3', printouts: {
      name: ['燦めく銀河の賜びと未知'], discno: [1], trackno: [3], circle: [semanticPage('.new label')],
      ogmusic: ['Desire Drive', '特洛伊群的密林', '妖精冒险谭', '天鸟船神社', '天鸟船神社的结界'].map(semanticPage),
      ogwork: [semanticPage('鸟船遗迹')], arrange: [semanticPage('askey')], vocal: [], dub: [], compose: [], lyric: []
    }
  }
};

// Live [[制作方::FELT]][[曲目名称::Goodbye]] rows, read 2026-11-14.
const goodbyeData = Object.fromEntries(['Parallel Cross', 'Rebirth Story4'].map((album, index) => [album + '#5', {
  fulltext: album + '#5', printouts: {
    name: ['Goodbye'], discno: [1], trackno: [5], circle: [semanticPage('FELT')],
    ogmusic: [semanticPage('小小的贤将')], ogwork: [semanticPage('东方星莲船')],
    arrange: [semanticPage('Maurits"禅"Cornelis')], vocal: ['Vivienne', index ? 'W.nova' : 'W.Nova'].map(semanticPage),
    dub: [], compose: [], lyric: [semanticPage('Renko')]
  }
}]));

function fixture(route, storage = new Map()) {
  const calls = [];
  const host = {
    console, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    async fetch(url, options) {
      const params = new URL(url).searchParams;
      calls.push({ params, options });
      assert.equal(options.credentials, 'omit');
      assert.equal(options.mode, 'cors');
      const result = await route(params, options);
      return { ok: true, status: 200, text: async () => typeof result === 'string' ? result : JSON.stringify(result) };
    }
  };
  vm.runInNewContext(source, { window: host, URLSearchParams, console });
  return { client: host.createTouhouOriginClient(), create: host.createTouhouOriginClient, host, calls, storage };
}

function standardRoute(params) {
  const mode = params.get('m');
  if (mode === 'st') return skySearch;
  if (mode === 'sa') return skyAlbums;
  if (mode === 'gt') return Object.fromEntries(params.get('i').split(',').filter(id => trackData[id]).map(id => [id, trackData[id]]));
  if (mode === 'ga') return [{ alname: ['Blooming Daydream'], circle: ['Amateras Records'] }, { '1117689': trackData['1117689'] }];
  throw Error('Unexpected API mode');
}

async function offline() {
  const f = fixture(standardRoute);
  assert.equal(f.calls.length, 0, 'creating the client must not request anything');
  assert.equal(f.client.getSaved(skyTrack.id), null);
  const candidates = await f.client.search(skyTrack);
  assert.equal(candidates.length, 2, 'same title in an instrumental album remains a separate choice');
  assert.equal(candidates[0].id, '1117689');
  assert.deepEqual(plain(candidates[0].match), { title: 'exact', album: 'exact', artist: 'exact' });
  assert.equal(f.client.getSaved(skyTrack.id), null, 'a strong metadata match is not user confirmation');
  assert.equal(f.calls.length, 4);
  const detail = await f.client.detail(candidates[0]);
  assert.deepEqual(plain(detail.originals), ['デザイアドライブ']);
  assert.deepEqual(plain(detail.vocalists), ['築山さえ']);
  assert.deepEqual(plain(detail.works), ['东方神灵庙']);
  assert.deepEqual(plain(detail.circles), ['Amateras Records']);
  assert.equal(detail.sourceUrl, 'https://thwiki.cc/Blooming_Daydream');
  assert.match(detail.apiUrl, /^https:\/\/thwiki\.cc\/album\.php\?/);
  assert.equal(f.calls.length, 4, 'details from a search are reused');
  const confirmed = f.client.save(skyTrack.id, detail);
  assert.equal(typeof confirmed.confirmedAt, 'number');
  const restored = f.create();
  assert.equal(restored.getSaved(skyTrack.id).id, detail.id);
  const copy = restored.getSaved(skyTrack.id);
  copy.originals.push('not real');
  assert.equal(restored.getSaved(skyTrack.id).originals.length, 1);
  restored.forget(skyTrack.id);
  assert.equal(restored.getSaved(skyTrack.id), null);
  assert.equal(f.create().getSaved(skyTrack.id), null);
  f.client.dispose(); restored.dispose();
  console.log('PASS real API shapes, album/artist ranking, explicit confirmation and persistence');

  const multi = fixture(standardRoute);
  const moon = await multi.client.detail({ id: '1312676', title: 'That Full Moon Over The Haunted Ship', album: 'POP｜CULTURE 5' });
  assert.deepEqual(plain(moon.originals), ['幽霊客船の時空を越えた旅', 'キャプテン・ムラサ']);
  assert.deepEqual(plain(moon.works), ['东方星莲船']);
  assert.deepEqual(plain(moon.composers), []);
  const lapse = await multi.client.detail({ id: '1312681', title: 'Lapse(ZYTOKINE REMIX)', album: 'POP｜CULTURE 5' });
  assert.deepEqual(plain(lapse.arrangers), ['Masayoshi Minoshima', '隣人']);
  multi.client.dispose();
  console.log('PASS multiple original themes, multiple arrangers and empty credit fields');

  // A title search may omit the correct album among its first 30 rows.
  const supplement = fixture(params => params.get('m') === 'st' ? { '1111887': skySearch['1111887'] } : standardRoute(params));
  const supplemented = await supplement.client.search(skyTrack);
  assert.equal(supplemented[0].id, '1117689');
  supplement.client.dispose();
  const manual = fixture(standardRoute);
  assert.equal((await manual.client.search(skyTrack, { query: 'SkyDrive' })).length, 2);
  assert.deepEqual(manual.calls.map(call => call.params.get('m')), ['st', 'gt']);
  const before = manual.calls.length;
  await manual.client.search(skyTrack, { query: 'SkyDrive' });
  assert.equal(manual.calls.length, before, 'bounded TTL cache avoids repeated requests');
  manual.client.dispose();
  const empty = fixture(() => []);
  assert.deepEqual(plain(await empty.client.search({ title: 'zzz9373518nomusicexample' })), []);
  assert.equal(empty.calls.length, 1);
  empty.client.dispose();
  console.log('PASS album supplementation, bounded manual search and genuine empty response');

  const butterfly = '螺旋を描く蝶';
  const annotated = butterfly + ' [Vocal：憐歌]';
  const versions = Object.fromEntries([butterfly, butterfly + '（3話エンディングテーマ・オフボーカル）', butterfly + ' (Short Version)']
    .map((title, index) => [String(201 + index), { name: [title], circle: ['舞風'], artist: ['憐歌'] }]));
  versions['202'].artist = ['時音'];
  versions['204'] = {name: ['別の曲'], circle: ['舞風'], artist: ['憐歌']};
  const annotatedSearch = fixture(params => {
    if (params.get('m') === 'st') return params.get('v') === butterfly
      ? Object.fromEntries(Object.entries(versions).filter(([id]) => id !== '204').map(([id, row]) => [id, [row.name[0], id === '201' ? '別の盤' : '東方夢想夏郷 3']]))
      : params.get('v') === '別の曲' ? {'204': ['別の曲', '東方夢想夏郷 3']} : [];
    if (params.get('m') === 'gt') return versions;
    throw Error('manual queries must not search the current album');
  });
  const current = {title: annotated, album: '東方夢想夏郷 3', artists: ['舞風']};
  const found = await annotatedSearch.client.search(current, {query: annotated});
  assert.deepEqual(annotatedSearch.calls.filter(call => call.params.get('m') === 'st').map(call => call.params.get('v')), [annotated, butterfly]);
  assert.equal(found[0].id, '201', 'an exact title from another album outranks the instrumental or short version from the current album');
  assert.equal(found[0].match.title, 'exact', 'a vocal credit is metadata, not a different song title');
  assert.deepEqual(plain(found.find(row => row.id === '202').match), {title: 'main', version: 'different', album: 'exact', artist: 'none'}, 'missing vocalist credits never hide a candidate');
  assert.equal(found.find(row => row.id === '203').match.title, 'main', 'a short version keeps its edition distinction');
  assert.equal(found[1].id, '203', 'the explicit vocalist improves ranking among otherwise equal edition matches');
  const other = await annotatedSearch.client.search(current, {query: '別の曲 [Vocal：憐歌]'});
  assert.equal(other[0].match.title, 'exact', 'manual title evidence compares against the query rather than the playing song');
  const queries = annotatedSearch.calls.filter(call => call.params.get('m') === 'st').map(call => call.params.get('v'));
  assert.deepEqual(queries.slice(-2), ['別の曲 [Vocal：憐歌]', '別の曲'], 'fallback follows the manual query rather than the playing song');
  const beforeVersionSearch = annotatedSearch.calls.length;
  await annotatedSearch.client.search(current, {query: butterfly + ' (Off Vocal)'});
  assert.equal(annotatedSearch.calls.length, beforeVersionSearch + 1, 'an explicit version query is never broadened to the base title');
  annotatedSearch.client.dispose();
  console.log('PASS vocal-credit fallback preserves manual queries and identifies instrumental/short editions');

  const related = fixture(params => {
    assert.equal(params.get('action'), 'ask');
    assert.equal(params.get('origin'), '*');
    assert.equal(params.get('format'), 'json');
    assert.match(params.get('query'), /^\[\[曲目原曲::デザイアドライブ\]\]\|\?曲目名称=name\|/);
    assert.match(params.get('query'), /\|limit=12\|offset=\d+$/);
    return params.get('query').endsWith('offset=0')
      ? { query: { results: relatedData }, 'query-continue-offset': 2 }
      : { query: { results: [] } };
  });
  assert.equal(related.calls.length, 0, 'related arrangements load only on request');
  const firstPage = await related.client.related('デザイアドライブ');
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.items[0].title, 'Mindache', 'arrangements are found by original relationship, not title similarity');
  assert.equal(firstPage.items[0].id, '＃EAF4FC#2');
  assert.equal(firstPage.items[0].album, '＃EAF4FC');
  assert.deepEqual(plain(firstPage.items[0].circles), ['IbEthics']);
  assert.deepEqual(plain(firstPage.items[0].originals), ['Desire Drive', '古老的元神'], 'canonical original names and medleys are preserved');
  assert.deepEqual(plain(firstPage.items[0].artists), ['がむ']);
  assert.deepEqual(plain(firstPage.items[1].artists), ['askey'], 'instrumental tracks use the arranger credit');
  assert.equal(firstPage.items[0].discNumber, '1');
  assert.equal(firstPage.items[0].trackNumber, '2');
  assert.equal(firstPage.items[0].sourceUrl, 'https://thwiki.cc/%EF%BC%83EAF4FC');
  assert.match(firstPage.items[0].apiUrl, /^https:\/\/thwiki\.cc\/api\.php\?/);
  assert.equal(firstPage.source, 'THBWiki');
  assert.equal(firstPage.scope, '原曲关系');
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextOffset, 2, 'use the API cursor rather than inventing the next page');
  firstPage.items[0].originals.push('not real');
  assert.equal((await related.client.related('デザイアドライブ')).items[0].originals.length, 2);
  assert.equal(related.calls.length, 1, 'related requests reuse the bounded response cache');
  const lastPage = await related.client.related('デザイアドライブ', { offset: firstPage.nextOffset });
  assert.deepEqual(plain(lastPage.items), []);
  assert.equal(lastPage.hasMore, false);
  assert.equal(lastPage.nextOffset, null);
  await assert.rejects(related.client.related('デザイアドライブ]]|limit=1000'), /原曲名称/);
  await assert.rejects(related.client.related('デザイアドライブ', { offset: -1 }), /分页位置/);
  assert.equal(related.calls.length, 2, 'invalid semantic input must not reach the API');
  related.client.dispose();
  const invalidRelated = fixture(() => ({ query: { results: { 'album#1': { fulltext: 'album#1', printouts: { name: ['bad shape'] } } } } }));
  await assert.rejects(invalidRelated.client.related('デザイアドライブ'), /同原曲资料格式已变化/);
  invalidRelated.client.dispose();
  console.log('PASS exact original relationships, semantic metadata, source links, cached pagination and visible schema failures');

  let fail = true;
  const retry = fixture(params => { if (fail) throw Error('Failed to fetch'); return params.get('m') === 'st' ? [] : standardRoute(params); });
  await assert.rejects(retry.client.search({ title: 'SkyDrive' }), /THBWiki 查询失败.*重试/);
  fail = false;
  assert.equal((await retry.client.search({ title: 'SkyDrive' })).length, 0);
  assert.equal(retry.calls.length, 2, 'a failure must not poison the retry cache');
  retry.client.dispose();
  const stale = fixture(() => 'Tracks not exist, view <a href="https://thwiki.cc/albumapi">https://thwiki.cc/albumapi</a> for more information');
  await assert.rejects(stale.client.detail({ id: '999999999999', title: 'SkyDrive!', album: 'Blooming Daydream' }), /编号可能已更新.*重新搜索/);
  stale.client.dispose();
  const malformed = fixture(() => '<html>maintenance</html>');
  await assert.rejects(malformed.client.search({ title: 'SkyDrive' }), /无法解析/);
  malformed.client.dispose();
  console.log('PASS visible network errors, retries, stale IDs and non-JSON responses');

  const abortable = fixture((params, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const controller = new AbortController();
  const canceled = abortable.client.search(skyTrack, { signal: controller.signal });
  controller.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  const closing = abortable.client.search(skyTrack);
  abortable.client.dispose();
  await assert.rejects(closing, { name: 'AbortError' });
  await assert.rejects(abortable.client.search(skyTrack), { name: 'AbortError' });
  const abortRelated = fixture((params, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const relatedController = new AbortController();
  const canceledRelated = abortRelated.client.related('デザイアドライブ', { signal: relatedController.signal });
  relatedController.abort();
  await assert.rejects(canceledRelated, { name: 'AbortError' });
  abortRelated.client.dispose();
  await assert.rejects(abortRelated.client.related('デザイアドライブ'), { name: 'AbortError' });
  console.log('PASS cancellation, queued request disposal and no requests after disposal');

  const bounds = fixture(standardRoute);
  for (let i = 0; i < 205; i++) bounds.client.save(String(i), detail);
  assert.equal(bounds.client.getSaved('0'), null);
  assert.equal(bounds.client.getSaved('204').id, detail.id);
  bounds.host.localStorage.setItem = () => { throw Error('QuotaExceededError'); };
  assert.throws(() => bounds.client.save('new', detail), /无法保存/);
  assert.equal(bounds.client.getSaved('new'), null);
  bounds.client.dispose();
  console.log('PASS saved mapping limit and atomic storage failure');
  await queuedCancellation();
  await circleOffline();
}

async function queuedCancellation() {
  const f = fixture((params, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), {name: 'AbortError'})), {once: true});
  }));
  const timers = new Map();
  let timerId = 0;
  f.host.setTimeout = (callback, delay) => {const id = ++timerId; timers.set(id, {callback, delay}); return id;};
  f.host.clearTimeout = id => timers.delete(id);
  const first = f.client.related('原曲甲');
  const firstRejected = assert.rejects(first, {name: 'AbortError'});
  const controller = new AbortController();
  let settled = false;
  const queued = f.client.related('原曲乙', {signal: controller.signal});
  const queuedRejected = assert.rejects(queued, {name: 'AbortError'}).then(() => {settled = true;});
  try {
    assert.equal(f.calls.length, 1, 'the second request is still waiting for the request interval');
    controller.abort();
    for (let index = 0; index < 8; index++) await Promise.resolve();
    assert.equal(settled, true, 'a canceled queued request rejects before another network slot or timer is available');
    assert.equal(f.calls.length, 1, 'a canceled queued request never reaches the transport');
  } finally {
    f.client.dispose();
    await Promise.all([firstRejected, queuedRejected]);
  }
  console.log('PASS canceled queued requests reject and release immediately without transport access');
}

async function circleOffline() {
  const ids = ['1333486', '1395788'];
  const searchData = { '1': ['Goodbye', 'Other album'], ...Object.fromEntries(ids.map((id, index) => [id, ['Goodbye', index ? 'Rebirth Story4' : 'Parallel Cross']])) };
  const attrs = Object.fromEntries(ids.map((id, index) => {
    const printouts = Object.values(goodbyeData)[index].printouts;
    const row = Object.fromEntries(Object.entries(printouts).map(([key, entries]) => [key, entries.map(entry => typeof entry === 'object' ? entry.fulltext : entry)]));
    return [id, { ...row, artist: row.vocal }];
  }));
  attrs['1'] = { ...attrs[ids[0]], circle: ['FELT tribute'], artist: ['FELT'] };
  const wideSearch = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [String(2000 + index), ['Song ' + index, 'Wide album']]));
  Object.keys(wideSearch).forEach(id => { attrs[id] = { ...attrs[ids[0]], name: [wideSearch[id][0]] }; });
  const f = fixture(params => {
    if (params.get('m') === 'st') {
      assert.equal(params.get('l'), '30');
      assert.equal(params.has('offset'), false, 'album.php st does not support a server-side offset');
      const query = params.get('v');
      return query.toLowerCase() === 'goodbye' ? searchData : query === 'wide' ? wideSearch : [];
    }
    if (params.get('m') === 'gt') return Object.fromEntries(params.get('i').split(',').map(id => [id, attrs[id]]));
    assert.equal(params.get('action'), 'ask');
    assert.equal(params.get('origin'), '*');
    assert.equal(params.get('format'), 'json');
    const query = params.get('query');
    assert.match(query, /\|limit=12\|offset=\d+$/);
    assert.ok(query.startsWith('[[制作方::発熱巫女～ず]][[曲目名称::+]]'));
    if (query.endsWith('offset=12')) return { query: { results: [] } };
    const original = plain(goodbyeData['Parallel Cross#5']);
    original.fulltext = 'Original album#1';
    original.printouts.name = ['Original song'];
    original.printouts.circle = [semanticPage('発熱巫女～ず')];
    original.printouts.ogmusic = [];
    return { query: { results: { [original.fulltext]: original } }, 'query-continue-offset': 12 };
  });
  assert.equal(f.calls.length, 0);
  const missing = await f.client.circleTracks('発熱巫女～ず', { query: 'Goodbye' });
  assert.deepEqual(plain(missing.items), [], 'Goodbye belongs to FELT, not 発熱巫女～ず');
  const page = await f.client.circleTracks('FELT', { query: 'Goodbye' });
  assert.equal(page.items.length, 2, 'a similar circle name or artist name is not a circle relationship');
  assert.deepEqual(plain(page.items.map(row => row.album)), ['Parallel Cross', 'Rebirth Story4']);
  assert.ok(page.items.every(row => row.artists.includes('Vivienne')));
  assert.deepEqual(plain(page.items[0].vocalists), ['Vivienne', 'W.Nova']);
  assert.deepEqual(plain(page.items[0].originals), ['小小的贤将']);
  assert.deepEqual(plain(page.items[0].arrangers), ['Maurits"禅"Cornelis']);
  assert.deepEqual(plain(page.items[0].lyricists), ['Renko']);
  assert.equal(page.items[0].discNumber, '1');
  assert.equal(page.items[0].trackNumber, '5');
  assert.equal(page.items[0].sourceUrl, 'https://thwiki.cc/Parallel_Cross');
  assert.match(page.items[0].apiUrl, /^https:\/\/thwiki\.cc\/album\.php\?/);
  assert.equal(page.circle, 'FELT');
  assert.equal(page.query, 'Goodbye');
  assert.equal(page.source, 'THBWiki');
  assert.equal(page.scope, '社团关系');
  assert.equal(page.hasMore, false);
  assert.equal(page.nextOffset, null);
  assert.equal(page.searchLimited, false);
  page.items[0].artists.push('not real');
  assert.deepEqual(plain((await f.client.circleTracks('FELT', { query: 'Goodbye' })).items[0].artists), ['Vivienne', 'W.Nova']);
  assert.equal(f.calls.length, 2, 'circle requests reuse the bounded cache and return independent results');
  for (const query of ['goodbye', 'GOODBYE']) {
    const result = await f.client.circleTracks('FELT', { query });
    assert.deepEqual(plain(result.items.map(row => row.id)), ids, 'title search is independent of letter case');
  }
  const wide = await f.client.circleTracks('FELT', { query: 'wide' });
  assert.equal(wide.items.length, 12);
  assert.equal(wide.searchLimited, true, 'reaching the API cap is visible without inventing a global continuation');
  assert.equal(wide.nextOffset, 12);
  const second = await f.client.circleTracks('FELT', { query: 'wide', offset: wide.nextOffset });
  assert.equal(second.items.length, 12);
  assert.ok(second.items.every(row => !wide.items.some(previous => previous.id === row.id)));
  const last = await f.client.circleTracks('FELT', { query: 'wide', offset: second.nextOffset });
  assert.equal(last.items.length, 6);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, null);
  const catalogue = await f.client.circleTracks('発熱巫女～ず');
  assert.deepEqual(plain(catalogue.items[0].originals), [], 'original songs without an original-theme relation are valid catalogue entries');
  assert.equal(catalogue.searchLimited, false);
  assert.equal(catalogue.nextOffset, 12);
  assert.ok(f.calls.at(-1).params.get('query').startsWith('[[制作方::発熱巫女～ず]][[曲目名称::+]]'), 'catalogues exclude album pages without a track title');
  const next = await f.client.circleTracks('発熱巫女～ず', { offset: catalogue.nextOffset });
  assert.deepEqual(plain(next.items), []);
  assert.equal(next.hasMore, false);
  for (const query of ['桜花ノ下', 'All For Me', "I'm the Wind", 'Say "Hello"', ']][[制作方::FELT|limit=1000']) {
    await f.client.circleTracks('発熱巫女～ず', { query });
    assert.equal(f.calls.at(-1).params.get('v'), query, 'title input remains a URL parameter and cannot inject SMW conditions');
    assert.equal(f.calls.at(-1).params.has('query'), false);
  }
  const calls = f.calls.length;
  for (const circle of ['', 'FELT]]|limit=1000', '~FELT', 'FELT||発熱巫女～ず']) await assert.rejects(f.client.circleTracks(circle), /社团名称/);
  await assert.rejects(f.client.circleTracks('FELT', { query: 'x'.repeat(161) }), /曲名/);
  await assert.rejects(f.client.circleTracks('FELT', { query: 'Good\nbye' }), /曲名/);
  await assert.rejects(f.client.circleTracks('FELT', { offset: -1 }), /分页位置/);
  assert.equal(f.calls.length, calls, 'invalid SMW syntax never reaches the API');
  f.client.dispose();
  const badCursor = fixture(() => ({ query: { results: [] }, 'query-continue-offset': 0 }));
  await assert.rejects(badCursor.client.circleTracks('FELT'), /分页资料已变化/);
  badCursor.client.dispose();
  const abortable = fixture((params, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const controller = new AbortController();
  const canceled = abortable.client.circleTracks('FELT', { signal: controller.signal });
  controller.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  abortable.client.dispose();
  await assert.rejects(abortable.client.circleTracks('FELT'), { name: 'AbortError' });
  console.log('PASS circle relationships, title case, full credits, search cap, cached pagination and cancellation');
}

async function circleLive() {
  const host = { fetch, AbortController, setTimeout, clearTimeout, console, localStorage: { getItem: () => null } };
  vm.runInNewContext(source, { window: host, URLSearchParams, console });
  const client = host.createTouhouOriginClient();
  try {
    const missing = await client.circleTracks('発熱巫女～ず', { query: 'Goodbye' });
    assert.equal(missing.items.length, 0);
    const goodbye = await client.circleTracks('FELT', { query: 'Goodbye' });
    assert.equal(goodbye.items.length, 5);
    assert.ok(goodbye.items.every(row => row.circles.includes('FELT') && row.title.includes('Goodbye')));
    const exact = goodbye.items.filter(row => row.title === 'Goodbye');
    assert.deepEqual(plain(exact.map(row => row.album)), ['Parallel Cross', 'Rebirth Story4']);
    assert.ok(exact.every(row => row.artists.includes('Vivienne') && row.originals.includes('小小的贤将')));
    for (const query of ['goodbye', 'GOODBYE']) {
      const page = await client.circleTracks('FELT', { query });
      assert.deepEqual(plain(page.items.map(row => row.id)), plain(goodbye.items.map(row => row.id)));
    }
    const catalogue = await client.circleTracks('発熱巫女～ず');
    assert.equal(catalogue.items.length, 12);
    assert.equal(catalogue.nextOffset, 12);
    assert.ok(catalogue.items.every(row => row.circles.includes('発熱巫女～ず') && row.title));
    const next = await client.circleTracks('発熱巫女～ず', { offset: catalogue.nextOffset });
    assert.equal(next.items.length, 12);
    assert.ok(next.items.every(row => !catalogue.items.some(previous => previous.id === row.id)));
    for (const query of ['桜花ノ下', 'All For Me', "I'm the Wind"]) {
      const page = await client.circleTracks('発熱巫女～ず', { query });
      assert.ok(page.items.length > 0);
      assert.ok(page.items.every(row => row.circles.includes('発熱巫女～ず') && row.title.includes(query)));
    }
    const quoted = await client.circleTracks('GET IN THE RING', { query: '"Reunion"' });
    assert.ok(quoted.items.length > 0);
    assert.ok(quoted.items.every(row => row.circles.includes('GET IN THE RING')));
    assert.ok(quoted.items.some(row => row.title.includes('"Reunion"')));
    console.log('PASS live THBWiki circle catalogue and title filters', JSON.stringify({ missing: missing.items.length,
      goodbye: goodbye.items.map(row => ({ title: row.title, album: row.album, circles: row.circles, artists: row.artists })),
      catalogue: { count: catalogue.items.length, nextOffset: catalogue.nextOffset, nextCount: next.items.length, first: catalogue.items[0].title } }));
  } finally { client.dispose(); }
}

async function live() {
  const host = { fetch, AbortController, setTimeout, clearTimeout, console, localStorage: { getItem: () => null } };
  vm.runInNewContext(source, { window: host, URLSearchParams, console });
  const client = host.createTouhouOriginClient();
  try {
    const candidates = await client.search(skyTrack);
    const chosen = candidates.find(row => row.title === 'SkyDrive!' && row.album === 'Blooming Daydream');
    assert.ok(chosen);
    const detail = await client.detail(chosen);
    assert.ok(detail.originals.includes('デザイアドライブ'));
    assert.ok(detail.works.includes('东方神灵庙'));
    const arrangements = await client.related(detail.originals[0]);
    assert.equal(arrangements.items.length, 12);
    assert.equal(arrangements.hasMore, true);
    assert.equal(arrangements.nextOffset, 12);
    assert.ok(arrangements.items.every(row => row.originals.includes('Desire Drive')));
    assert.ok(new Set(arrangements.items.flatMap(row => row.circles)).size > 1);
    const next = await client.related(detail.originals[0], { offset: arrangements.nextOffset });
    assert.ok(next.items.length > 0 && next.items.length <= 12);
    assert.ok(next.items.every(row => !arrangements.items.some(previous => previous.id === row.id)));
    console.log('PASS live THBWiki search/detail and related arrangement pagination', JSON.stringify({ candidates: candidates.length, detail, arrangements: arrangements.items.map(row => ({ title: row.title, album: row.album, circles: row.circles })), nextOffset: next.nextOffset }));
  } finally { client.dispose(); }
}

(process.argv.includes('--queued-cancel') ? queuedCancellation() : process.argv.includes('--circle-live') ? circleLive() : process.argv.includes('--circle') ? circleOffline() : process.argv.includes('--live') ? live() : offline()).catch(error => { console.error(error); process.exitCode = 1; });
