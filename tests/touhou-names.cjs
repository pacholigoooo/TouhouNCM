const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/touhou-names.js"), "utf8"), context);
const names = context.window.NcmTouhouNames;
for (const [title, main, annotation] of [
  ["廃獄のロア（原曲：廃獄ララバイ）", "廃獄のロア", "原曲：廃獄ララバイ"],
  ['Goodbye（東方星蓮船より “小さな小さな賢将”）', "Goodbye", '東方星蓮船より “小さな小さな賢将”'],
  ["曲名 (Live)【原曲：A (B)】", "曲名 (Live)", "原曲：A (B)"],
  ["曲名（原曲：A）【出典：東方紅魔郷】", "曲名", "原曲：A · 出典：東方紅魔郷"],
  ["曲名 (Remix)", "曲名 (Remix)", ""],
  ["曲名（原曲：A）(Live)", "曲名（原曲：A）(Live)", ""],
  ["（原曲：A）", "（原曲：A）", ""],
  ["曲名（原曲：A]", "曲名（原曲：A]", ""],
  ["曲名（風のように）", "曲名（風のように）", ""],
  ["螺旋を描く蝶 [Vocal：憐歌]", "螺旋を描く蝶", "Vocal：憐歌"],
  ["螺旋を描く蝶（3話エンディングテーマ）", "螺旋を描く蝶", "3話エンディングテーマ"],
  ["螺旋を描く蝶（3話エンディングテーマ・ショートバージョン）", "螺旋を描く蝶（3話エンディングテーマ・ショートバージョン）", ""],
  ["曲名 (Live) [Vocal: A]【原曲：B】", "曲名 (Live)", "Vocal: A · 原曲：B"]
]) {
  const value = names.splitTitle(title);
  assert.equal(value.title, main);
  assert.equal(value.annotation, annotation);
}
assert.equal(names.resolveAlias("发热巫女 Goodbye").query, "発熱巫女～ず Goodbye");
assert.equal(names.resolveAlias("  少女分形  ").query, "少女フラクタル");
assert.equal(names.resolveAlias("晓Ｒｅｃｏｒｄｓ").query, "暁Records");
assert.equal(names.resolveAlias("发热巫女的歌"), null);
assert.equal(names.resolveAlias("普通歌曲"), null);
assert.equal(names.resolveAlias(""), null);
console.log("PASS title annotations preserve editions; exact circle aliases preserve song keywords");

const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(names.searchQuery('螺旋を描く蝶 [Vocal：憐歌]')), {title: '螺旋を描く蝶', artists: ['憐歌']});
assert.deepEqual(plain(names.searchQuery('螺旋を描く蝶 憐歌', ['憐歌'])), {title: '螺旋を描く蝶', artists: ['憐歌']});
assert.deepEqual(plain(names.searchQuery('A Long English Song', ['Other Artist'])), {title: 'A Long English Song', artists: []});
assert.deepEqual(plain(names.searchQuery('A Long English Song Vocal: Singer')), {title: 'A Long English Song', artists: ['Singer']});
assert.deepEqual(plain(names.compareTitles('螺旋を描く蝶', '螺旋を描く蝶 [Vocal：憐歌]')), {title: 'exact'});
assert.deepEqual(plain(names.compareTitles('螺旋を描く蝶（3話エンディングテーマ）', '螺旋を描く蝶 [Vocal：憐歌]')), {title: 'exact'});
for (const title of ['螺旋を描く蝶（3話エンディングテーマ・オフボーカル）', '螺旋を描く蝶（3話エンディングテーマ・バックボーカルオンリー）', '螺旋を描く蝶 (Short Version)', '螺旋を描く蝶 (Live)']) {
  assert.deepEqual(plain(names.compareTitles(title, '螺旋を描く蝶 [Vocal：憐歌]')), {title: 'main', version: 'different'});
}
assert.deepEqual(plain(names.compareTitles('曲目名称（風のように）', '曲目名称')), {title: 'partial'}, 'ordinary parenthetical title text is preserved');
assert.deepEqual(plain(names.compareTitles('別の曲', '螺旋を描く蝶')), {title: 'none'});
for (const [input, canonical, query] of [
  ["  发热巫女 Goodbye  ", "発熱巫女～ず", "Goodbye"],
  ["Goodbye 発熱巫女～ず", "発熱巫女～ず", "Goodbye"],
  ["发热巫女", "発熱巫女～ず", ""],
  ["幽閉サテライト", "幽閉サテライト", ""],
  ["晓Ｒｅｃｏｒｄｓ  Ｄｒｅａｍ", "暁Records", "Dream"],
  ["Night team shanghai alice", "上海アリス幻樂団", "Night"],
  ["FELT Goodbye", "FELT", "Goodbye"],
  ["Goodbye felt", "FELT", "Goodbye"],
  ["FELT", "FELT", ""],
  ["少女分形 \t 歌名", "少女フラクタル", "歌名"]
]) {
  assert.deepEqual(plain(names.circleQuery(input)), {canonical, query, displayQuery: canonical + (query ? " " + query : "")});
}
for (const input of ["发热巫女的歌", "Goodbye发热巫女", "発熱巫女～ずの歌", "普通歌曲", ""]) {
  assert.equal(names.circleQuery(input), null);
}
console.log("PASS circle queries separate canonical credits from song keywords at explicit boundaries");

