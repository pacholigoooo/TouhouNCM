const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/client-api.js"), "utf8");

for (const [id, exported] of [[15, "dg"], [204, "renamedSearch"], [83, "q"]]) {
  const search = () => "result";
  function factory() {}
  factory.toString = () => `function(e,t,n){n.d(t,"${exported}",(function(){return renamed}));var renamed=Object(o.a)({url:"/api/search/song/list/page"});}`;
  const loader = key => {
    if (!loader.c[key]) { const module = {exports:{}}; loader.c[key]=module; loader.m[key](module,module.exports,loader); }
    return loader.c[key].exports;
  };
  loader.m = {[id]:factory}; loader.c = {[id]:{exports:{[exported]:search}}};
  const jsonp=[];
  jsonp.push=entry=>{Array.prototype.push.call(jsonp,entry);Object.assign(loader.m,entry[1]);entry[2].forEach(([key])=>loader(key));};
  const window={webpackJsonp:jsonp}; vm.runInNewContext(source,{window});
  assert.equal(window.NcmClientApi.method("/api/search/song/list/page","搜索"),search);
  assert.deepEqual(Object.keys(loader.m),[String(id)]); assert.equal(jsonp.length,0);
  assert.throws(()=>window.NcmClientApi.method("/missing","搜索"),/结构已变化/);
  assert.equal(jsonp.length,0);
}
console.log("PASS client module and export renumbering; temporary entries released on success and failure");

{
  const slots = {}, session = new Map();
  const sdk = { exports: { Bridge: { _Adapter: { registerCallMap: slots } } } };
  const loader = Object.assign(() => {}, { m: { 4: "winhelper.popupMenu registerCallOnce" }, c: { 4: sdk } });
  const jsonp = [];
  jsonp.push = entry => { const init = Object.values(entry[1])[0]; init({}, {}, loader); };
  const window = { webpackJsonp: jsonp, sessionStorage: { getItem: key => session.get(key), setItem: (k, v) => session.set(k, v), removeItem: key => session.delete(key) } };
  vm.runInNewContext(source, { window });
  const check = window.NcmClientApi.needsMenuReload;
  for (const owner of [undefined, () => {}, [() => {}]]) {
    slots["winhelper.onmenuclick"] = owner;
    assert.equal(check(), false);
    assert.equal(slots["winhelper.onmenuclick"], owner);
  }
  slots["winhelper.onmenuclick"] = [];
  assert.equal(check(), true);
  assert.equal(check(), false);
  console.log("PASS an orphaned native menu requests one reload; healthy and uninitialized menus stay intact");
}

(async () => {
  for (const id of [4, 94]) {
    const opened = [], failure = new Error("native browser unavailable");
    let reject = false;
    function nativeFactory() {}
    nativeFactory.toString = () => 'os.navigateExternal appendRegisterCall';
    const sdk = { Os: { openExternal(url) { opened.push(url); return reject ? Promise.reject(failure) : Promise.resolve(); } } };
    const loader = key => {
      if (!loader.c[key]) { const module = { exports: {} }; loader.c[key] = module; loader.m[key](module, module.exports, loader); }
      return loader.c[key].exports;
    };
    loader.m = { [id]: nativeFactory }; loader.c = { [id]: { exports: sdk } };
    const jsonp = [];
    jsonp.push = entry => { Array.prototype.push.call(jsonp, entry); Object.assign(loader.m, entry[1]); entry[2].forEach(([key]) => loader(key)); };
    const window = { webpackJsonp: jsonp };
    vm.runInNewContext(source, { window, URL });
    const url = "https://github.com/pacholigoooo/TouhouNCM/releases/tag/v1.1.0";
    await window.NcmClientApi.openExternal(url);
    assert.deepEqual(opened, [url]);
    for (const unsafe of ["javascript:alert(1)", "file:///C:/Windows", "http://example.com/", "https://user:password@example.com/"]) {
      assert.throws(() => window.NcmClientApi.openExternal(unsafe));
    }
    assert.equal(opened.length, 1);
    reject = true;
    await assert.rejects(window.NcmClientApi.openExternal(url), error => error === failure);
    assert.deepEqual(Object.keys(loader.m), [String(id)]);
    assert.equal(jsonp.length, 0);
    delete sdk.Os.openExternal;
    assert.throws(() => window.NcmClientApi.openExternal(url), /无法打开系统浏览器/);
    assert.equal(jsonp.length, 0);
  }
  console.log("PASS external browser handoff, module renumbering, URL safety and native failures");
})().catch(error => { console.error(error); process.exitCode = 1; });
