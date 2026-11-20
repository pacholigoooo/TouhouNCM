const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const renderer = path.join(__dirname, "../src/renderer");
const nativeItems = [{ action_id: "lyricModeRoman" }, { action_id: "moreSetting" }];
const nativeGenerate = function* () { return { content: nativeItems }; };
const definition = { generate: nativeGenerate };
const settings = new Map();
const window = { NcmClientApi: { desktopMenu: () => definition }, dispatchEvent() {} };
const context = { window, Event, localStorage: { setItem: (key, value) => settings.set(key, value) } };
vm.runInNewContext(fs.readFileSync(path.join(renderer, "caption-menu.js"), "utf8"), context);
const unmount = context.mountDesktopLyricMenu(() => ({ captionFontSize: 28, captionTranslationSize: 20, captionScale: 1 }));

let watcher, accepts;
const effects = {
  take: predicate => predicate,
  spawn(start, take) {
    assert.equal(watcher, undefined, "only one menu listener");
    watcher = start(take);
    accepts = watcher.next().value;
    return { cancel: () => watcher.return() };
  }
};
function generate(resourceType) {
  const menu = definition.generate({ payload: { resourceType }, effectCommands: effects });
  let step = menu.next();
  while (!step.done) step = menu.next(step.value);
  return step.value.content;
}
assert.equal(generate("tray"), nativeItems);
assert.equal(watcher, undefined);
const caption = generate("desktopLyric");
generate("desktopLyric");
for (const entry of caption.flatMap(item => [item, ...(item.children || [])])) {
  if (entry.action_id) assert.match(entry.action_id, /^[A-Za-z][A-Za-z0-9_-]*$/);
}
const larger = caption.find(item => item.text?.startsWith("原文字号")).children[1];
const click = (actionId, resourceType) => ({ type: "async:action/doAction", payload: { actionId, isMenuTrigger: true, data: { resourceType } } });
assert.equal(accepts(click("exitApp", "tray")), false);
assert.equal(accepts(click("lyricModeRoman", "desktopLyric")), false);
assert.equal(accepts(click(larger.action_id, "tray")), false);
const lyricClick = click(larger.action_id, "desktopLyric");
assert.equal(accepts(lyricClick), true);
watcher.next(lyricClick);
assert.equal(settings.get("ncm-immersive.captionFontSize"), "29");
unmount();
assert.equal(watcher.next().done, true);
assert.equal(definition.generate, nativeGenerate);
console.log("PASS native tray and lyric actions keep their handlers; custom lyric commands detach on unload");
