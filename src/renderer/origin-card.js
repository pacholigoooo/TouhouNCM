function mountOriginCard(ui, bridge, client) {
  const shadow = ui.shadowRoot;
  const view = shadow.querySelector(".immersion");
  const actions = shadow.querySelector(".header-actions");
  const doc = view.ownerDocument;
  const entry = doc.createElement("button");
  entry.type = "button";
  entry.className = "icon-button origin-entry";
  entry.setAttribute("aria-label", "东方工具");
  entry.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M9 12V7l4-1v5"/><ellipse cx="7.5" cy="12.5" rx="1.5" ry="1"/><ellipse cx="11.5" cy="11.5" rx="1.5" ry="1"/></svg>';
  entry.setAttribute("aria-haspopup", "dialog");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("aria-controls", "ncm-origin-card");
  actions.prepend(entry);

  const card = doc.createElement("section");
  card.id = "ncm-origin-card";
  card.className = "origin-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "ncm-origin-heading");
  card.innerHTML = `
    <header class="origin-header"><h2 id="ncm-origin-heading">东方工具</h2><button type="button" class="origin-close" data-origin-action="close" aria-label="关闭东方工具"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <nav class="origin-tabs" aria-label="东方音乐工具"><button type="button" data-origin-tab="origin" aria-pressed="true">原曲资料</button><button type="button" data-origin-tab="music" aria-pressed="false">东方找歌</button><button type="button" data-origin-tab="quiz" aria-pressed="false">测东方角色</button></nav>
    <div class="origin-body">
      <div data-origin-pane>
      <dl class="origin-current"><dt>当前曲</dt><dd><strong data-origin-current-title></strong><span data-origin-current-meta></span></dd></dl>
      <form class="origin-search" data-origin-search>
        <label for="ncm-origin-query">搜索关键词</label>
        <div class="origin-search-row"><input id="ncm-origin-query" type="search" autocomplete="off" spellcheck="false" maxlength="160" aria-describedby="ncm-origin-query-hint"><button type="submit" class="origin-button" data-origin-search-button>搜索</button></div>
        <p class="origin-hint" id="ncm-origin-query-hint">按曲名查找资料，可调整关键词后重试。</p>
      </form>
      <p class="origin-status" data-origin-status role="status" aria-live="polite"></p>
      <button type="button" class="origin-text-button" data-origin-action="retry" hidden>重试</button>
      <ul class="origin-candidates" data-origin-candidates aria-label="匹配候选" hidden></ul>
      <div class="origin-detail" data-origin-detail hidden>
        <h3 data-origin-detail-title></h3><p class="origin-album" data-origin-album></p>
        <dl class="origin-facts">
          <div><dt>原曲</dt><dd data-origin-field="originals"></dd></div>
          <div><dt>作品</dt><dd data-origin-field="works"></dd></div>
          <div><dt>社团</dt><dd data-origin-field="circles"></dd></div>
          <div><dt>编曲</dt><dd data-origin-field="arrangers"></dd></div>
          <div><dt>演唱</dt><dd data-origin-field="vocalists"></dd></div>
          <div><dt>资料出处</dt><dd><a class="origin-source" data-origin-source target="_blank" rel="noopener noreferrer" tabindex="0"><span data-origin-source-name>THBWiki</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6L10 14m-1-9H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4"/></svg></a></dd></div>
        </dl>
        <p class="origin-memory" data-origin-memory></p>
        <p class="origin-action-error" data-origin-action-error role="alert" hidden></p>
        <div class="origin-detail-actions">
          <button type="button" class="origin-button origin-confirm" data-origin-action="confirm">确认匹配并记住</button>
          <button type="button" class="origin-text-button" data-origin-action="back">返回候选</button>
          <button type="button" class="origin-text-button" data-origin-action="rematch" hidden>重新匹配</button>
          <button type="button" class="origin-text-button" data-origin-action="forget" hidden>清除记忆</button>
        </div>
      </div>
      </div>
    </div>`;
  view.appendChild(card);

  const $ = selector => card.querySelector(selector);
  const query = $("#ncm-origin-query");
  const searchForm = $("[data-origin-search]");
  const status = $("[data-origin-status]");
  const results = $("[data-origin-candidates]");
  const detailView = $("[data-origin-detail]");
  const actionError = $("[data-origin-action-error]");
  const button = name => $('[data-origin-action="' + name + '"]');
  let track = null, trackKey = "", opened = false, destroyed = false;
  let request = null, requestId = 0, candidates = [], detail = null, confirmed = false;
  let retry = null;
  let searchedQuery = "";
  let pane = "origin";
  const discovery = mountOriginDiscovery(card, bridge, client, () => setPane("music"), () => { close(false); ui.close(); });
  const quiz = mountCharacterQuiz(card, bridge, client, ui.writeClipboardText);

  function setPane(next) {
    cancel();
    discovery.cancel();
    card.removeAttribute("aria-busy");
    pane = next;
    $("[data-origin-pane]").hidden = next !== "origin";
    card.querySelectorAll("[data-origin-tab]").forEach(tab => {
      tab.setAttribute("aria-pressed", String(tab.dataset.originTab === next));
      tab.disabled = tab.dataset.originTab === "origin" && !track;
    });
    discovery.show(next === "music");
    quiz.show(next === "quiz");
  }

  function available() {
    const state = ui.getState();
    return !destroyed && state.open && !state.nativeDialogOpen && !state.settingsOpen && view.dataset.fullscreen !== "true";
  }

  function cancel() {
    requestId++;
    if (request) request.abort();
    request = null;
  }

  function close(restoreFocus = true) {
    if (!opened) return false;
    opened = false;
    cancel();
    discovery.cancel();
    quiz.cancel();
    card.hidden = true;
    card.removeAttribute("aria-busy");
    entry.setAttribute("aria-expanded", "false");
    if (restoreFocus && available()) entry.focus({ preventScroll: true });
    return true;
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
    status.hidden = !message;
  }

  function clearActionError() {
    actionError.hidden = true;
    actionError.textContent = "";
  }

  function showActionError(message, error) {
    actionError.textContent = message + (error && error.message ? "：" + error.message : "");
    actionError.hidden = false;
  }

  function setLoading(message) {
    detailView.hidden = true;
    results.hidden = true;
    button("retry").hidden = true;
    card.setAttribute("aria-busy", "true");
    setStatus(message);
    clearActionError();
  }

  async function run(operation, onResult, retryOperation) {
    cancel();
    const controller = new AbortController();
    request = controller;
    const id = requestId, key = trackKey;
    const current = () => opened && available() && key === trackKey && id === requestId;
    retry = retryOperation;
    try {
      const value = await operation(controller.signal);
      if (current()) onResult(value);
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      setStatus(error.message || "暂时无法读取资料，请重试。", true);
      button("retry").hidden = false;
    } finally {
      if (current()) {
        request = null;
        card.removeAttribute("aria-busy");
      }
    }
  }

  function renderCandidates() {
    results.replaceChildren();
    candidates.forEach((candidate, index) => {
      const item = doc.createElement("li"), choice = doc.createElement("button");
      choice.type = "button";
      choice.className = "origin-candidate";
      choice.dataset.originCandidate = String(index);
      const title = doc.createElement("strong"), album = doc.createElement("span");
      const people = doc.createElement("span"), match = doc.createElement("small");
      title.textContent = candidate.title;
      album.textContent = candidate.album || "专辑未标注";
      people.textContent = [...new Set([...(candidate.circles || []), ...(candidate.artists || [])])].join(" · ") || "社团 / 艺人未标注";
      const labels = { exact: "一致", partial: "接近", none: "不同", unknown: "未提供" };
      const evidence = candidate.match || {};
      const titleMatch = evidence.title === "main" ? "主曲名一致 · 版本标注不同" : "曲名" + (labels[evidence.title] || "未提供");
      match.textContent = titleMatch + " · 专辑" + (labels[evidence.album] || "未提供") + " · 艺人" + (labels[evidence.artist] || "未提供");
      choice.append(title, album, people, match);
      item.appendChild(choice);
      results.appendChild(item);
    });
  }

  function showCandidates() {
    cancel();
    detail = null;
    discovery.setDetail(null);
    confirmed = false;
    detailView.hidden = true;
    searchForm.hidden = false;
    button("retry").hidden = true;
    card.removeAttribute("aria-busy");
    results.hidden = !candidates.length;
    setStatus(candidates.length ? "找到 " + candidates.length + " 条候选，请核对专辑和社团后选择。" : "未找到匹配资料。可以修改关键词再搜索。");
  }

  function search() {
    if (!opened || !track || !available()) return;
    const term = query.value.trim();
    if (!term) {
      query.focus();
      setStatus("请输入曲名或关键词后搜索。");
      return;
    }
    searchedQuery = term;
    candidates = [];
    detail = null;
    discovery.setDetail(null);
    confirmed = false;
    searchForm.hidden = false;
    setLoading("正在 THBWiki 中查找相关曲目…");
    const currentTitle = window.NcmTouhouNames.splitTitle(track.title).title;
    const automatic = term === currentTitle;
    run(signal => client.search(track, automatic ? {signal} : {signal, query: term}), value => {
      candidates = value;
      renderCandidates();
      showCandidates();
    }, search);
  }

  function renderDetail(value, saved) {
    detail = value;
    confirmed = saved;
    detailView.hidden = false;
    results.hidden = true;
    searchForm.hidden = true;
    button("retry").hidden = true;
    setStatus("");
    clearActionError();
    $("[data-origin-detail-title]").textContent = value.title;
    $("[data-origin-album]").textContent = value.album || "专辑未标注";
    card.querySelectorAll("[data-origin-field]").forEach(field => {
      const values = value[field.dataset.originField] || [];
      field.replaceChildren();
      if (!values.length) field.textContent = "资料未标注";
      else values.forEach(text => {
        const line = doc.createElement("span");
        line.textContent = text;
        field.appendChild(line);
      });
    });
    const source = $("[data-origin-source]");
    $("[data-origin-source-name]").textContent = value.source || "THBWiki";
    // Links are the only data that enter an attribute; keep them on the source site.
    if (/^https:\/\/thwiki\.cc\//i.test(value.sourceUrl || "")) {
      source.href = value.sourceUrl;
      source.removeAttribute("aria-disabled");
      source.setAttribute("tabindex", "0");
    } else {
      source.removeAttribute("href");
      source.setAttribute("aria-disabled", "true");
      source.setAttribute("tabindex", "-1");
    }
    $("[data-origin-memory]").textContent = saved ? "已在本机记住此匹配。" : "请核对资料，确认后会在本机记住此匹配。";
    button("confirm").hidden = saved;
    button("back").hidden = saved;
    button("rematch").hidden = !saved;
    button("forget").hidden = !saved;
    discovery.setDetail(value);
  }

  function loadDetail(candidate) {
    setLoading("正在读取曲目与原曲资料…");
    run(signal => client.detail(candidate, { signal }), value => renderDetail(value, false), () => loadDetail(candidate));
  }

  function open() {
    if (opened || !available()) return;
    opened = true;
    card.hidden = false;
    entry.setAttribute("aria-expanded", "true");
    query.value = track ? window.NcmTouhouNames.splitTitle(track.title).title : "";
    $("[data-origin-current-title]").textContent = track?.title || "";
    $("[data-origin-current-meta]").textContent = track ? [...(track.artists || []), track.album].filter(Boolean).join(" · ") : "";
    candidates = [];
    detail = null;
    confirmed = false;
    detailView.hidden = true;
    results.hidden = true;
    button("retry").hidden = true;
    setStatus("");
    clearActionError();
    discovery.setDetail(null);
    setPane(track ? "origin" : "music");
    if (!track) return;
    try {
      const saved = client.getSaved(track.id);
      if (saved) renderDetail(saved, true);
      else search();
    } catch (error) {
      detailView.hidden = true;
      results.hidden = true;
      searchForm.hidden = false;
      setStatus("无法读取本机匹配记录" + (error.message ? "：" + error.message : ""), true);
      retry = search;
      button("retry").hidden = false;
    }
    button("close").focus({ preventScroll: true });
  }

  function onEntryClick() {
    if (opened) close();
    else {
      if (ui.getState().settingsOpen) ui.closeSettings();
      open();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    search();
  }

  function onQueryInput() {
    if (query.value.trim() === searchedQuery) return;
    cancel();
    searchedQuery = "";
    candidates = [];
    detail = null;
    confirmed = false;
    retry = null;
    discovery.setDetail(null);
    results.replaceChildren();
    results.hidden = detailView.hidden = true;
    button("retry").hidden = true;
    card.removeAttribute("aria-busy");
    clearActionError();
    setStatus("关键词已修改，请重新搜索。");
  }

  function onClick(event) {
    if (!available()) return;
    const tab = event.target.closest("[data-origin-tab]");
    if (tab) {
      if (tab.disabled || tab.dataset.originTab === pane) return;
      setPane(tab.dataset.originTab);
      if (pane === "origin" && !detail) {
        if (candidates.length) showCandidates();
        else search();
      }
      return;
    }
    const choice = event.target.closest("[data-origin-candidate]");
    if (choice) {
      const candidate = candidates[Number(choice.dataset.originCandidate)];
      if (candidate) loadDetail(candidate);
      return;
    }
    const action = event.target.closest("[data-origin-action]");
    if (!action) return;
    switch (action.dataset.originAction) {
      case "close": close(); break;
      case "retry": if (retry) retry(); break;
      case "back": showCandidates(); query.focus(); break;
      case "rematch":
        discovery.setDetail(null);
        detail = null;
        searchForm.hidden = false;
        detailView.hidden = true;
        setStatus("修改关键词后搜索，重新选择正确的曲目。");
        query.focus(); query.select();
        break;
      case "confirm":
        if (!detail || confirmed || !track) break;
        try { renderDetail(client.save(track.id, detail), true); button("rematch").focus(); }
        catch (error) { showActionError("无法在本机记住此匹配", error); }
        break;
      case "forget":
        if (!track) break;
        try {
          client.forget(track.id);
          detail = null;
          discovery.setDetail(null);
          confirmed = false;
          detailView.hidden = true;
          searchForm.hidden = false;
          setStatus("已清除本机匹配记录。可以修改关键词后重新搜索。");
          query.focus();
        } catch (error) { showActionError("无法清除本机匹配记录", error); }
        break;
    }
  }

  function sync(snapshot) {
    const next = snapshot && snapshot.track;
    const key = next ? JSON.stringify([next.id, next.title, next.album, next.artists]) : "";
    if (key === trackKey) return;
    if (pane !== "quiz") close(false);
    trackKey = key;
    track = next ? { ...next, artists: [...(next.artists || [])] } : null;
    if (opened && pane === "quiz") {
      query.value = track ? window.NcmTouhouNames.splitTitle(track.title).title : "";
      $("[data-origin-current-title]").textContent = track?.title || "";
      $("[data-origin-current-meta]").textContent = track ? [...(track.artists || []), track.album].filter(Boolean).join(" · ") : "";
      candidates = []; detail = null; confirmed = false;
      detailView.hidden = results.hidden = true;
      discovery.setDetail(null);
    }
    entry.title = "东方工具";
  }

  entry.title = "东方工具";
  entry.addEventListener("click", onEntryClick);
  card.addEventListener("click", onClick);
  searchForm.addEventListener("submit", onSubmit);
  query.addEventListener("input", onQueryInput);
  const stopEscape = ui.onBeforeEscape(() => opened && available() && close());
  const observer = new MutationObserver(() => { if (opened && !available()) close(false); });
  observer.observe(view, { attributes: true, attributeFilter: ["hidden", "data-open", "data-settings-only", "data-fullscreen"] });
  observer.observe(shadow.querySelector(".settings-panel"), { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(ui.host || shadow.host, { attributes: true, attributeFilter: ["data-native-dialog-open"] });
  sync(bridge.getSnapshot());
  const unsubscribe = bridge.subscribe(sync);

  return {
    destroy() {
      if (destroyed) return;
      close(false);
      destroyed = true;
      cancel();
      discovery.destroy();
      quiz.destroy();
      unsubscribe();
      stopEscape();
      observer.disconnect();
      entry.removeEventListener("click", onEntryClick);
      card.removeEventListener("click", onClick);
      searchForm.removeEventListener("submit", onSubmit);
      query.removeEventListener("input", onQueryInput);
      entry.remove();
      card.remove();
    }
  };
}
