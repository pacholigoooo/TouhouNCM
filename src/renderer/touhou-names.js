(function (host) {
  "use strict";

  // Names are listed on each circle's THBWiki page. Keep aliases explicit so
  // ordinary song titles never get rewritten by a fuzzy translation.
  const circles = [
    {name: "発熱巫女～ず", aliases: ["发热巫女", "發熱巫女", "発熱巫女"], page: "発熱巫女～ず"},
    {name: "幽閉サテライト", aliases: ["幽闭星光", "幽閉星光", "幽闭卫星", "幽閉衛星"], page: "幽闭星光"},
    {name: "少女フラクタル", aliases: ["少女分形"], page: "少女分形"},
    {name: "森羅万象", aliases: ["森罗万象", "森羅萬象"], page: "森罗万象"},
    {name: "舞風", aliases: ["舞风", "MAIKAZE"], page: "舞风"},
    {name: "暁Records", aliases: ["晓Records", "曉Records"], page: "暁Records"},
    {name: "上海アリス幻樂団", aliases: ["上海爱丽丝幻乐团", "上海愛麗絲幻樂團", "上海アリス幻楽団", "Team Shanghai Alice"], page: "上海爱丽丝幻乐团"},
    {name: "Liz Triangle", aliases: ["Liz三角", "LizTriangle"], page: "LizTriangle"},
    {name: "FELT", aliases: [], page: "FELT"}
  ].map(circle => Object.freeze({...circle, sourceUrl: "https://thwiki.cc/" + encodeURIComponent(circle.page)}));
  const normal = value => String(value || "").normalize("NFKC").trim().toLowerCase();
  const aliases = circles.flatMap(circle => circle.aliases.map(alias => ({circle, alias, key: normal(alias)})))
    .sort((a, b) => b.key.length - a.key.length);
  const circleNames = circles.flatMap(circle => [circle.name, ...circle.aliases].map(name => ({circle, key: normal(name)})))
    .sort((a, b) => b.key.length - a.key.length);

  function resolveAlias(input) {
    const query = String(input || "").trim(), normalized = query.normalize("NFKC");
    const lower = normalized.toLowerCase();
    for (const {circle, alias, key} of aliases) {
      if (lower === key || lower.startsWith(key) && /\s/.test(lower[key.length])) {
        return {query: circle.name + normalized.slice(key.length), canonical: circle.name, alias, sourceUrl: circle.sourceUrl};
      }
    }
    return null;
  }

  function circleQuery(input) {
    const normalized = String(input || "").normalize("NFKC").trim(), lower = normalized.toLowerCase();
    for (const {circle, key} of circleNames) {
      let query;
      if (lower === key) query = "";
      else if (lower.startsWith(key) && /\s/.test(lower[key.length])) query = normalized.slice(key.length).trim();
      else if (lower.endsWith(key) && /\s/.test(lower[lower.length - key.length - 1])) query = normalized.slice(0, -key.length).trim();
      else continue;
      return {canonical: circle.name, query, displayQuery: circle.name + (query ? " " + query : "")};
    }
    return null;
  }

  function trailingNote(title) {
    const pairs = { ")": "(", "）": "（", "]": "[", "】": "【" };
    if (!pairs[title[title.length - 1]]) return null;
    const stack = [];
    for (let i = title.length - 1; i >= 0; i--) {
      const char = title[i];
      if (pairs[char]) stack.push(pairs[char]);
      else if ("(（[【".includes(char)) {
        if (stack.pop() !== char) return null;
        if (!stack.length) return i > 0 ? {title: title.slice(0, i).trimEnd(), note: title.slice(i + 1, -1).trim()} : null;
      }
    }
    return null;
  }

  function splitTitle(input) {
    const original = String(input || ""), notes = [];
    let title = original.trim();
    let suffix;
    while ((suffix = trailingNote(title))) {
      const note = suffix.note;
      const explicit = /^(?:原曲|原題|原题|出处|出處|出典|出自)\s*[:：]/.test(note);
      const fromWork = /^(?:東方|东方|蓮台野|莲台野|夢違|梦违|卯酉|大空|鳥船|鸟船|伊弉諾|伊弉诺).+より(?:\s|[「『"“]|$)/.test(note);
      const credit = /^(?:vocals?|vo\.?|chorus|演唱|歌唱|歌手|歌|arrange(?:r)?|編曲|编曲|lyrics?|作詞|作词|compose(?:r)?|作曲)\s*[:：]/i.test(note);
      const themeUse = /^(?:第?\d+話\s*)?(?:エンディング|オープニング)テーマ$/.test(note.normalize("NFKC"));
      if (!explicit && !fromWork && !credit && !themeUse) break;
      notes.unshift(note);
      title = suffix.title;
    }
    return notes.length && title ? {title, annotation: notes.join(" · ")} : {title: original, annotation: ""};
  }

  const comparisonKey = value => normal(value).replace(/[\s\p{P}]/gu, "");
  const titleKey = value => comparisonKey(splitTitle(value).title);
  function searchQuery(input, knownArtists = []) {
    const parsed = splitTitle(input), artists = [];
    let title = parsed.title.trim();
    const addCredit = note => {
      const credit = note.match(/^(?:vocals?|vo\.?|演唱|歌唱|歌手|歌)\s*[:：]\s*(.+)$/i);
      if (credit) artists.push(...credit[1].split(/[,，、/／&＆]/).map(name => name.trim()).filter(Boolean));
    };
    parsed.annotation.split(" · ").forEach(addCredit);
    const marked = title.match(/\s+((?:vocals?|vo\.?|演唱|歌唱|歌手)\s*[:：]\s*.+)$/i);
    if (marked) {
      addCredit(marked[1]);
      title = title.slice(0, marked.index).trimEnd();
    } else {
      const normalized = title.normalize("NFKC");
      for (const artist of [...knownArtists].sort((a, b) => b.length - a.length)) {
        const key = normal(artist), start = normalized.length - key.length;
        if (key && start > 0 && /\s/.test(normalized[start - 1]) && normalized.slice(start).toLowerCase() === key) {
          artists.push(artist);
          title = normalized.slice(0, start).trimEnd();
          break;
        }
      }
    }
    return {title, artists: [...new Set(artists)]};
  }

  function mainTitle(value) {
    let title = splitTitle(value).title.trim(), suffix;
    while ((suffix = trailingNote(title))) {
      if (!/\b(?:live|remix|mix|instrumental|karaoke|off[\s-]*vocal|short|full|tv[\s.-]*(?:size|ver)|(?:radio|album|single)[\s-]*edit|ver(?:sion)?\.?)\b|オフ[・\s-]*(?:ボ|ヴォ)ーカル|インスト|カラオケ|伴奏|ショート|フル|ライブ|リミックス|エンディング|オープニング|TVサイズ/i.test(suffix.note.normalize("NFKC"))) break;
      title = suffix.title;
    }
    return title;
  }

  function compareTitles(value, target) {
    const a = titleKey(value), b = titleKey(target);
    if (!a || !b) return {title: "unknown"};
    if (a === b) return {title: "exact"};
    const main = comparisonKey(mainTitle(value));
    if (main && main === comparisonKey(mainTitle(target))) return {title: "main", version: "different"};
    return {title: Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)) ? "partial" : "none"};
  }

  function editionKey(value) {
    const title = normal(splitTitle(value).title);
    return [...(title.match(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g) || []),
      ...(title.match(/\b(?:live|remix|mix|instrumental|karaoke|off[\s-]*vocal)\b/g) || [])].map(comparisonKey).join("|");
  }
  function creditKey(value) {
    const found = circleNames.find(entry => entry.key === normal(value));
    return comparisonKey(found ? found.circle.name : value);
  }

  function matchVersions(songs, target) {
    const title = titleKey(target && target.title);
    if (!title || !Array.isArray(songs)) return [];
    const album = comparisonKey(target.album);
    const edition = editionKey(target.title);
    const credits = new Set([...(target.vocalists || []), ...(target.artists || []), ...(target.circles || [])].map(creditKey).filter(Boolean));
    const originals = new Set((target.originals || []).map(titleKey).filter(Boolean));
    return songs.map((song, index) => {
      // A bare original title in native aliases describes the source melody;
      // it does not identify another arrangement of that melody as this song.
      const sameTitle = titleKey(song.title) === title || editionKey(song.title) === edition && (song.aliases || []).some(alias => {
        const candidate = titleKey(alias);
        return candidate === title && !originals.has(candidate);
      });
      const sameAlbum = !!album && comparisonKey(song.album) === album;
      const sameArtist = (song.artists || []).some(artist => credits.has(creditKey(artist)));
      return {song, index, sameTitle, sameAlbum, sameArtist};
    }).filter(item => item.sameTitle && (item.sameAlbum || item.sameArtist))
      .sort((a, b) => Number(b.sameAlbum) - Number(a.sameAlbum) || Number(b.sameArtist) - Number(a.sameArtist) || a.index - b.index)
      .map(item => item.song);
  }

  host.NcmTouhouNames = Object.freeze({splitTitle, searchQuery, compareTitles, resolveAlias, circleQuery, matchVersions, circles});
})(window);
