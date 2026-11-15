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
  const current=fixture(async()=>response("v0.9.0")); await current.updates.check(); assert.equal(current.updates.getState().status,"current"); current.updates.destroy();
  let signal;
  const abort=fixture((url,options)=>new Promise((done,reject)=>{signal=options.signal;signal.addEventListener("abort",()=>reject(Error("aborted")))}));
  const waiting=abort.updates.check(); abort.updates.destroy(); await waiting;
  assert.equal(signal.aborted,true); assert.equal(abort.timers.size,0);
  console.log("PASS update comparison, request sharing, release URLs, disable and teardown");
})().catch(error=>{console.error(error);process.exitCode=1});
