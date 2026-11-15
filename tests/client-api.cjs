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