const target = {title: 'Goodbye（東方星蓮船より “小さな小さな賢将”）', album: "Parallel Cross",
  vocalists: ["Vivienne"], artists: [], circles: ["FELT"], originals: ["小さな小さな賢将"]};
const candidates = [
  {id: "562594183", title: "Goodbye", artists: ["Vivienne"], album: "Rebirth Story Ⅳ"},
  {id: "wrong-singer", title: "Goodbye", artists: ["Vv"], album: "Goodbye"},
  {id: "longer-title", title: "Say Goodbye", artists: ["Vivienne Monday"], album: "Modern Cruelty"},
  {id: "another-singer", title: "Goodbye", artists: ["EJel"], album: "포커스(Folk Us) Semi Final"},
  {id: "425280603", title: "Ｇｏｏｄｂｙｅ！", artists: ["vivienne"], album: "Parallel Cross", aliases: ['東方星蓮船より “小さな小さな賢将”']},
  {id: "live", title: "Goodbye (Live)", artists: ["Vivienne"], album: "Parallel Cross", aliases: ["Goodbye"]},
  {id: "remix", title: "Goodbye [Eris's Kinetic Emotion mix]", artists: ["Vivienne"], album: "Parallel Cross", aliases: ["Goodbye"]},
  {id: "same-original", title: "Other Arrangement", artists: ["Vivienne"], album: "Parallel Cross", aliases: ["小さな小さな賢将"]}
];
const before = plain(candidates);
const matched = names.matchVersions(candidates, target);
assert.deepEqual(Array.from(matched, song => song.id), ["425280603", "562594183"]);
assert.equal(matched[0], candidates[4], "matches preserve the selected native song object");
assert.deepEqual(plain(candidates), before, "matching does not reorder or edit native candidates");
assert.deepEqual(Array.from(names.matchVersions(candidates, {...target, title: "Goodbye (Live)"}), song => song.id), ["live"]);
assert.deepEqual(Array.from(names.matchVersions(candidates, {...target, title: "Goodbye [Eris's Kinetic Emotion mix]"}), song => song.id), ["remix"]);
assert.deepEqual(Array.from(names.matchVersions([
  {id: "translated", title: "再见", aliases: ["Goodbye"], artists: ["Vivienne"], album: "Another Release"},
  {id: "circle", title: "Goodbye", artists: ["FELT"], album: "Another Release"},
  {id: "album", title: "Goodbye", artists: [], album: "Ｐａｒａｌｌｅｌ　Ｃｒｏｓｓ"},
  {id: "missing-credit", title: "Goodbye", artists: [], album: ""}
], target), song => song.id), ["album", "translated", "circle"]);
assert.equal(names.matchVersions([
  {title: "曲名", artists: ["幽闭星光"], album: "Another Release"}
], {title: "曲名", circles: ["幽閉サテライト"]}).length, 1, "circle aliases compare as the same credit");
assert.deepEqual(Array.from(names.matchVersions([
  {title: "Another Arrangement", aliases: ["小さな小さな賢将"], artists: ["Vivienne"], album: "Parallel Cross"}
], {...target, title: "小さな小さな賢将"})), [], "an original-title alias alone cannot identify the arrangement");
assert.deepEqual(Array.from(names.matchVersions(candidates, {title: "Goodbye"})), [], "a title without matching credits or album is insufficient");
assert.deepEqual(Array.from(names.matchVersions(candidates, null)), []);
console.log("PASS exact song versions require matching credits or album and retain edition distinctions");
