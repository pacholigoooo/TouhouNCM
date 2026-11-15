function mountDesktopLyricSettings(getPreferences) {
  const settings = {
    captionFontSize: { label: "原文字号", min: 12, max: 72, step: 1, unit: "px" },
    captionTranslationSize: { label: "译文·音译字号", min: 10, max: 48, step: 1, unit: "px" },
    captionScale: { label: "整体大小", min: 0.65, max: 1.6, step: 0.05, unit: "%" }
  };
  const panel = document.createElement("section");
  panel.className = "item list ncm-caption-settings";
  panel.setAttribute("aria-label", "桌面歌词大小");
  panel.innerHTML = Object.entries(settings).map(([name, setting]) => {
    const id = "ncm-native-" + name;
    return '<div class="ncm-caption-adjustment"><label for="' + id + '">' + setting.label + '</label>' +
      '<input id="' + id + '" type="range" data-caption-preference="' + name + '" min="' + setting.min + '" max="' + setting.max + '" step="' + setting.step + '">' +
      '<output for="' + id + '"></output></div>';
  }).join("") + '<label class="ncm-caption-background"><input type="checkbox" data-caption-preference="captionBackground">透明背景</label>' +
    '<button class="ncm-caption-reset" type="button">恢复默认大小</button>';
  const inputs = Array.from(panel.querySelectorAll('input[type="range"]'));
  const backgroundInput = panel.querySelector('input[type="checkbox"]');
  const hiddenNative = new Set();
  let section = null;

  function sync() {
    const preferences = getPreferences();
    backgroundInput.checked = preferences.captionBackground === false;
    for (const input of inputs) {
      const name = input.dataset.captionPreference, setting = settings[name], value = preferences[name];
      const label = (name === "captionScale" ? Math.round(value * 100) : value) + setting.unit;
      input.value = String(value);
      input.setAttribute("aria-valuetext", label);
      input.style.setProperty("--ncm-caption-progress", ((value - setting.min) / (setting.max - setting.min) * 100) + "%");
      input.nextElementSibling.textContent = label;
    }
  }
  function change(event) {
    const name = event.target.dataset.captionPreference;
    if (!settings[name] && name !== "captionBackground") return;
    const value = name === "captionBackground" ? event.target.checked ? "off" : "on" : event.target.value;
    try { localStorage.setItem("ncm-immersive." + name, value); } catch (_) {}
    window.dispatchEvent(new Event("ncm-caption-preference-change"));
  }
  function reset() {
    for (const name of Object.keys(settings)) {
      try { localStorage.removeItem("ncm-immersive." + name); } catch (_) {}
    }
    window.dispatchEvent(new Event("ncm-caption-preference-change"));
  }
  function clearNative() {
    for (const node of hiddenNative) node.removeAttribute("data-ncm-caption-native-size");
    hiddenNative.clear();
  }
  function mount(next) {
    const fontRow = next.querySelector("section.item.list");
    if (!fontRow) return;
    clearNative();
    section = next;
    // The native font row contains family, size, weight and outline. Replace
    // its single size control with the independent original/translation sizes.
    for (const node of [fontRow.querySelector(".title")?.children[1], fontRow.querySelector(".select-item")?.children[1]]) {
      if (node) { node.setAttribute("data-ncm-caption-native-size", ""); hiddenNative.add(node); }
    }
    fontRow.after(panel);
    sync();
  }
  function find(node) {
    if (node.nodeType !== 1) return;
    const candidate = node.id === "desklyric" ? node : node.querySelector("#desklyric");
    if (candidate?.closest("#page_pc_setting")) mount(candidate);
  }
  const observer = new MutationObserver(records => {
    if (section?.isConnected) {
      if (!panel.isConnected) mount(section);
      return;
    }
    clearNative();
    section = null;
    for (const record of records) for (const node of record.addedNodes) find(node);
  });
  panel.addEventListener("input", change);
  const resetButton = panel.querySelector("button");
  resetButton.addEventListener("click", reset);
  function onStorage(event) {
    if (event.key === null || [...Object.keys(settings), "captionBackground"].some(name => event.key === "ncm-immersive." + name)) sync();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("ncm-caption-preference-change", sync);
  find(document.getElementById("root"));
  observer.observe(document.getElementById("root"), { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    panel.removeEventListener("input", change);
    resetButton.removeEventListener("click", reset);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("ncm-caption-preference-change", sync);
    clearNative();
    panel.remove();
  };
}
