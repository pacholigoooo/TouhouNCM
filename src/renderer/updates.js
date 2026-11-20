(function (host) {
  "use strict";
  const INTERVAL = 12 * 60 * 60 * 1000;
  const PREFIX = "touhouncm.updates.";

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
    async function fetchRelease() {
      controller = new host.AbortController();
      const timeout = host.setTimeout(() => controller?.abort(), 12000);
      publish({ status: "checking", message: "正在检查更新…" });
      write("attempt", Date.now());
      try {
        const response = await host.fetch("https://api.github.com/repos/" + config.repository + "/releases/latest", {
          signal: controller.signal, credentials: "omit", headers: { Accept: "application/vnd.github+json" }
        });
        if (response.status === 404) {
          publish({ status: "unpublished", message: "发布页准备中", url: "", latest: "" });
          return;
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const release = await response.json();
        const url = new URL(release.html_url);
        if (release.draft || release.prerelease || url.origin !== "https://github.com" ||
            !url.pathname.startsWith("/" + config.repository + "/releases/tag/")) throw new Error("发布信息无效");
        const newer = compareVersions(release.tag_name, config.version) > 0;
        const result = { status: newer ? "available" : "current", latest: release.tag_name,
          url: url.href, message: newer ? "新版 " + release.tag_name + " 已发布" : "已是最新版本" };
        write("release", JSON.stringify({ tag: release.tag_name, url: url.href }));
        publish(result);
      } catch (error) {
        if (!disposed) publish({ status: "error", message: "暂时无法检查更新，稍后可重试" });
      } finally {
        host.clearTimeout(timeout);
        controller = null;
      }
    }
    function check() {
      if (disposed) return Promise.resolve();
      if (request) return request;
      host.clearTimeout(timer);
      request = fetchRelease().finally(() => { request = null; schedule(INTERVAL); });
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
      const url = new URL(cached?.url);
      if (compareVersions(cached.tag, config.version) > 0 && url.origin === "https://github.com" &&
          url.pathname.startsWith("/" + config.repository + "/releases/tag/")) {
        state = Object.assign(state, { status: "available", latest: cached.tag, url: url.href, message: "新版 " + cached.tag + " 已发布" });
      }
    } catch (_) {}
    const elapsed = Date.now() - Number(read("attempt") || 0);
    schedule(elapsed >= 0 && elapsed < INTERVAL ? Math.max(8000, INTERVAL - elapsed) : 8000);
    return { check, setAutomatic, getState: () => state, destroy() {
      disposed = true; host.clearTimeout(timer); controller?.abort();
    } };
  }
  host.NcmUpdates = { create, compareVersions };
})(window);

function mountUpdateSettings(ui, config) {
  const section = document.createElement("details");
  section.className = "settings-group";
  section.setAttribute("data-update-group", "");
  section.innerHTML = `<summary>TouhouNCM 更新</summary>
    <label class="setting-row"><span class="setting-copy"><span>自动检查更新</span><small data-version></small></span><input type="checkbox" data-update-auto></label>
    <p class="setting-description" data-update-status role="status" aria-live="polite"></p>
    <div class="theme-actions"><button type="button" class="settings-text-button" data-update-check>检查更新</button><a class="settings-text-button" data-update-link target="_blank" rel="noopener noreferrer" hidden>打开下载页</a></div>
    <p class="setting-description" data-update-fallback hidden style="user-select:text;overflow-wrap:anywhere"></p>`;
  ui.shadowRoot.querySelector(".keyboard-hints").before(section);
  const auto = section.querySelector("[data-update-auto]"), button = section.querySelector("[data-update-check]");
  const link = section.querySelector("[data-update-link]"), status = section.querySelector("[data-update-status]");
  const fallback = section.querySelector("[data-update-fallback]");
  let disposed = false;
  section.querySelector("[data-version]").textContent = "当前版本 " + config.version + " · GitHub Releases";
  function render(state) {
    auto.checked = state.automatic;
    button.disabled = state.status === "checking";
    status.textContent = state.message || "每 12 小时自动检查。发现新版后，下载并运行安装包更新。";
    fallback.hidden = true;
    fallback.textContent = "";
    link.hidden = !state.url;
    if (state.url) link.href = state.url;
    else link.removeAttribute("href");
    document.documentElement.toggleAttribute("data-touhouncm-update", state.status === "available");
  }
  const checker = window.NcmUpdates.create(config, render);
  const check = () => checker.check(), toggle = () => checker.setAutomatic(auto.checked);
  async function openRelease(event) {
    // CEF does not route an ordinary target=_blank link to the system browser.
    event.preventDefault();
    const url = checker.getState().url;
    if (!url) return;
    try {
      await window.NcmClientApi.openExternal(url);
      if (!disposed) status.textContent = "已请求在系统浏览器打开下载页。下载后运行安装包即可更新。";
    } catch (_) {
      if (disposed) return;
      status.textContent = "未能打开系统浏览器。请复制下方地址到浏览器中下载：";
      fallback.textContent = url;
      fallback.hidden = false;
    }
  }
  button.addEventListener("click", check);
  auto.addEventListener("change", toggle);
  link.addEventListener("click", openRelease);
  render(checker.getState());
  return { check, getState: checker.getState, destroy() {
    disposed = true;
    checker.destroy(); button.removeEventListener("click", check); auto.removeEventListener("change", toggle);
    link.removeEventListener("click", openRelease);
    section.remove(); document.documentElement.removeAttribute("data-touhouncm-update");
  } };
}
