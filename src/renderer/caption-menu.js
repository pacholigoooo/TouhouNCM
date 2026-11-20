function mountDesktopLyricMenu(getPreferences) {
  const definition = window.NcmClientApi.desktopMenu();

  const settings = {
    captionFontSize: { label: "原文字号", min: 12, max: 72, step: 1, presets: [20, 28, 36, 44, 52, 60, 72] },
    captionTranslationSize: { label: "译文·音译字号", min: 10, max: 48, step: 1, presets: [12, 16, 20, 24, 28, 36, 48] },
    captionScale: { label: "整体大小", min: 0.65, max: 1.6, step: 0.05, presets: [0.65, 0.8, 1, 1.2, 1.4, 1.6] }
  };
  const nativeGenerate = definition.generate;
  let disposed = false;
  let menuTask;
  const actions = new Map();

  function item(action, text, extra = {}) {
    return Object.assign({
      // NetEase also uses each action ID in an unescaped CSS selector.
      text, action_id: "ncmImmersive_caption_" + action.replace(/\./g, "_"),
      menuPayload: { actionData: { resourceType: "desktopLyric" } }
    }, extra);
  }
  function command(action, text, apply, extra) {
    const entry = item(action, text, extra);
    actions.set(entry.action_id, apply);
    return entry;
  }
  function valueLabel(name, value) {
    return name === "captionScale" ? Math.round(value * 100) + "%" : value + "px";
  }
  function save(name, value) {
    try {
      if (value === null) localStorage.removeItem("ncm-immersive." + name);
      else localStorage.setItem("ncm-immersive." + name, String(value));
    } catch (_) {}
    window.dispatchEvent(new Event("ncm-caption-preference-change"));
  }
  function adjustment(name, direction) {
    const setting = settings[name];
    const value = Math.round((getPreferences()[name] + direction * setting.step) * 100) / 100;
    save(name, Math.max(setting.min, Math.min(setting.max, value)));
  }
  function additions() {
    actions.clear();
    const preferences = getPreferences();
    const menus = Object.entries(settings).map(([name, setting]) => {
      const value = preferences[name];
      const children = [
        command(name + ".decrease", "减小 " + valueLabel(name, setting.step), () => adjustment(name, -1), { enable: value > setting.min }),
        command(name + ".increase", "增大 " + valueLabel(name, setting.step), () => adjustment(name, 1), { enable: value < setting.max }),
        { separator: true },
        ...setting.presets.map(preset => command(name + "." + preset, valueLabel(name, preset), () => save(name, preset),
          Math.abs(value - preset) < 0.001 ? { check_image_path: "icn_checked.svg" } : {})),
        { separator: true },
        command(name + ".reset", "恢复默认", () => save(name, null))
      ];
      return item(name, setting.label + "  " + valueLabel(name, value), { children });
    });
    menus.push(command("background", "透明背景", () => save("captionBackground", getPreferences().captionBackground === false ? "on" : "off"),
      preferences.captionBackground === false ? { check_image_path: "icn_checked.svg" } : {}));
    return menus;
  }
  function isCaptionAction({ type, payload }) {
    return type === "async:action/doAction" && payload?.isMenuTrigger === true &&
      payload.data?.resourceType === "desktopLyric" && actions.has(payload.actionId);
  }
  function* watchActions(take) {
    while (!disposed) {
      const { payload } = yield take(isCaptionAction);
      actions.get(payload.actionId)?.();
    }
  }
  function* generate(options) {
    const result = yield* nativeGenerate.call(this, options);
    if (disposed || options.payload.resourceType !== "desktopLyric") return result;
    // Listen after NetEase dispatches the click. Its lazy tray and menu handler
    // needs the first registration on winhelper.onmenuclick for itself.
    const { spawn, take } = options.effectCommands || {};
    if (typeof spawn !== "function" || typeof take !== "function") return result;
    if (!menuTask) menuTask = yield spawn(watchActions, take);
    const content = result.content.slice();
    const position = content.findIndex(entry => entry.action_id === "moreSetting");
    content.splice(position < 0 ? content.length : position, 0, { separator: true }, ...additions(), { separator: true });
    return Object.assign({}, result, { content });
  }
  definition.generate = generate;
  return () => {
    if (disposed) return;
    disposed = true;
    if (definition.generate === generate) definition.generate = nativeGenerate;
    menuTask?.cancel();
    actions.clear();
  };
}
