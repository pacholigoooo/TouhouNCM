const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/character-export.js"), "utf8");
function fixture(wake) {
  let now = 1000, serial = 0;
  const timers = new Map();
  const window = {
    __pachiNcmImmersiveNativeWake: wake,
    setInterval(callback) { const id = ++serial; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, { window, Date: { now: () => now } });
  return {
    api: window.NcmCharacterExport, timers,
    advance(ms) { now += ms; for (const callback of timers.values()) callback(); }
  };
}
const image = { dataUrl: "data:image/png;base64,iVBORw==", fileName: "TouhouNCM-test.png" };

(async () => {
  const events = [];
  const dormant = fixture(session => events.push(session));
  dormant.api.nativeReady("session-a");
  dormant.advance(60000);
  const saved = dormant.api.save(image);
  assert.deepEqual(events, ["session-a"]);
  const request = dormant.api.takeRequest();
  assert.equal(request.kind, "png");
  assert.equal(request.length, 8);
  assert.equal(dormant.api.readChunk(request.id, 0), "iVBORw==");
  assert.equal(dormant.api.takeRequest(), null);
  await assert.rejects(dormant.api.save(image), /另一张图片/);
  dormant.api.nativeReady("session-a");
  dormant.advance(7000);
  dormant.api.nativeReady("session-a");
  dormant.advance(7000);
  dormant.api.finish(request.id, { ok: true });
  assert.equal((await saved).ok, true);
  assert.equal(dormant.timers.size, 0);
  console.log("PASS PNG export wakes after a minute of dormancy and remains alive during the save dialog");

  const dead = fixture(() => {});
  dead.api.nativeReady("dead-session");
  dead.advance(60000);
  const expired = assert.rejects(dead.api.save(image), /已断开/);
  dead.advance(7000);
  assert.equal(dead.timers.size, 1);
  dead.advance(2000);
  await expired;
  assert.equal(dead.timers.size, 0);
  console.log("PASS a stale binding times out from request submission and releases PNG data");

  const restarted = fixture(() => {});
  restarted.api.nativeReady("old");
  const canceled = assert.rejects(restarted.api.save(image), /已重启/);
  restarted.api.nativeReady("new");
  await canceled;
  const disposed = assert.rejects(restarted.api.save(image), /已取消/);
  restarted.api.dispose();
  await disposed;
  assert.equal(restarted.timers.size, 0);
  await assert.rejects(restarted.api.save(image), /尚未连接/);

  const legacy = fixture();
  legacy.api.nativeReady("legacy");
  legacy.advance(6000);
  await assert.rejects(legacy.api.save(image), /尚未连接/);
  console.log("PASS restart, teardown, and a disconnected legacy channel reject exports cleanly");
})().catch(error => { console.error(error); process.exitCode = 1; });
