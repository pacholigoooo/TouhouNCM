(function (host) {
  "use strict";
  const INTERVAL = 12 * 60 * 60 * 1000;
  const PREFIX = "touhouncm.updates.";
  const MIRROR = "https://www.touhou-life.top/updates/touhouncm/latest.json";

  function compareVersions(left, right) {
    const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
    const a = parse(left), b = parse(right);
    if (!a || !b) throw new Error("版本号格式无效");
    for (let i = 1; i <= 3; i++) {
      const delta = Number(a[i]) - Number(b[i]);
      if (delta) return Math.sign(delta);
    }
    return 0;
  }

  function create(config, changed) {
    const storage = host.localStorage;
    const read = key => { try { return storage.getItem(PREFIX + key); } catch (_) { return null; } };
    const write = (key, value) => { try { storage.setItem(PREFIX + key, String(value)); } catch (_) {} };
    let automatic = read("automatic") !== "off";
    let state = { status: "idle", version: config.version, automatic };
    let timer = null, controller = null, request = null, disposed = false;
    const publish = patch => {
      if (disposed) return;
      state = Object.assign({}, state, patch, { automatic });
      changed(state);
    };
    function schedule(delay) {
      host.clearTimeout(timer);
      timer = null;
      if (automatic && !disposed) timer = host.setTimeout(check, delay);
    }
    const github = "https://api.github.com/repos/" + config.repository + "/releases/latest";
    const releaseUrl = tag => "https://github.com/" + config.repository + "/releases/tag/" + tag;
    async function readRelease(address) {
      const attempt = new host.AbortController();
      controller = attempt;
      const timeout = host.setTimeout(() => attempt.abort(), 8000);
      try {
        const response = await host.fetch(address, {
          signal: attempt.signal, credentials: "omit", cache: "no-store", redirect: "error",
          headers: { Accept: "application/json" }
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("HTTP " + response.status);
        const release = await response.json();
        if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) ||
            release.draft || release.prerelease || release.html_url !== releaseUrl(release.tag_name)) {
          throw new Error("发布信息无效");
        }
        return release;
      } finally {
        host.clearTimeout(timeout);
        if (controller === attempt) controller = null;
      }
    }
    async function fetchRelease() {
      publish({ status: "checking", message: "正在检查更新…" });
      write("attempt", Date.now());
      let missing = 0;
      for (const address of [github, MIRROR]) {
        if (disposed) return;
        try {
          const release = await readRelease(address);
          if (disposed) return;
          if (!release) { missing++; continue; }
          const tag = release.tag_name, url = release.html_url, source = address === MIRROR ? "mirror" : "github";
          const newer = compareVersions(tag, config.version) > 0;
          write("release", JSON.stringify({ tag, url, source }));
          publish({ status: newer ? "available" : "current", latest: tag, url, source,
            message: newer ? "新版 " + tag + " 已发布" : "已是最新版本" });
          return;
        } catch (_) { if (disposed) return; }
      }
      if (missing === 2) publish({ status: "unpublished", message: "发布页准备中", url: "", latest: "" });
      else publish({ status: "error", message: "更新源暂时无法访问，可重试或前往百度网盘。" });
    }
    function check() {
      if (disposed) return Promise.resolve();
      if (request) return request;
      host.clearTimeout(timer);
      request = fetchRelease().finally(() => { request = null; schedule(state.status === "error" ? 30 * 60 * 1000 : INTERVAL); });
      return request;
    }
    function setAutomatic(value) {
      automatic = !!value;
      write("automatic", automatic ? "on" : "off");
      publish({});
      schedule(8000);
    }
    try {
      const cached = JSON.parse(read("release"));
      if (cached && cached.url === releaseUrl(cached.tag) && compareVersions(cached.tag, config.version) > 0) {
        state = Object.assign(state, { status: "available", latest: cached.tag, url: cached.url,
          source: cached.source === "mirror" ? "mirror" : "github", message: "新版 " + cached.tag + " 已发布" });
      }
    } catch (_) {}
    const elapsed = Date.now() - Number(read("attempt") || 0);
    schedule(state.status !== "available" && elapsed >= 0 && elapsed < INTERVAL ? Math.max(8000, INTERVAL - elapsed) : 8000);
    return { check, setAutomatic, retryLater: () => schedule(30 * 60 * 1000), getState: () => state, destroy() {
      disposed = true; host.clearTimeout(timer); controller?.abort();
    } };
  }
  host.NcmUpdates = { create, compareVersions };
})(window);

