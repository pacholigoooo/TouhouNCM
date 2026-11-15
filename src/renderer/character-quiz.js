(function (host) {
  "use strict";
  const RESULT_KEY = "ncm-immersive.characterQuiz.v3";
  const LEGACY_RESULT_KEYS = ["ncm-immersive.characterQuiz.v2", "ncm-immersive.characterQuiz.v1"];
  const music = host.NcmCharacterMusic;
  const key = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const abort = signal => { if (signal?.aborted) { const error = new Error("已取消测试"); error.name = "AbortError"; throw error; } };
  const cleanOriginal = value => value.replace(/^(?:(?:東方|东方).+?|稀翁玉|秋霜玉|蓬莱人形|蓮台野夜行|莲台野夜行)より\s*/, "").split(/\s*[～~]\s*(?=東方|东方)|[／/]\s*(?=Chorus\s*:)/i)[0].trim();

  function explicitOriginals(track) {
    const originals = [];
    for (const value of [track.title, ...(track.aliases || [])]) {
      const parsed = host.NcmTouhouNames.splitTitle(value);
      for (const annotation of (parsed.annotation || value).split(" · ")) {
        const marked = annotation.match(/^(?:原曲|原題|原题|出典|出处|出處)\s*[:：]\s*(.+)$/);
        const from = annotation.match(/^(?:東方|东方).+?より\s*(.+)$/);
        const raw = marked?.[1] || from?.[1];
        if (!raw) continue;
        const quotes = [...raw.matchAll(/[「『“"]([^」』”"]+)[」』”"]/g)].map(match => match[1]);
        originals.push(...(quotes.length ? quotes : raw.split(/\s+[／/]\s+|[;；]/)).map(cleanOriginal).filter(Boolean));
      }
    }
    return [...new Set(originals)];
  }

  function touhouTrack(track) {
    if (/東方|东方|touhou|(?:原曲|原題|原题|出典|出处|出處)\s*[:：]/i.test([track.title, track.album, ...(track.aliases || [])].join(" "))) return true;
    const known = new Set(["ZUN", ...host.NcmTouhouNames.circles.flatMap(circle => [circle.name, ...circle.aliases])].map(key));
    return (track.artists || []).some(artist => known.has(key(artist)));
  }

  function copyTrack(track) {
    const saved = {id: String(track.id), title: String(track.title), artists: [...(track.artists || [])], album: track.album || "", aliases: [...(track.aliases || [])]};
    for (const field of ["durationMs", "playCount", "estimatedListeningMs", "recentAt"]) if (Number.isFinite(track[field])) saved[field] = track[field];
    return saved;
  }

  function score(rows, sample, options = {}) {
    const affinities = host.NcmCharacterAffinities;
    const ranking = music.rank(rows, affinities).slice(0, 10);
    ranking.slice(0, 3).forEach(item => { item.summary = music.describe(rows, item.character, affinities[item.character]); });
    for (const row of rows) {
      row.matches = [];
      if (!row.features.informative) continue;
      const closest = music.rank([row], affinities).slice(0, 3);
      const characters = [...new Set([...closest, ...ranking.slice(0, 3)].map(item => item.character))];
      row.matches = characters.map(character => ({character, contribution: row.weight * music.compatibility(row.features, affinities[character]),
        kind: "music", reason: row.features.labels.join(" · "), sourceUrl: host.NcmCharacterProfiles?.[character]?.sourceUrl || ""}));
    }
    return {version: 3, createdAt: options.createdAt || Date.now(), sample, mode: "music", readCount: rows.length,
      recognizedCount: rows.filter(row => row.features.informative).length, taggedCount: rows.filter(row => row.features.tags.length).length,
      lyricCount: rows.filter(row => row.features.hasLyrics).length, matchedCount: rows.filter(row => row.originals.length).length,
      ranking, rows, warnings: [...new Set(options.warnings || [])]};
  }

  function rescore(result) {
    if (result?.version !== 3 || !Array.isArray(result.rows) || !result.sample) throw new Error("旧规则结果需要重新测试");
    const rows = result.rows.map(row => ({track: copyTrack(row.track), weight: row.weight, sources: [...row.sources], features: row.features,
      originals: [...(row.originals || [])], sourceUrl: row.sourceUrl || "", matchKind: row.matchKind || "", reason: row.reason || "", warnings: [...(row.warnings || [])]}));
    return score(rows, {...result.sample}, {createdAt: result.createdAt, warnings: result.warnings});
  }

  async function analyze(history, bridge, client, options = {}) {
    const {signal, onProgress = () => {}} = options;
    abort(signal);
    const selection = music.select(history), tracks = selection.tracks, rows = new Array(tracks.length);
    const sample = {topCount: selection.topCount, recentCount: selection.recentCount, overlapCount: selection.overlapCount,
      timeBasis: selection.timeBasis, topTotal: history.topTotal ?? selection.topCount};
    const warnings = [...(history.warnings || [])];
    onProgress({done: 0, total: tracks.length, stage: "tags"});
    let tagResult;
    try { tagResult = await bridge.musicTags(tracks.map(item => item.track), {signal}); }
    catch (error) { if (error.name === "AbortError") throw error; tagResult = {tagsById: {}, warnings: ["歌曲标签读取失败"]}; }
    abort(signal);
    warnings.push(...(tagResult.warnings || []));
    let cursor = 0, done = 0;

    async function addOrigins(row) {
      const track = row.track;
      let detail = client?.getSaved(track.id);
      if (detail) row.matchKind = "已确认的原曲资料";
      if (!detail) {
        const originals = explicitOriginals(track);
        if (originals.length) { detail = {originals, sourceUrl: row.sourceUrl}; row.matchKind = "歌曲原曲标注"; }
      }
      if (!detail && options.online === true && touhouTrack(track)) {
        const query = host.NcmTouhouNames.splitTitle(track.title).title;
        const candidates = await client.search({...track, title: query}, {signal});
        abort(signal);
        const exact = candidates.filter(candidate => key(host.NcmTouhouNames.splitTitle(candidate.title).title) === key(query) && key(track.album) && key(candidate.album) === key(track.album) && candidate.match?.artist !== "none");
        if (exact.length === 1) { detail = await client.detail(exact[0], {signal}); row.matchKind = "THBWiki 原曲资料"; }
      }
      if (detail) { row.originals = [...new Set(detail.originals || [])]; row.sourceUrl = detail.sourceUrl || row.sourceUrl; }
    }

    async function inspect(item) {
      const track = copyTrack(item.track), tags = tagResult.tagsById?.[track.id] || [];
      let info;
      try { info = await bridge.songMusicInfo(track, {signal, tags}); }
      catch (error) { if (error.name === "AbortError") throw error; info = {tags, lyrics: "", warnings: ["部分歌曲听感资料读取失败"]}; }
      abort(signal);
      const features = music.features({...track, title: host.NcmTouhouNames.splitTitle(track.title).title}, info);
      const row = {track, weight: item.weight, sources: [...item.sources], features, originals: [], matches: [],
        sourceUrl: "https://music.163.com/#/song?id=" + encodeURIComponent(track.id), matchKind: "", warnings: [...(info.warnings || [])],
        reason: features.informative ? features.labels.join(" · ") : "听感线索不足，按中性权重计入"};
      try { await addOrigins(row); }
      catch (error) { if (error.name === "AbortError") throw error; row.warnings.push("部分东方曲原曲资料未能读取"); }
      abort(signal);
      warnings.push(...row.warnings);
      return row;
    }
    async function worker() {
      while (cursor < tracks.length) {
        abort(signal);
        const index = cursor++;
        rows[index] = await inspect(tracks[index]);
        abort(signal);
        onProgress({done: ++done, total: tracks.length, stage: "songs"});
      }
    }
    await Promise.all([worker(), worker()]);
    abort(signal);
    return score(rows, sample, {warnings});
  }

  host.NcmCharacterQuiz = {analyze, rescore, explicitOriginals, resultKey: RESULT_KEY, legacyResultKeys: LEGACY_RESULT_KEYS};
})(window);

function mountCharacterQuiz(card, bridge, client, writeClipboardText) {
  const doc = card.ownerDocument, engine = window.NcmCharacterQuiz;
  const onlineKey = "ncm-immersive.characterQuiz.online";
  const panel = doc.createElement("section");
  panel.className = "character-quiz";
  panel.dataset.characterQuiz = "";
  panel.hidden = true;
  panel.innerHTML = `
    <h3 class="character-heading">最近，你的歌声偏向谁？</h3>
    <p class="character-description">常听30首＋最近30首，看看你的听歌角色。</p>
    <div class="character-actions"><button class="origin-button" type="button" data-character-start>开始测试</button><button class="origin-text-button" type="button" data-character-cancel hidden>取消</button><button class="origin-text-button" type="button" data-character-copy hidden>复制结果</button><button class="origin-text-button" type="button" data-character-export hidden>导出 PNG</button></div>
    <details class="character-options"><summary>资料来源与计分方式</summary>
      <p class="character-description">累计榜内按播放次数×曲长估算时长取前30，两组各占一半，组内每曲等权，重复曲合并累加。按歌曲标签、歌词线索与角色听感画像做趣味匹配。</p>
      <p class="character-description">每首歌都计入样本，线索较少时按中性听感计算。各角色分别计算契合度，反映与你的歌曲听感的接近程度。</p>
      <label class="character-online"><input type="checkbox" data-character-online checked aria-describedby="character-online-hint"><span>补充东方曲原曲资料（THBWiki）</span></label><p class="character-online-hint" id="character-online-hint">为有东方标注或已知社团的歌曲，向 THBWiki 查询曲名、歌手与专辑，将原曲资料附在依据曲目中。</p>
    </details>
    <p class="origin-status" role="status" aria-live="polite" data-character-status>点击开始，读取网易云音乐的累计排行与最近播放记录。</p>
    <progress class="character-progress" data-character-progress aria-label="听感资料分析进度" hidden></progress>
    <div data-character-result hidden></div>`;
  card.querySelector(".origin-body").appendChild(panel);
  const $ = selector => panel.querySelector(selector);
  try { $("[data-character-online]").checked = localStorage.getItem(onlineKey) !== "false"; } catch (_) {}
  let request = null, generation = 0, destroyed = false, lastResult = null, exporting = false;

  function message(text, error = false) { const status = $("[data-character-status]"); status.textContent = text; status.dataset.error = String(error); }
  function cancel() {
    generation++;
    if (request) { request.abort(); request = null; message("已取消测试，可以重新开始。"); }
    $("[data-character-start]").disabled = false;
    $("[data-character-cancel]").hidden = true;
    $("[data-character-progress]").hidden = true;
    panel.removeAttribute("aria-busy");
  }
  function append(parent, tag, text, className) {
    const node = doc.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node); return node;
  }
  function sourceLink(parent, text, url) {
    if (!/^https:\/\/(?:thwiki\.cc\/|music\.163\.com\/)/i.test(url || "")) return;
    const anchor = append(parent, "a", text); anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
  }
  function profile(parent, character, summary) {
    const data = window.NcmCharacterProfiles[character];
    if (!data) return;
    const section = doc.createElement("div"); section.className = "character-profile";
    append(section, "p", data.title, "character-profile-title");
    append(section, "p", data.description, "character-profile-description");
    if (summary) append(section, "p", summary, "character-listener-summary");
    sourceLink(section, "人物资料", data.sourceUrl);
    parent.appendChild(section);
  }
  function render(result) {
    lastResult = result;
    const output = $("[data-character-result]"); output.replaceChildren(); output.hidden = false;
    if (result.ranking.length) {
      append(output, "h3", "你的听歌角色是", "character-result-heading");
      append(output, "p", result.ranking[0].character, "character-winner");
      profile(output, result.ranking[0].character, result.ranking[0].summary);
    } else append(output, "h3", "这次的听感线索还不够，暂不生成角色结果", "character-result-heading");
    if (result.warnings.length) append(output, "p", result.warnings.join("；"), "character-note");
    if (result.ranking.length) {
      const ranking = doc.createElement("ol"); ranking.className = "character-ranking"; ranking.setAttribute("aria-label", "角色契合度前 3 名");
      result.ranking.slice(0, 3).forEach(item => {
        const row = doc.createElement("li"), line = doc.createElement("div");
        append(line, "strong", item.character); append(line, "span", "契合度 " + item.percentage.toFixed(1) + "%");
        row.appendChild(line); const bar = doc.createElement("div"); bar.className = "character-score-track";
        const fill = doc.createElement("span"); fill.style.width = item.percentage + "%"; bar.appendChild(fill); row.appendChild(bar); ranking.appendChild(row);
      });
      output.appendChild(ranking);
      if (result.ranking.length > 1) {
        const detail = doc.createElement("details"); detail.className = "character-evidence";
        append(detail, "summary", "认识另外两位角色");
        result.ranking.slice(1, 3).forEach(item => { append(detail, "h4", item.character); profile(detail, item.character, item.summary); });
        output.appendChild(detail);
      }
    }
    for (const [recognized, label] of [[true, "查看依据曲目"], [false, "查看线索不足的歌曲"]]) {
      const rows = result.rows.filter(row => Boolean(row.matches.length) === recognized);
      if (!rows.length) continue;
      const detail = doc.createElement("details"); detail.className = "character-evidence";
      append(detail, "summary", label + "（" + rows.length + "）");
      const list = doc.createElement("ul");
      rows.forEach(row => {
        const item = doc.createElement("li"); append(item, "strong", row.track.title);
        append(item, "span", [...row.track.artists, row.track.album].filter(Boolean).join(" · "), "character-meta");
        append(item, "p", row.sources.map(source => source === "top" ? "常听" : "最近").join("＋") + " · 样本权重 " + (row.weight * 100).toFixed(1) + "%");
        if (recognized) {
          append(item, "p", "听感线索：" + row.features.labels.join(" · "));
          if (row.features.tags.length) append(item, "p", "歌曲标签：" + row.features.tags.slice(0, 6).join(" · "));
          row.matches.slice(0, 3).forEach(match => append(item, "p", match.character + " · 该曲听感契合度 " + (match.contribution / row.weight * 100).toFixed(1) + "%"));
        } else append(item, "p", row.reason);
        if (row.originals.length) append(item, "p", "原曲资料：" + row.originals.join(" / "));
        const links = doc.createElement("div"); links.className = "character-sources";
        sourceLink(links, row.matchKind || "歌曲资料", row.sourceUrl);
        item.appendChild(links);
        list.appendChild(item);
      }); detail.appendChild(list); output.appendChild(detail);
    }
    $("[data-character-copy]").hidden = false;
    $("[data-character-export]").hidden = !result.ranking.length;
  }
  async function start() {
    cancel();
    const controller = new AbortController(), id = generation;
    request = controller;
    panel.setAttribute("aria-busy", "true");
    $("[data-character-start]").disabled = true;
    $("[data-character-cancel]").hidden = false;
    message("正在读取累计排行与最近播放记录…");
    try {
      const history = await bridge.characterHistory({ signal: controller.signal });
      if (id !== generation || destroyed || controller.signal.aborted) return;
      if (!history.topTracks.length && !history.recentTracks.length) { message(history.warnings.join("；") || "还没有可用于测试的听歌记录。听过歌后再来测试。"); return; }
      const result = await engine.analyze(history, bridge, client, { signal: controller.signal, online: $("[data-character-online]").checked, onProgress({ done, total, stage }) {
        if (id !== generation || destroyed) return;
        const progress = $("[data-character-progress]"); progress.hidden = false; progress.max = total; progress.value = done;
        message(stage === "tags" ? "正在读取歌曲标签…" : "正在分析听感线索 · " + done + " / " + total + " 首");
      } });
      if (id !== generation || destroyed) return;
      render(result);
      try { localStorage.setItem(engine.resultKey, JSON.stringify(result)); message("测试完成，已在本机记住这次结果。"); }
      catch (_) { message("测试完成；本机存储空间不足，这次结果未能保存。"); }
    } catch (error) { if (!destroyed && id === generation && error.name !== "AbortError") message(error.message || "暂时无法读取听歌记录，请重试。", true); }
    finally {
      if (id === generation && !destroyed) {
        request = null; $("[data-character-start]").disabled = false; $("[data-character-cancel]").hidden = true;
        $("[data-character-progress]").hidden = true; panel.removeAttribute("aria-busy");
      }
    }
  }
  async function copy() {
    if (!lastResult) return;
    const result = lastResult;
    const lines = ["TouhouNCM · 你的听歌角色是" + (result.ranking[0]?.character || "待补充听感线索"),
      window.NcmCharacterProfiles[result.ranking[0]?.character]?.description || "",
      ...result.ranking.slice(0, 3).flatMap((item, index) => [(index + 1) + ". " + item.character + " · 契合度 " + item.percentage.toFixed(1) + "%", item.summary || ""]),
      ...result.rows.filter(row => row.matches.length).map(row => row.track.title + " → " + row.features.labels.join(" / "))].filter(Boolean);
    const copied = await writeClipboardText(lines.join("\n"));
    if (!destroyed) message(copied ? "已复制角色结果与依据曲目。" : "复制失败，请稍后重试。", !copied);
  }
  async function exportPng() {
    if (!lastResult?.ranking.length || exporting) return;
    exporting = true;
    const button = $("[data-character-export]"); button.disabled = true;
    message("正在生成角色图片…");
    try {
      const image = await window.NcmCharacterExport.create(lastResult, window.NcmCharacterProfiles);
      if (destroyed) return;
      message("请选择图片保存位置。");
      const saved = await window.NcmCharacterExport.save(image);
      if (!destroyed) message(saved.canceled ? "已取消保存，可以随时重新导出。" : "PNG 图片已保存。");
    } catch (error) { if (!destroyed) message(error.message || "图片导出失败，请重试。", true); }
    finally { exporting = false; if (!destroyed) button.disabled = false; }
  }
  function onClick(event) {
    if (event.target.closest("[data-character-start]")) start();
    else if (event.target.closest("[data-character-cancel]")) cancel();
    else if (event.target.closest("[data-character-copy]")) copy();
    else if (event.target.closest("[data-character-export]")) exportPng();
  }
  panel.addEventListener("click", onClick);
  function onChange(event) {
    if (event.target.matches("[data-character-online]")) {
      try { localStorage.setItem(onlineKey, String(event.target.checked)); } catch (_) {}
    }
  }
  panel.addEventListener("change", onChange);
  try {
    const saved = JSON.parse(localStorage.getItem(engine.resultKey) || "null");
    if (saved?.version === 3 && Array.isArray(saved.rows) && saved.sample) {
      const result = engine.rescore(saved);
      render(result); message("上次测试 · " + new Date(result.createdAt).toLocaleString("zh-CN"));
      localStorage.setItem(engine.resultKey, JSON.stringify(result));
    } else if (engine.legacyResultKeys.some(key => localStorage.getItem(key))) message("已保留旧版测试记录。新规则使用常听30首＋最近30首，请点击开始重新测试。");
  } catch (_) {}
  return {
    cancel,
    show(on) { panel.hidden = !on; if (!on) cancel(); else $("[data-character-start]").focus({ preventScroll: true }); },
    destroy() { destroyed = true; cancel(); panel.removeEventListener("click", onClick); panel.removeEventListener("change", onChange); panel.remove(); }
  };
}
