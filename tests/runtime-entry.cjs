const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer', 'runtime-entry.js'), "utf8");

function fixture(failure, initialDetail = "closed") {
  const active = new Set(["bridge"]);
  const errors = [];
  const navigation = [];
  let changeDetail;
  const listeners = new Map();
  const rules = ["html { color: red; }", "body { margin: 0; }"];
  let ruleEdits = 0;
  const sheet = {
    isConnected: false,
    sheet: {
      cssRules: rules,
      insertRule(rule, index) { rules.splice(index, 0, rule); ruleEdits++; },
      deleteRule(index) { rules.splice(index, 1); ruleEdits++; }
    },
    remove() { active.delete("style"); this.isConnected = false; }
  };
  const mount = name => {
    active.add(name);
    return () => active.delete(name);
  };
  const ui = {
    destroy: mount("view"),
    open(animate) { navigation.push(["open", animate]); },
    close() { navigation.push(["close"]); },
    getState() { return {}; }
  };
  const bridge = {
    dispose() { active.delete("bridge"); },
    closeDetail() {},
    subscribe(listener) {
      changeDetail = state => listener({ coverColor: null, detailState: state });
      changeDetail(initialDetail);
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
    console: { error(...args) { errors.push(args); }, warn(...args) { errors.push(args); } },
    document: {
      hidden: false,
      head: { appendChild() { active.add("style"); sheet.isConnected = true; } },
      createElement() { return sheet; },
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
    navigation, changeDetail: state => changeDetail(state),
    window, active, listeners, errors,
    document: context.document, rules, get ruleEdits() { return ruleEdits; }
  };
}

const loaded = fixture();
const wakes = [];
loaded.window.__pachiNcmImmersiveNativeWake = payload => wakes.push(payload);
assert.equal(loaded.start(), "ready");
assert.deepEqual(wakes, ["ready"]);
const runtime = loaded.window.__pachiImmersive;
assert.equal(runtime.reclaimNativeStyleCache(), false);
assert.equal(loaded.ruleEdits, 0);
loaded.document.hidden = true;
const originalRules = loaded.rules.slice();
assert.equal(runtime.reclaimNativeStyleCache(), true);
assert.deepEqual(loaded.rules, originalRules);
assert.equal(loaded.ruleEdits, 2);
loaded.document.hidden = false;
assert.equal(runtime.reclaimNativeStyleCache(), false);
assert.equal(loaded.ruleEdits, 2);
runtime.destroy();
runtime.destroy();
assert.equal(runtime.reclaimNativeStyleCache(), false);
assert.equal(loaded.ruleEdits, 2);
assert.equal(loaded.active.size, 0);
assert.equal(loaded.listeners.size, 0);
assert.equal(loaded.window.__pachiImmersive, undefined);
console.log("PASS runtime teardown is complete and repeatable");
console.log("PASS native style cache reclaim preserves rules and runs only while hidden");

const player = fixture(undefined, "opened");
player.start();
assert.deepEqual(player.navigation, [["open", false]], "attaching to the current song page keeps it in place");
for (const state of ["closed", "opening", "opening", "opened", "opened", "closing", "closed", "opened"]) player.changeDetail(state);
assert.deepEqual(player.navigation.slice(1), [["close"], ["open", true], ["close"], ["open", true]]);
player.window.__pachiImmersive.destroy();
console.log("PASS the minibar entrance also works on clients that go straight to opened");

const disconnected = fixture();
disconnected.window.__pachiNcmImmersiveNativeWake = () => { throw Error("disconnected binding"); };
// A stale native binding must not prevent a fresh renderer from mounting.
assert.equal(disconnected.start(), "ready");
assert.equal(disconnected.errors.length, 1);
disconnected.window.__pachiImmersive.destroy();
assert.equal(disconnected.active.size, 0);
console.log("PASS a stale native wake binding preserves renderer mounting and teardown");

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
