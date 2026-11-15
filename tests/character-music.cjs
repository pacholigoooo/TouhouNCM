const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const window = {};
const context = vm.createContext({window});
for (const file of ['touhou-names.js', 'character-music.js', 'character-quiz.js']) vm.runInContext(fs.readFileSync(path.join(project, 'src/renderer', file), 'utf8'), context);
const music = window.NcmCharacterMusic, engine = window.NcmCharacterQuiz;
const neutral = {bright: .3, calm: .3, emotional: .3, dark: .3, energetic: .3, dream: .3, traditional: .3, electronic: .3, motifs: []};
window.NcmCharacterAffinities = {
  '舒缓角色': {...neutral, calm: .95, energetic: .15, motifs: ['moon']},
  '高能角色': {...neutral, calm: .15, energetic: .95, electronic: .95},
  '梦境角色': {...neutral, dream: .95, motifs: ['dream', 'star']}
};
const track = (id, extra = {}) => ({id, title: 'Untitled', artists: ['Other Artist'], album: 'Record', aliases: [], ...extra});
const a = track('1', {estimatedListeningMs: 6000}), b = track('2', {estimatedListeningMs: 1000, recentAt: 500}), c = track('3', {recentAt: 300});
const history = {topTracks: [a, b, {...a, estimatedListeningMs: 500}], recentTracks: [b, c, {...b, recentAt: 100}], timeBasis: 'estimated', topTotal: 100, warnings: []};
const selected = music.select(history);
assert.equal(selected.topCount, 2); assert.equal(selected.recentCount, 2); assert.equal(selected.overlapCount, 1);
assert.deepEqual(Array.from(selected.tracks, row => [row.track.id, row.weight]), [['1', .25], ['2', .5], ['3', .25]]);
assert.equal(selected.tracks[0].track.estimatedListeningMs, 6000, 'a later duplicate cannot replace the highest estimated duration');
assert.equal(selected.tracks[1].track.recentAt, 500, 'a later duplicate cannot replace the most recent timestamp');
assert.equal(selected.tracks.reduce((sum, row) => sum + row.weight, 0), 1);
assert.equal(music.select({recentTracks: [a, b]}).tracks[0].weight, .5, 'an available single group retains all sample weight');
const unknown = music.features(track('0'));
assert.equal(unknown.informative, false); assert.equal(music.compatibility(unknown, neutral), .5);
assert.equal(music.describe([{weight: 1, features: unknown}], '舒缓角色', window.NcmCharacterAffinities['舒缓角色']), '', 'no cues means no invented personality description');
const descriptiveRows = [{weight: 1, features: music.features(track('4'), {tags: ['钢琴'], lyrics: 'moon'})}];
const summary = music.describe(descriptiveRows, '舒缓角色', window.NcmCharacterAffinities['舒缓角色']);
assert.ok(summary.startsWith('从这些歌看，你')); assert.ok(summary.includes('你与舒缓角色相似的是')); assert.ok(summary.includes('重视自己的步调'));
assert.equal(music.describe(descriptiveRows, '舒缓角色', window.NcmCharacterAffinities['舒缓角色']), summary, 'the same evidence always produces the same description');
console.log('PASS top/recent deduplication preserves best records, groups split equally and overlap weights accumulate');

