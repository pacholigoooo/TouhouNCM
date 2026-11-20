const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/updates.js"), "utf8");

function fixture(fetch, saved = {}) {
  const timers = new Map(); let serial = 0;
  const host = { fetch, AbortController, localStorage: { getItem: key => saved[key], setItem: (key, value) => saved[key] = value },
    setTimeout(fn, ms) { timers.set(++serial, {fn, ms}); return serial; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, { window: host, URL, console });
  const updates = host.NcmUpdates.create({version:"1.0.0",repository:"pacholigoooo/TouhouNCM"}, () => {});
  return {updates, timers, api:host.NcmUpdates};
}
const response = (tag, url = "https://github.com/pacholigoooo/TouhouNCM/releases/tag/" + tag) => ({ok:true,json:async()=>({tag_name:tag,html_url:url})});
(async()=>{
  let calls = 0, resolve;
  const f = fixture(() => { calls++; return new Promise(done => resolve = done); });
  assert.equal(f.api.compareVersions("v1.10.0","1.9.9"),1);
  assert.throws(() => f.api.compareVersions("v1.1.0-beta","1.0.0"));
  const first = f.updates.check(), second = f.updates.check();
  assert.equal(first,second); assert.equal(calls,1);
  resolve(response("v1.0.1")); await first;
  assert.equal(f.updates.getState().status,"available");
  f.updates.setAutomatic(false); assert.equal(f.timers.size,0);
  f.updates.destroy(); assert.equal(f.timers.size,0);
  const missing=fixture(async()=>({status:404})); await missing.updates.check(); assert.equal(missing.updates.getState().status,"unpublished"); missing.updates.destroy();
  const bad=fixture(async()=>response("v1.0.2","https://example.test/download")); await bad.updates.check(); assert.equal(bad.updates.getState().status,"error"); bad.updates.destroy();
  const current=fixture(async()=>response("v1.0.0")); await current.updates.check(); assert.equal(current.updates.getState().status,"current");
  assert.equal(current.updates.getState().url,"https://github.com/pacholigoooo/TouhouNCM/releases/tag/v1.0.0"); current.updates.destroy();
  let signal;
  const abort=fixture((url,options)=>new Promise((done,reject)=>{signal=options.signal;signal.addEventListener("abort",()=>reject(Error("aborted")))}));
  const waiting=abort.updates.check(); abort.updates.destroy(); await waiting;
  assert.equal(signal.aborted,true); assert.equal(abort.timers.size,0);
  console.log("PASS update comparison, request sharing, release URLs, disable and teardown");

  // Exercise the actual click handler: CEF must receive a native browser call,
  // rather than relying on the ordinary target=_blank navigation.
  const elements = new Map();
  function element() {
    return { hidden: false, textContent: "", listeners: new Map(), attributes: new Set(),
      setAttribute(key) { this.attributes.add(key); },
      removeAttribute(key) { this.attributes.delete(key); },
      toggleAttribute(key, value) { if (value) this.attributes.add(key); else this.attributes.delete(key); },
      addEventListener(key, fn) { this.listeners.set(key, fn); },
      removeEventListener(key, fn) { assert.equal(this.listeners.get(key), fn); this.listeners.delete(key); },
      remove() { this.removed = true; },
      querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); }
    };
  }
  const section = element(), root = element(), actions = [];
  const url = "https://github.com/pacholigoooo/TouhouNCM/releases/tag/v1.1.0";
  let state = { status: "available", automatic: true, latest: "v1.1.0", url }, render, destroyed = false, retries = 0;
  const window = { NcmClientApi: { openExternal: async value => actions.push(value) } };
  const context = { window, URL, console, document: { createElement: () => section, documentElement: root } };
  vm.runInNewContext(source, context);
  window.NcmUpdates.create = (config, changed) => {
    render = changed;
    return { getState: () => state, check: async () => render(state), retryLater: () => retries++,
      setAutomatic: value => { state = { ...state, automatic: value }; render(state); }, destroy() { destroyed = true; } };
  };
  const ui = { shadowRoot: { querySelector: () => ({ before: value => assert.equal(value, section) }) } };
  const mounted = context.mountUpdateSettings(ui, { version: "1.0.0" });
  const link = elements.get("[data-update-link]"), status = elements.get("[data-update-status]"), fallback = elements.get("[data-update-fallback]");
  const install = elements.get("[data-update-install]"), auto = elements.get("[data-update-auto]");
  assert.equal(mounted.nativeSync({ phase: "idle" }), "download");
  assert.equal(mounted.nativeSync({ phase: "downloading" }), "");
  mounted.nativeSync({ phase: "ready", latest: "v1.1.0" });
  assert.match(status.textContent, /退出网易云时会自动安装/);
  auto.checked = false;
  auto.listeners.get("change")();
  assert.equal(mounted.nativeSync({ phase: "ready", latest: "v1.1.0" }), "cancel");
  assert.equal(mounted.nativeSync({ phase: "idle" }), "");
  install.listeners.get("click")();
  assert.equal(mounted.nativeSync({ phase: "idle" }), "download");
  assert.equal(mounted.nativeSync({ phase: "error" }), "");
  assert.equal(install.textContent, "重试下载"); assert.equal(retries, 1);
  mounted.nativeSync({ phase: "portable" });
  assert.equal(install.hidden, true);
  let prevented = 0;
  await link.listeners.get("click")({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.deepEqual(actions, [url]); assert.equal(fallback.hidden, true);
  window.NcmClientApi.openExternal = async () => { throw new Error("no native bridge"); };
  await link.listeners.get("click")({ preventDefault() { prevented++; } });
  assert.match(status.textContent, /未能打开系统浏览器/);
  assert.equal(fallback.hidden, false); assert.equal(fallback.textContent, url);
  state = { status: "current", automatic: true, url }; render(state);
  assert.equal(link.hidden, false); assert.equal(root.attributes.has("data-touhouncm-update"), false);
  let failLater;
  window.NcmClientApi.openExternal = () => new Promise((resolve, reject) => { failLater = reject; });
  const opening = link.listeners.get("click")({ preventDefault() {} });
  const previousStatus = status.textContent;
  mounted.destroy(); failLater(new Error("closed")); await opening;
  assert.equal(destroyed, true); assert.equal(link.listeners.size, 0); assert.equal(section.removed, true);
  assert.equal(status.textContent, previousStatus);
  console.log("PASS update button native handoff, failure address, same-version download and teardown");
  const cp = require("node:child_process");
  const temp = path.join(__dirname, "../.tmp");
  fs.mkdirSync(temp, { recursive: true });
  const dir = fs.mkdtempSync(path.join(temp, "update-test-"));
  try {
    const exe = path.join(dir, "update-tests.exe");
    const compiler = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    cp.execFileSync(compiler, ["/nologo", "/codepage:65001", "/target:exe", "/reference:System.Net.Http.dll",
      "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll", "/out:" + exe,
      path.join(__dirname, "../src/native/ReleaseUpdater.cs"), path.join(__dirname, "ReleaseUpdaterTests.cs")], { stdio: "inherit" });
    cp.execFileSync(exe, [dir], { stdio: "inherit", windowsHide: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
})().catch(error=>{console.error(error);process.exitCode=1});
