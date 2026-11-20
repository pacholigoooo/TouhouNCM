(function (host) {
  "use strict";
  function withLoader(read) {
    const jsonp = host.webpackJsonp;
    if (!Array.isArray(jsonp)) throw new Error("当前网易云版本未提供兼容的页面接口");
    let loader;
    const id = "touhouncm-api-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const entry = [[], { [id]: (module, exports, require) => { loader = require; } }, [[id]]];
    try {
      jsonp.push(entry);
      if (!loader?.m) throw new Error("网易云页面接口尚未就绪");
      return read(loader);
    } finally {
      if (loader) { delete loader.m[id]; if (loader.c) delete loader.c[id]; }
      const index = jsonp.indexOf(entry);
      if (index >= 0) jsonp.splice(index, 1);
    }
  }
  function findModule(loader, markers, preferred) {
    const matches = id => markers.every(marker => String(loader.m[id]).includes(marker));
    if (loader.m[preferred] && matches(preferred)) return String(preferred);
    const candidates = Object.keys(loader.m).filter(matches);
    if (candidates.length !== 1) throw new Error("网易云接口结构已变化，请更新 TouhouNCM");
    return candidates[0];
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function method(marker, label) {
    return withLoader(loader => {
      const id = findModule(loader, [marker], 15), source = String(loader.m[id]), api = loader(id);
      // Arrow wrappers retain the endpoint in their source. API-factory exports
      // instead need their local variable mapped to webpack's public export.
      const functions = Object.values(api).filter(value => typeof value === "function" && String(value).includes(marker));
      if (functions.length === 1) return functions[0];
      const endpoint = new RegExp("([\\w$]+)\\s*=\\s*Object\\([\\w$.]+\\)\\(\\s*(?:\\{\\s*url\\s*:\\s*)?[\"']" + escape(marker) + "[\"']").exec(source);
      if (endpoint) {
        const exported = new RegExp('\\.d\\(\\w+,\\s*["\']([^"\']+)["\'],\\s*\\(?function\\s*\\(\\)\\s*\\{\\s*return\\s+' + escape(endpoint[1]) + '\\s*[;} ]').exec(source);
        if (exported && typeof api[exported[1]] === "function") return api[exported[1]];
      }
      throw new Error("当前网易云版本的" + label + "接口需要适配");
    });
  }
  function desktopMenu() {
    return withLoader(loader => {
      const registry = loader(findModule(loader, ['"desktopLyric"', "check_image_path", "menuPayload"], 622));
      const getter = Object.values(registry).find(value => typeof value === "function" &&
        /^\s*([\w$]+)\s*=>\s*[\w$]+\[\1\]\s*$/.test(String(value)));
      const definition = getter?.("desktopLyric");
      if (typeof definition?.generate !== "function") throw new Error("当前网易云版本的桌面歌词菜单需要适配");
      return definition;
    });
  }
  function needsMenuReload() {
    // Detaching 1.1.0 could leave an empty callback list. NetEase treats it as
    // occupied even after an upgrade. Reload that renderer once to restore its owner.
    const key = "ncm-immersive.recover-menu";
    try {
      const orphaned = withLoader(loader => {
        const id = findModule(loader, ["winhelper.popupMenu", "registerCallOnce"], 4);
        const callbacks = loader.c?.[id]?.exports?.Bridge?._Adapter?.registerCallMap?.["winhelper.onmenuclick"];
        return Array.isArray(callbacks) && callbacks.length === 0;
      });
      if (!orphaned) { host.sessionStorage.removeItem(key); return false; }
      if (host.sessionStorage.getItem(key)) return false;
      host.sessionStorage.setItem(key, "1");
      return true;
    } catch (_) { return false; }
  }
  function openExternal(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("外部链接无效");
    return withLoader(loader => {
      const sdk = loader(findModule(loader, ["os.navigateExternal", "appendRegisterCall"], 4));
      if (typeof sdk.Os?.openExternal !== "function") throw new Error("当前网易云版本无法打开系统浏览器");
      return sdk.Os.openExternal(url.href);
    });
  }
  host.NcmClientApi = { method, desktopMenu, needsMenuReload, openExternal };
})(window);