(async () => {
  let tagsCalls = 0, active = 0, maximum = 0;
  const infoIds = [];
  const bridge = {
    async musicTags(tracks) { tagsCalls++; assert.equal(tracks.length, 3); return {tagsById: {'1': ['钢琴'], '2': ['摇滚', '电子'], '3': []}, warnings: []}; },
    async songMusicInfo(song, options) {
      maximum = Math.max(maximum, ++active); infoIds.push(song.id);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return {tags: options.tags, lyrics: song.id === '1' ? '[00:01]PRIVATE_LYRIC_SENTINEL moon' : '', warnings: []};
    }
  };
  const client = {getSaved() { return null; }, search() { throw Error('ordinary songs must not be sent to THBWiki'); }};
  const result = await engine.analyze(history, bridge, client, {online: true});
  assert.equal(tagsCalls, 1); assert.equal(maximum, 2); assert.equal(infoIds.length, 3);
  assert.equal(result.version, 3); assert.equal(result.readCount, 3); assert.equal(result.recognizedCount, 2);
  assert.deepEqual(plain(result.sample), {topCount: 2, recentCount: 2, overlapCount: 1, timeBasis: 'estimated', topTotal: 100});
  assert.equal(result.ranking.length, 3, 'non-Touhou songs produce a result from actual music cues');
  assert.ok(result.ranking.some(row => row.summary));
  assert.ok(result.ranking.slice(0, 3).every(row => Array.from(row.summary).length <= 110));
  assert.ok(result.ranking.every(row => row.percentage >= 0 && row.percentage <= 100));
  assert.ok(result.ranking.reduce((sum, row) => sum + row.percentage, 0) > 100, 'compatibility percentages are independent, not a share of character points');
  assert.ok(result.rows[0].matches.every(row => row.kind === 'music'));
  assert.equal(result.rows[2].matches.length, 0, 'a neutral song remains in the sample without invented evidence');
  assert.equal(JSON.stringify(result).includes('PRIVATE_LYRIC_SENTINEL'), false, 'results never retain full lyrics');
  for (const item of result.ranking) {
    const expected = result.rows.reduce((sum, row) => sum + row.weight * music.compatibility(row.features, window.NcmCharacterAffinities[item.character]), 0);
    assert.equal(item.score, expected, 'every song contributes its weight, including neutral songs');
  }
  window.NcmCharacterAffinities['新角色'] = {...neutral, calm: .8};
  const rescored = engine.rescore({...result, ranking: result.ranking.map(({summary, ...row}) => row)});
  assert.ok(rescored.ranking.some(row => row.character === '新角色'));
  assert.ok(rescored.ranking.slice(0, 3).some(row => row.summary), 'older v3 results gain descriptions when rescored');
  assert.throws(() => engine.rescore({version: 2, rows: result.rows}), /重新测试/);
  console.log('PASS two-worker metadata reads, non-Touhou matching, independent compatibility, neutral songs and lyric privacy');

  const single = {recentTracks: [track('10')], timeBasis: 'estimated'};
  const neutralBridge = {async musicTags() { return {tagsById: {}, warnings: []}; }, async songMusicInfo() { return {tags: [], lyrics: '', warnings: []}; }};
  const empty = await engine.analyze(single, neutralBridge, client);
  assert.deepEqual(plain(empty.ranking), []); assert.deepEqual(plain(empty.rows[0].matches), []);
  const tagged = {...neutralBridge, async songMusicInfo() { return {tags: ['钢琴'], lyrics: '', warnings: []}; }};
  const withOriginal = original => ({getSaved() { return {originals: [original], sourceUrl: 'https://thwiki.cc/Album'}; }});
  const first = await engine.analyze(single, tagged, withOriginal('恋色マスタースパーク'));
  const second = await engine.analyze(single, tagged, withOriginal('守旧老爹与前卫少女'));
  assert.deepEqual(plain(first.ranking), plain(second.ranking), 'changing the Touhou original never changes the music score');
  const annotated = await engine.analyze({recentTracks: [track('10', {title: 'Untitled（原曲：恋色マスタースパーク）'})]}, tagged, client);
  assert.deepEqual(plain(first.ranking), plain(annotated.ranking), 'an original-title annotation is metadata, not a lyric or title cue');
  assert.equal(first.rows[0].originals[0], '恋色マスタースパーク', 'original metadata remains available for inspection');
  let searches = 0;
  await engine.analyze({recentTracks: [track('11'), track('12', {artists: ['FELT']})]}, neutralBridge, {getSaved() { return null; }, async search(song) { searches++; assert.equal(song.id, '12'); return []; }}, {online: true});
  assert.equal(searches, 1, 'only an explicit Touhou cue or known circle can trigger an optional THB query');
  console.log('PASS no forced result without cues, original metadata has zero score effect and ordinary songs never query THBWiki');

  const controller = new AbortController(), calls = [];
  const pendingBridge = {...neutralBridge, songMusicInfo(song, {signal}) {
    calls.push(song.id);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { const error = Error('canceled'); error.name = 'AbortError'; reject(error); }, {once: true}));
  }};
  const pending = engine.analyze(history, pendingBridge, client, {signal: controller.signal});
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(calls.length, 2); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'}); assert.equal(calls.length, 2, 'cancellation does not start remaining songs');
  const already = new AbortController(); already.abort();
  await assert.rejects(engine.analyze(history, bridge, client, {signal: already.signal}), {name: 'AbortError'});
  assert.equal(tagsCalls, 1, 'already canceled tests never read metadata');
  console.log('PASS cancellation stops remaining work before another song or metadata batch is requested');
})().catch(error => { console.error(error); process.exitCode = 1; });
