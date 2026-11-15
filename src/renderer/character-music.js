(function (host) {
  "use strict";

  const dimensions = ["bright", "calm", "emotional", "dark", "energetic", "dream", "traditional", "electronic"];
  const styles = [
    ["bright", "明快", /欢快|快乐|欢乐|开心|明亮|微笑|幸福|笑顔|楽しい|ハッピー|(?:^|\W)(?:happy|joy|cheerful|smile|sunshine)(?=$|\W)/i],
    ["calm", "舒缓", /安静|宁静|平静|温柔|治愈|舒缓|轻音乐|钢琴|静か|穏やか|優しい|癒し|ピアノ|(?:^|\W)(?:calm|soft|peace|peaceful|ambient|piano|acoustic|lullaby|chill|relax)(?=$|\W)/i],
    ["emotional", "抒情", /抒情|情歌|爱情|思念|想念|怀念|泪|孤独|离别|别离|愛|恋|涙|切ない|想い|(?:^|\W)(?:love|lonely|miss|tears|goodbye|heart|ballad|memories)(?=$|\W)/i],
    ["dark", "暗色", /黑暗|暗黑|深渊|恐怖|噩梦|恶魔|寂灭|ゴシック|暗闇|悪夢|闇|(?:^|\W)(?:dark|gothic|goth|abyss|horror|nightmare|demon|doom)(?=$|\W)/i],
    ["energetic", "高能", /摇滚|金属|舞曲|战斗|激烈|燃烧|爆发|疾走|ロック|メタル|激しい|戦い|ダンス|(?:^|\W)(?:rock|metal|dance|hardcore|punk|battle|fight|power|eurobeat|drum.?and.?bass)(?=$|\W)/i],
    ["dream", "梦幻", /梦|幻想|星空|童话|宇宙|幻境|幻影|神秘|ドリーム|ファンタジー|(?:^|\W)(?:dream|dreaming|fantasy|fairy|cosmic|starlight|ethereal|mystery)(?=$|\W)/i],
    ["traditional", "古典与和风", /古风|国风|和风|和風|民谣|古典|交响|管弦|弦乐|雅乐|雅楽|二胡|笛|箏|琴|オーケストラ|クラシック|(?:^|\W)(?:classical|orchestra|orchestral|folk|symphony|violin|traditional)(?=$|\W)/i],
    ["electronic", "电子", /电子|電音|电音|合成器|芯片|トランス|テクノ|エレクトロ|(?:^|\W)(?:electronic|electronica|edm|trance|techno|house|dubstep|synth|synthwave|chiptune|future.?bass)(?=$|\W)/i]
  ];
  const motifWords = {
    moon: ["月色", /月|(?:^|\W)(?:moon|lunar)(?=$|\W)/i], night: ["夜晚", /夜|(?:^|\W)(?:night|midnight)(?=$|\W)/i],
    star: ["星光", /星|(?:^|\W)(?:star|stars|starlight)(?=$|\W)/i], flower: ["花", /花|桜|樱|(?:^|\W)(?:flower|bloom|blossom|rose)(?=$|\W)/i],
    snow: ["冰雪", /雪|冰|氷|冬|(?:^|\W)(?:snow|ice|winter|frozen)(?=$|\W)/i], fire: ["火焰", /火|炎|焰|燃|(?:^|\W)(?:fire|flame|burn)(?=$|\W)/i],
    wind: ["风", /风|風|(?:^|\W)(?:wind|breeze)(?=$|\W)/i], water: ["流水", /水|海|波|河|湖|(?:^|\W)(?:water|ocean|sea|wave|river|lake)(?=$|\W)/i],
    forest: ["森林", /森林|树林|樹|木漏れ|(?:^|\W)(?:forest|woods|tree|trees)(?=$|\W)/i], dream: ["梦境", /梦|夢|(?:^|\W)(?:dream|dreaming|dreams)(?=$|\W)/i],
    time: ["时光", /时间|时光|時計|時間|永远|永遠|(?:^|\W)(?:time|clock|eternity|eternal)(?=$|\W)/i], magic: ["魔法", /魔法|魔术|魔術|(?:^|\W)(?:magic|magical|witch)(?=$|\W)/i],
    spirit: ["灵魂", /灵魂|霊|幽灵|幽霊|幽冥|(?:^|\W)(?:soul|spirit|ghost|phantom)(?=$|\W)/i], love: ["爱与思念", /爱情|愛|恋|思念|想念|(?:^|\W)(?:love|heart|miss)(?=$|\W)/i],
    hope: ["希望", /希望|愿望|梦想|明日|未来|未來|(?:^|\W)(?:hope|wish|tomorrow|future)(?=$|\W)/i], journey: ["旅途", /旅行|旅途|旅立|遠く|远方|远行|(?:^|\W)(?:journey|travel|voyage|wander)(?=$|\W)/i],
    battle: ["战斗", /战斗|戦い|戦争|斗争|闘|(?:^|\W)(?:battle|fight|war|warrior)(?=$|\W)/i], sky: ["天空", /天空|空へ|空を|飞翔|飛|翼|(?:^|\W)(?:sky|fly|flight|wings)(?=$|\W)/i],
    sun: ["阳光", /太阳|太陽|日光|阳光|陽光|(?:^|\W)(?:sun|sunshine|sunlight)(?=$|\W)/i], rain: ["雨", /雨|(?:^|\W)(?:rain|rainy)(?=$|\W)/i],
    earth: ["大地", /大地|地底|地狱|地獄|山|(?:^|\W)(?:earth|ground|mountain|underground)(?=$|\W)/i], machine: ["机械", /机械|機械|机器|機器|未来都市|(?:^|\W)(?:machine|robot|cyber|digital)(?=$|\W)/i]
  };
  const clamp = value => Math.max(0, Math.min(1, value));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const normalized = value => String(value || "").normalize("NFKC").toLowerCase();

  function select(history) {
    const unique = (tracks, field) => {
      const seen = new Set();
      return (tracks || []).filter(track => track?.id && track.title).slice().sort((a, b) => number(b[field]) - number(a[field]))
        .filter(track => { const id = String(track.id); if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 30);
    };
    const top = unique(history.topTracks, "estimatedListeningMs");
    const recent = unique(history.recentTracks, "recentAt");
    const groups = [["top", top], ["recent", recent]].filter(([, tracks]) => tracks.length);
    const merged = new Map();
    for (const [source, tracks] of groups) {
      for (const track of tracks) {
        const id = String(track.id), previous = merged.get(id);
        const item = previous || {track: {...track, id}, sources: [], weight: 0};
        item.sources.push(source); item.weight += 1 / groups.length / tracks.length;
        if (previous && source === "recent") item.track.recentAt = track.recentAt;
        merged.set(id, item);
      }
    }
    return {tracks: [...merged.values()], topCount: top.length, recentCount: recent.length,
      overlapCount: top.length + recent.length - merged.size, timeBasis: history.timeBasis || "estimated"};
  }

  function features(track, info = {}) {
    const tags = [...new Set((info.tags || []).map(String).filter(Boolean))];
    // Strip LRC timestamps and credit lines; a composer credit is not a lyric cue.
    const lyrics = String(info.lyrics || "").slice(0, 60000).replace(/\[[^\]\r\n]*\]/g, "").split(/\r?\n/)
      .filter(line => !/^\s*(?:作词|作曲|编曲|演唱|歌手|翻译|翻譯|词|曲|作詞|編曲|vocal|lyrics|compose|arrange)\s*[:：]/i.test(line)).join("\n");
    const sources = [[tags.join(" "), 2.5], [track.title, 1.2], [track.album, .4], [lyrics, 1]].map(([value, weight]) => [normalized(value), weight]);
    const vector = {}, evidence = [];
    for (const [dimension, label, pattern] of styles) {
      const strength = sources.reduce((sum, [value, weight]) => sum + (pattern.test(value) ? weight : 0), 0);
      vector[dimension] = strength ? Math.min(1, .35 + strength * .16) : .3;
      if (strength) evidence.push({label, strength});
    }
    // Explicit calm/energetic styles describe opposing listening tendencies.
    if (vector.energetic > .65 && vector.calm === .3) vector.calm = .15;
    if (vector.calm > .65 && vector.energetic === .3) vector.energetic = .15;
    const motifs = Object.entries(motifWords).map(([key, [label, pattern]]) => ({key, label,
      strength: sources.reduce((sum, [value, weight]) => sum + (pattern.test(value) ? weight : 0), 0)}))
      .filter(item => item.strength > 0).sort((a, b) => b.strength - a.strength);
    const labels = [...evidence.sort((a, b) => b.strength - a.strength).map(item => item.label), ...motifs.slice(0, 3).map(item => item.label)];
    return {vector, motifs: motifs.slice(0, 6).map(item => item.key), labels: [...new Set(labels)].slice(0, 5),
      tags, hasLyrics: Boolean(lyrics.trim()), informative: evidence.length > 0 || motifs.length > 0};
  }

  function compatibility(features, affinity) {
    if (!features.informative) return .5;
    let evidence = 0, style = 0;
    for (const name of dimensions) {
      const weight = Math.max(0, number(features.vector[name]) - .3);
      evidence += weight;
      style += weight * number(affinity[name]);
    }
    const motifs = new Set(affinity.motifs || []);
    const shared = features.motifs.filter(motif => motifs.has(motif)).length;
    const motifScore = features.motifs.length ? shared / features.motifs.length : 0;
    if (!evidence) return motifScore;
    const styleScore = style / evidence;
    return clamp(features.motifs.length ? styleScore * .75 + motifScore * .25 : styleScore);
  }

  function rank(rows, affinities) {
    const total = rows.reduce((sum, row) => sum + number(row.weight), 0);
    if (!total || !rows.some(row => row.features?.informative)) return [];
    return Object.entries(affinities).map(([character, affinity]) => {
      const score = rows.reduce((sum, row) => sum + row.weight * compatibility(row.features, affinity), 0) / total;
      return {character, score, percentage: score * 100};
    }).sort((a, b) => b.score - a.score || a.character.localeCompare(b.character, "zh-CN"));
  }

  function describe(rows, character, affinity) {
    const informative = rows.filter(row => row.features?.informative && number(row.weight) > 0);
    if (!informative.length || !affinity) return "";
    const phrases = {
      bright: ["bright", "容易被轻快、明亮的小快乐打动"],
      calm: ["calm", "更愿意按自己的步调，给思绪留点安静的空间"],
      emotional: ["emotional", "更重视情绪与回忆，愿意慢慢回味熟悉的感受"],
      dark: ["dark", "对故事里幽暗、复杂的一面也有好奇心"],
      energetic: ["energetic", "喜欢有冲劲的表达，愿意跟着节奏释放情绪"],
      dream: ["dream", "愿意让想象走远一点，给日常留些新鲜的可能"],
      traditional: ["traditional", "愿意慢慢品味有层次、带余韵的细节"],
      electronic: ["electronic", "乐于尝试新鲜声音，对变化和新点子保持好奇"]
    };
    const motifPhrases = {
      moon: ["calm", "喜欢在安静的时刻整理思绪"], night: ["calm", "享受留给自己的片刻空间"],
      star: ["dream", "愿意给远一点的愿望留个位置"], flower: ["bright", "容易留意到细小、短暂的美好"],
      snow: ["calm", "偏爱清透克制的表达，珍惜安静的余地"], fire: ["energetic", "喜欢有热度、有冲劲的表达"],
      wind: ["journey", "重视自在感，愿意跟着好奇心走走"], water: ["calm", "愿意让感受自然流动，给自己留些余地"],
      forest: ["dream", "喜欢有空间感、能慢慢探索的氛围"], dream: ["dream", "愿意给日常之外的想象留一点空间"],
      time: ["emotional", "珍惜熟悉的记忆，也愿意慢慢体会变化"], magic: ["dream", "对未知的小惊喜有好奇心，喜欢保留想象"],
      spirit: ["dark", "容易被含蓄、有故事感的表达吸引"], love: ["emotional", "愿意认真体会情绪，珍惜人与人之间的共鸣"],
      hope: ["bright", "愿意给未来和新的可能留些期待"], journey: ["journey", "喜欢带着好奇心寻找新的风景"],
      battle: ["energetic", "容易被坚定、有冲劲的表达打动"], sky: ["journey", "喜欢开阔自在的感觉，愿意把目光放远一点"],
      sun: ["bright", "更容易留意到温暖、明亮的一面"], rain: ["calm", "愿意安静地听一会儿自己的感受"],
      earth: ["traditional", "喜欢踏实、有厚度的表达，愿意慢慢积累感受"], machine: ["electronic", "对新鲜结构和声音里的巧思有好奇心"]
    };
    const cues = [];
    for (const [dimension, label] of styles) {
      const present = informative.filter(row => number(row.features.vector[dimension]) > .3);
      const weight = present.reduce((sum, row) => sum + row.weight, 0);
      if (!weight || number(affinity[dimension]) < .4) continue;
      const observed = present.reduce((sum, row) => sum + row.weight * row.features.vector[dimension], 0) / weight;
      const similarity = 1 - Math.abs(observed - number(affinity[dimension]));
      if (similarity >= .5) cues.push({label, phrase: phrases[dimension], score: weight * (observed - .3) * number(affinity[dimension])});
    }
    for (const motif of affinity.motifs || []) {
      if (!motifPhrases[motif]) continue;
      const weight = informative.reduce((sum, row) => sum + (row.features.motifs.includes(motif) ? row.weight : 0), 0);
      if (weight) cues.push({label: motifWords[motif][0], phrase: motifPhrases[motif], motif, score: weight * .35});
    }
    // Pair the shared listening style with a character's own recurring motif.
    const signature = cues.find(cue => cue.motif);
    const groups = new Set(), chosen = [signature, ...cues.sort((a, b) => b.score - a.score)].filter(cue => {
      if (!cue) return false;
      if (groups.has(cue.phrase[0])) return false;
      groups.add(cue.phrase[0]); return true;
    }).slice(0, 2);
    if (!chosen.length) return "";
    const traits = {bright: "留意生活里的小快乐", calm: "重视自己的步调", emotional: "珍惜情绪与回忆", dark: "对复杂故事的好奇",
      energetic: "愿意表达热情与冲劲", dream: "对未知与想象的好奇", traditional: "耐心品味细节", electronic: "乐于尝试新鲜事物", journey: "向往自在与新的风景"};
    const clues = chosen.map(cue => cue.label).join("、");
    const similarity = "。你与" + character + "相似的是" + chosen.map(cue => traits[cue.phrase[0]]).join("和") + "，共同线索是“" + clues + "”。";
    const lead = "从这些歌看，你";
    const description = lead + chosen.map(cue => cue.phrase[1]).join("，同时") + similarity;
    return Array.from(description).length <= 110 ? description : lead + chosen[0].phrase[1] + similarity;
  }

  host.NcmCharacterMusic = {select, features, compatibility, rank, describe};
})(window);