function mountUpdateSettings(ui, config) {
  const netdiskUrl = "https://pan.baidu.com/s/59iNZvDIhNRovi_kg5-X7-g";
  const section = document.createElement("details");
  section.className = "settings-group";
  section.setAttribute("data-update-group", "");
  section.innerHTML = `<summary>TouhouNCM 更新</summary>
    <label class="setting-row"><span class="setting-copy"><span>自动更新</span><small data-version></small></span><input type="checkbox" data-update-auto></label>
    <p class="setting-description" data-update-status role="status" aria-live="polite"></p>
    <div class="theme-actions"><button type="button" class="settings-text-button" data-update-check>检查更新</button><button type="button" class="settings-text-button" data-update-install hidden>下载并在退出时更新</button><a class="settings-text-button" data-update-link target="_blank" rel="noopener noreferrer" hidden>查看发布页</a><a class="settings-text-button" data-update-netdisk href="${netdiskUrl}" target="_blank" rel="noopener noreferrer">百度网盘下载</a></div>
    <p class="setting-description" data-update-fallback hidden style="user-select:text;overflow-wrap:anywhere"></p>`;
  ui.shadowRoot.querySelector(".keyboard-hints").before(section);
  const auto = section.querySelector("[data-update-auto]"), button = section.querySelector("[data-update-check]");
  const link = section.querySelector("[data-update-link]"), status = section.querySelector("[data-update-status]");
  const netdisk = section.querySelector("[data-update-netdisk]");
  const fallback = section.querySelector("[data-update-fallback]");
  const install = section.querySelector("[data-update-install]");
  let disposed = false;
  let native = null, command = "", attempted = "";
  section.querySelector("[data-version]").textContent = "当前版本 " + config.version;
  function render(state) {
    const available = state.status === "available";
    const ready = native?.phase === "ready";
    const downloading = native?.phase === "downloading" || command === "download";
    if (state.status === "checking") attempted = "";
    if (available && state.automatic && native && native.phase !== "portable" && !command && !downloading &&
        (!ready || native.latest !== state.latest) && attempted !== state.latest) {
      attempted = state.latest;
      queue("download");
    }
    auto.checked = state.automatic;
    button.disabled = state.status === "checking" || downloading || command === "download";
    const active = ready || downloading || command === "download";
    install.hidden = !native || native.phase === "portable" || (!active && (!available || button.disabled));
    install.disabled = command === "cancel";
    install.textContent = active ? "取消本次更新" : native?.phase === "error" ? "重试下载" : "下载并在退出时更新";
    let message = state.message || (state.automatic ? "每 12 小时检查一次，后台下载，在退出网易云时安装。" : "自动更新已关闭，可随时检查新版。");
    if (command === "cancel") message = "已取消本次更新。";
    else if (downloading || command === "download") message = "正在后台下载新版，可以继续听歌。";
    else if (ready) message = native.latest + " 已下载。下次从托盘退出网易云时会自动安装。";
    else if (available && native?.phase === "error") message = "新版下载失败，可重试或前往百度网盘。";
    else if (available && native?.phase === "portable") message = "当前从便携目录运行，可在发布页获取 Windows 安装包。";
    else if (available && native?.phase === "current") message = "已是最新正式版本。";
    status.textContent = message;
    link.hidden = !state.url;
    if (state.url) link.href = state.url;
    else link.removeAttribute("href");
    document.documentElement.toggleAttribute("data-touhouncm-update", available || ready);
  }
  const checker = window.NcmUpdates.create(config, render);
  function queue(value) {
    command = value;
    try { window.__pachiNcmImmersiveNativeWake?.("updates"); } catch (_) {}
  }
  function nativeSync(snapshot) {
    if (disposed) return "";
    if (snapshot.phase === "error" && native?.phase !== "error") checker.retryLater();
    native = snapshot;
    render(checker.getState());
    const next = command;
    command = "";
    return next === "download" && checker.getState().source === "mirror" ? "download-mirror" : next;
  }
  function download() {
    attempted = checker.getState().latest;
    queue(command === "download" || native?.phase === "ready" || native?.phase === "downloading" ? "cancel" : "download");
    render(checker.getState());
  }
  const check = () => checker.check();
  function toggle() {
    attempted = "";
    if (!auto.checked) queue("cancel");
    checker.setAutomatic(auto.checked);
  }
  async function openLink(event, url, name) {
    // CEF does not route an ordinary target=_blank link to the system browser.
    event.preventDefault();
    if (!url) return;
    fallback.hidden = true;
    fallback.textContent = "";
    try {
      await window.NcmClientApi.openExternal(url);
      if (!disposed) status.textContent = "已在系统浏览器打开" + name + "。";
    } catch (_) {
      if (disposed) return;
      status.textContent = "未能打开系统浏览器。请复制下方地址到浏览器中下载：";
      fallback.textContent = url;
      fallback.hidden = false;
    }
  }
  const openRelease = event => openLink(event, checker.getState().url, "发布页");
  const openNetdisk = event => openLink(event, netdiskUrl, "百度网盘");
  button.addEventListener("click", check);
  install.addEventListener("click", download);
  auto.addEventListener("change", toggle);
  link.addEventListener("click", openRelease);
  netdisk.addEventListener("click", openNetdisk);
  render(checker.getState());
  return { check, nativeSync, getState: checker.getState, destroy() {
    disposed = true;
    checker.destroy(); button.removeEventListener("click", check); auto.removeEventListener("change", toggle);
    install.removeEventListener("click", download);
    link.removeEventListener("click", openRelease);
    netdisk.removeEventListener("click", openNetdisk);
    section.remove(); document.documentElement.removeAttribute("data-touhouncm-update");
  } };
}
