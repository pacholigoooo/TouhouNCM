const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer', 'runtime-entry.js'), "utf8");

function fixture(failure) {
  const active = new Set(["bridge"]);
  const errors = [];
  const listeners = new Map();
  const mount = name => {
    active.add(name);
    return () => active.delete(name);
  };
  const ui = {
    destroy: mount("view"),
    open() {}, close() {}, getState() { return {}; }
  };
  const bridge = {
    dispose() { active.delete("bridge"); },
    closeDetail() {},
    subscribe(listener) {
      listener({ coverColor: null, detailState: "closed" });
      if (failure === "subscribe") throw Error("subscription failed");
      return mount("subscription");
    }
  };
  const window = {
    NCMImmersiveBridge: bridge,
    NcmImmersiveView: { mount() { return ui; } },
    createTouhouOriginClient() { return { dispose: mount("origins") }; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const context = {
    window,
    console: { error(...args) { errors.push(args); } },
    document: {
      head: { appendChild() { active.add("style"); } },
      createElement() { return { remove() { active.delete("style"); } }; },
      documentElement: {
        setAttribute() { active.add("skin"); },
        removeAttribute() { active.delete("skin"); }
      },
      addEventListener(name) { active.add(name); },
      removeEventListener(name) { active.delete(name); }
    },
    createGlassArtwork() { return { destroy: mount("glass") }; },
    createSimplifyControls() { return { sync() {}, destroy: mount("simplify") }; },
    mountUpdateSettings() { return { destroy: mount("updates") }; },
    mountSettingsEntry() { return { sync() {}, destroy: mount("settings-entry") }; },
    mountTouhouThemes() { return { destroy: mount("touhou-themes") }; },
    mountOriginCard() { return { destroy: mount("origin-card") }; },
    watchPlayerDialogs() { return mount("dialogs"); },
    mountDesktopLyricSettings() { return mount("caption-settings"); },
    mountDesktopLyricMenu() { return mount("caption-menu"); },
    watchDesktopLyrics() {
      const release = mount("lyrics");
      return () => {
        release();
        if (failure === "restore") throw Error("native restore failed");
      };
    },
    setMinibarPalette() {},
    makeMiniSnapshot() { return () => ""; }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    start: () => context.mountImmersiveRuntime("test", "", "", {version:"1.0.0"}),
    window, active, listeners, errors
  };
}

const loaded = fixture();
assert.equal(loaded.start(), "ready");
const runtime = loaded.window.__pachiImmersive;
runtime.destroy();
runtime.destroy();
assert.equal(loaded.active.size, 0);
assert.equal(loaded.listeners.size, 0);
assert.equal(loaded.window.__pachiImmersive, undefined);
console.log("PASS runtime teardown is complete and repeatable");

const failed = fixture("subscribe");
assert.throws(failed.start, /subscription failed/);
assert.equal(failed.active.size, 0);
assert.equal(failed.window.__pachiImmersive, undefined);
console.log("PASS partial initialization releases completed components");

const interrupted = fixture("restore");
interrupted.start();
interrupted.window.__pachiImmersive.destroy();
assert.equal(interrupted.active.size, 0);
assert.equal(interrupted.errors.length, 1);
assert.equal(interrupted.listeners.size, 0);
console.log("PASS one cleanup error still releases remaining components");
