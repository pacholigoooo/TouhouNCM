function mountOriginDiscovery(card, bridge, client, showMusic, onNavigate) {
  const doc = card.ownerDocument;
  const names = window.NcmTouhouNames;
  const music = doc.createElement("section");
  music.className = "origin-music";
  music.hidden = true;
  music.innerHTML = `
    <form data-music-form class="origin-search">
      <label for="ncm-music-query">曲名、歌手或社团</label>
      <div class="origin-search-row"><input id="ncm-music-query" type="search" maxlength="160" placeholder="例如：发热巫女" autocomplete="off" aria-describedby="ncm-music-alias"><button class="origin-button" type="submit">搜索</button></div>
      <p class="origin-hint" id="ncm-music-alias">支持社团中文别名，也可以直接输入日文曲名。</p>
    </form>
    <p class="origin-status" data-music-status role="status" aria-live="polite"></p>
    <ul class="origin-song-list" data-music-results aria-label="网易云曲目"></ul>
    <button type="button" class="origin-text-button" data-music-more hidden>更多社团曲目</button>
    <button type="button" class="origin-text-button" data-music-native hidden>在网易云中查看更多</button>`;
  card.querySelector(".origin-body").appendChild(music);
  const related = doc.createElement("section");
  related.className = "origin-related";
  related.hidden = true;
  related.innerHTML = `
    <h3>同原曲，不同改编</h3>
    <label class="origin-related-picker" for="ncm-related-original">原曲<select id="ncm-related-original" class="font-select"></select></label>
    <button type="button" class="origin-button" data-related-load>查看其他改编</button>
    <p class="origin-status" data-related-status role="status" aria-live="polite" hidden></p>
    <ul class="origin-song-list" data-related-results aria-label="同原曲改编"></ul>
    <button type="button" class="origin-text-button" data-related-more hidden>加载更多</button>`;
  card.querySelector("[data-origin-detail]").appendChild(related);

  const $ = selector => music.querySelector(selector);
  const r = selector => related.querySelector(selector);
  const input = $("#ncm-music-query"), hint = $("#ncm-music-alias");
  const select = r("select"), more = r("[data-related-more]");
  let detail = null, relatedRows = [], songs = [], offset = 0;
  let relatedRequest = null, musicRequest = null, generation = 0, destroyed = false;
  let lastQuery = "";
  let searchedInput = "";
  let catalog = [], catalogIntent = null, catalogOffset = null;
  let selectedTrack = null, selectedQuery = "";
  const pendingAdds = new Set();
  const normalized = value => String(value || "").normalize("NFKC").toLowerCase().replace(/\s/g, "");
  const message = (node, text, error = false) => {
    node.textContent = text;
    node.hidden = !text;
    node.dataset.error = String(error);
  };
  const row = (title, subtitle) => {
    const item = doc.createElement("li"), copy = doc.createElement("div");
    const heading = doc.createElement("strong"), meta = doc.createElement("span");
    heading.textContent = title;
    meta.textContent = subtitle;
    copy.className = "origin-song-copy";
    copy.append(heading, meta);
    item.appendChild(copy);
    return item;
  };
  const action = (label, attribute, value) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "origin-button";
    button.textContent = label;
    button.setAttribute(attribute, value);
    return button;
  };

  function aliasHint() {
    const match = names.circleQuery(input.value);
    if (selectedTrack && input.value.trim() === selectedQuery) {
      hint.textContent = "对应资料：" + [selectedTrack.title, selectedTrack.album, ...(selectedTrack.vocalists || [])].filter(Boolean).join(" · ");
    } else hint.textContent = match ? "查询 " + match.canonical + " 的曲目目录" : "支持社团中文别名，也可以直接输入日文曲名。";
  }

  function cancel() {
    generation++;
    if (relatedRequest) {
      relatedRequest.abort();
      if (!relatedRows.length) r("[data-related-load]").hidden = false;
      message(r("[data-related-status]"), relatedRows.length ? "查询已取消，可以继续加载。" : "查询已取消，可以重新查看其他改编。");
    }
    if (musicRequest) {
      musicRequest.abort();
      message($("[data-music-status]"), "搜索已取消，可以重新搜索。");
    }
    relatedRequest = musicRequest = null;
    r("[data-related-load]").disabled = more.disabled = false;
    music.querySelector('[type="submit"]').disabled = false;
    $("[data-music-more]").disabled = false;
  }

  function setDetail(value) {
    if (relatedRequest) relatedRequest.abort();
    relatedRequest = null;
    detail = value;
    relatedRows = [];
    offset = 0;
    related.hidden = !value || !value.originals?.length;
    r("[data-related-results]").replaceChildren();
    message(r("[data-related-status]"), "");
    more.hidden = true;
    r("[data-related-load]").hidden = false;
    r("[data-related-load]").disabled = false;
    select.replaceChildren();
    for (const name of [...new Set(value?.originals || [])]) {
      const option = doc.createElement("option");
      option.value = option.textContent = name;
      select.appendChild(option);
    }
  }

  async function loadRelated(append = false) {
    if (!detail || !select.value || destroyed) return;
    if (relatedRequest) relatedRequest.abort();
    const request = relatedRequest = new AbortController(), currentDetail = detail, original = select.value;
    const current = () => !destroyed && relatedRequest === request && detail === currentDetail && select.value === original;
    r("[data-related-load]").disabled = more.disabled = true;
    message(r("[data-related-status]"), "正在查找同原曲改编…");
    if (!append) { relatedRows = []; offset = 0; r("[data-related-results]").replaceChildren(); more.hidden = true; }
    try {
      const result = await client.related(original, {signal: request.signal, offset});
      if (!current()) return;
      const seen = new Set(relatedRows.map(item => item.id));
      for (const item of result.items) {
        if (seen.has(item.id) || normalized(item.title) === normalized(detail.title) && normalized(item.album) === normalized(detail.album)) continue;
        seen.add(item.id);
        relatedRows.push(item);
        const li = row(item.title, [...(item.circles || []), item.album].filter(Boolean).join(" · "));
        const actions = doc.createElement("div");
        actions.className = "origin-song-actions";
        actions.appendChild(action("找网易云版本", "data-related-song", String(relatedRows.length - 1)));
        if (/^https:\/\/thwiki\.cc\//i.test(item.sourceUrl || "")) {
          const source = doc.createElement("a");
          source.className = "origin-text-button";
          source.href = item.sourceUrl;
          source.target = "_blank";
          source.rel = "noopener noreferrer";
          source.textContent = "资料";
          actions.appendChild(source);
        }
        li.appendChild(actions);
        r("[data-related-results]").appendChild(li);
      }
      offset = result.nextOffset;
      more.hidden = !result.hasMore;
      r("[data-related-load]").hidden = true;
      message(r("[data-related-status]"), relatedRows.length ? "已列出 " + relatedRows.length + " 个改编版本 · 资料来自 THBWiki" : "这一页暂无其他改编。" + (result.hasMore ? "可继续加载。" : ""));
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      message(r("[data-related-status]"), error.message || "改编资料暂时无法读取，请重试。", true);
      if (!append) r("[data-related-load]").hidden = false;
    } finally {
      if (current()) { relatedRequest = null; r("[data-related-load]").disabled = more.disabled = false; }
    }
  }

  function renderCatalog(items) {
    const seen = new Set(catalog.map(item => item.id));
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      catalog.push(item);
      const li = row(item.title, [item.album, (item.artists || []).join(" / ")].filter(Boolean).join(" · "));
      li.appendChild(action("找网易云版本", "data-music-catalog", String(catalog.length - 1)));
      $("[data-music-results]").appendChild(li);
    }
  }

  function catalogStatus(result) {
    let text = catalog.length ? catalogIntent.canonical + " · 已列出 " + catalog.length + " 首 · 选择曲目查找网易云版本" : result.hasMore ? "本页未找到该社团的曲目，可继续加载。" : "该社团目录中没有匹配曲目，请核对社团与曲名。";
    if (result.searchLimited) {
      text = (catalog.length ? text + "。" : "") + "本次核验了前 30 个曲名候选；输入更完整的曲名，或只搜社团名浏览目录。";
    }
    message($("[data-music-status]"), text);
  }

  async function moreCatalog() {
    if (!catalogIntent || catalogOffset == null || musicRequest) return;
    const request = musicRequest = new AbortController();
    const current = () => !destroyed && musicRequest === request;
    $("[data-music-more]").disabled = true;
    try {
      const result = await client.circleTracks(catalogIntent.canonical, {query: catalogIntent.query, signal: request.signal, offset: catalogOffset});
      if (!current()) return;
      renderCatalog(result.items);
      catalogOffset = result.nextOffset;
      $("[data-music-more]").hidden = !result.hasMore;
      catalogStatus(result);
    } catch (error) {
      if (current() && error.name !== "AbortError") message($("[data-music-status]"), error.message || "曲目目录读取失败，请重试。", true);
    } finally {
      if (current()) { musicRequest = null; $("[data-music-more]").disabled = false; }
    }
  }

  async function search(term, target) {
    if (typeof term === "string") input.value = term.slice(0, 160);
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    if (target) { selectedTrack = target; selectedQuery = typed; }
    else if (typed !== selectedQuery) selectedTrack = null;
    aliasHint();
    if (musicRequest) musicRequest.abort();
    const request = musicRequest = new AbortController();
    const current = () => !destroyed && musicRequest === request;
    const wanted = selectedTrack;
    catalogIntent = wanted ? null : names.circleQuery(typed);
    lastQuery = typed;
    searchedInput = typed;
    songs = [];
    catalog = [];
    catalogOffset = null;
    $("[data-music-results]").replaceChildren();
    $("[data-music-results]").setAttribute("aria-label", catalogIntent ? "社团曲目目录" : "网易云曲目");
    $("[data-music-native]").hidden = true;
    $("[data-music-more]").hidden = true;
    music.querySelector('[type="submit"]').disabled = true;
    message($("[data-music-status]"), catalogIntent ? "正在查询社团曲目目录…" : "正在搜索网易云曲目…");
    try {
      if (catalogIntent) {
        const result = await client.circleTracks(catalogIntent.canonical, {query: catalogIntent.query, signal: request.signal});
        if (!current()) return;
        renderCatalog(result.items);
        catalogOffset = result.nextOffset;
        $("[data-music-more]").hidden = !result.hasMore;
        catalogStatus(result);
        return;
      }
      let result = await bridge.searchSongs(lastQuery, {signal: request.signal});
      if (!current()) return;
      songs = wanted ? names.matchVersions(result, wanted) : result;
      if (wanted && !songs.length && wanted.album) {
        const albumQuery = [names.splitTitle(wanted.title).title, wanted.album].join(" ").slice(0, 160);
        if (albumQuery !== lastQuery) {
          lastQuery = albumQuery;
          result = await bridge.searchSongs(albumQuery, {signal: request.signal});
          if (!current()) return;
          songs = names.matchVersions(result, wanted);
        }
      }
      for (const song of songs) {
        const seconds = Math.round((song.durationMs || 0) / 1000);
        const time = seconds ? Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "";
        const item = row(song.title, [(song.artists || []).join(" / "), song.album, time].filter(Boolean).join(" · "));
        const pending = pendingAdds.has(String(song.id));
        const add = action(pending ? "正在加入…" : "加入队列", "data-music-add", String(song.id));
        add.disabled = pending;
        item.appendChild(add);
        $("[data-music-results]").appendChild(item);
      }
      message($("[data-music-status]"), wanted ? (songs.length ? "匹配到 " + songs.length + " 个版本 · 优先显示原专辑" : "未匹配到这首改编的网易云版本，可打开网易云搜索页继续查找。") : (songs.length ? "找到 " + songs.length + " 首，请核对歌手与专辑后加入。" : "未找到曲目，可以减少关键词再试。"));
      $("[data-music-native]").hidden = !!catalogIntent || typeof bridge.openSearch !== "function";
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      message($("[data-music-status]"), error.message || "网易云搜索暂时不可用，请重试。", true);
      $("[data-music-native]").hidden = !!catalogIntent || typeof bridge.openSearch !== "function";
    } finally {
      if (current()) { musicRequest = null; music.querySelector('[type="submit"]').disabled = false; }
    }
  }

  async function addSong(button) {
    const id = button.dataset.musicAdd;
    if (pendingAdds.has(id) || !songs.some(song => String(song.id) === id)) return;
    const version = generation;
    pendingAdds.add(id);
    button.disabled = true;
    button.textContent = "正在加入…";
    try {
      const result = await bridge.enqueueSong(id);
      if (!result?.ok) throw new Error(result?.error || "加入队列失败，请重试。");
      if (!destroyed && version === generation && button.isConnected) message($("[data-music-status]"), result.alreadyQueued ? "已在队列中。" : "已加入播放队列。");
    } catch (error) {
      if (destroyed || version !== generation || !button.isConnected) return;
      message($("[data-music-status]"), error.message || "加入队列失败，请重试。", true);
    } finally {
      pendingAdds.delete(id);
      if (!destroyed) {
        // A newer search can render the same version while this add is pending.
        for (const current of music.querySelectorAll("[data-music-add]")) {
          if (current.dataset.musicAdd !== id) continue;
          current.disabled = false;
          current.textContent = "加入队列";
        }
      }
    }
  }

  function onClick(event) {
    const node = event.target.closest("button");
    if (!node) return;
    if (node.hasAttribute("data-related-load")) loadRelated();
    else if (node.hasAttribute("data-related-more")) loadRelated(true);
    else if (node.hasAttribute("data-related-song") || node.hasAttribute("data-music-catalog")) {
      const item = node.hasAttribute("data-related-song") ? relatedRows[Number(node.dataset.relatedSong)] : catalog[Number(node.dataset.musicCatalog)];
      if (!item) return;
      showMusic();
      search([names.splitTitle(item.title).title, (item.vocalists || [])[0] || item.album || (item.artists || [])[0]].filter(Boolean).join(" "), item);
    } else if (node.hasAttribute("data-music-more")) moreCatalog();
    else if (node.hasAttribute("data-music-add")) addSong(node);
    else if (node.hasAttribute("data-music-native") && lastQuery) {
      Promise.resolve(bridge.openSearch(lastQuery)).then(result => {
        if (destroyed) return;
        if (result?.ok) onNavigate();
        else message($("[data-music-status]"), result?.error || "搜索页暂时无法打开。", true);
      }).catch(error => { if (!destroyed) message($("[data-music-status]"), error.message, true); });
    }
  }
  function onSubmit(event) { event.preventDefault(); search(); }
  function onInput() {
    if (input.value.trim() !== searchedInput && lastQuery) {
      cancel();
      lastQuery = searchedInput = selectedQuery = "";
      selectedTrack = catalogIntent = catalogOffset = null;
      songs = []; catalog = [];
      $("[data-music-results]").replaceChildren();
      $("[data-music-native]").hidden = $("[data-music-more]").hidden = true;
      message($("[data-music-status]"), "关键词已修改，请重新搜索。");
    }
    aliasHint();
  }
  function onOriginal() { loadRelated(); }
  related.addEventListener("click", onClick);
  music.addEventListener("click", onClick);
  music.querySelector("form").addEventListener("submit", onSubmit);
  select.addEventListener("change", onOriginal);
  input.addEventListener("input", onInput);
  return {
    setDetail, cancel,
    show(on) { music.hidden = !on; if (on) input.focus({preventScroll: true}); },
    destroy() {
      destroyed = true;
      cancel();
      related.removeEventListener("click", onClick);
      music.removeEventListener("click", onClick);
      music.querySelector("form").removeEventListener("submit", onSubmit);
      select.removeEventListener("change", onOriginal);
      input.removeEventListener("input", onInput);
      related.remove(); music.remove(); pendingAdds.clear();
    }
  };
}
