function mountTouhouThemes(ui) {
  const root = document.documentElement;
  const shadow = ui.shadowRoot;
  const view = shadow.querySelector(".immersion");
  const settings = shadow.querySelector(".settings-panel");
  const themes = {
    cover: {name: "跟随封面（默认）"},
    reimu: {name: "博丽灵梦 · 朱白", light: "#ad3439", dark: "#f0ada5", previous: "#f3b0a7"},
    patchouli: {name: "帕秋莉 · 梅紫", light: "#78466f", dark: "#d8b1d3", previous: "#d9bde8"},
    youmu: {name: "魂魄妖梦 · 银绿", light: "#35684c", dark: "#accfb4", previous: "#bfd6b8"},
    cirno: {name: "琪露诺 · 冰蓝", light: "#25669b", dark: "#abd8f8", previous: "#a6d4ff"},
    marisa: {name: "雾雨魔理沙 · 琥珀", light: "#855515", dark: "#e7c27a", previous: "#edc576"},
    yuyuko: {name: "西行寺幽幽子 · 樱霞", light: "#9b3f70", dark: "#e6b4cf", previous: "#eeb8d2"},
    tenshi: {name: "比那名居天子 · 青蓝", light: "#146a78", dark: "#96d6df", previous: "#88ded9"},
    sakuya: {name: "十六夜咲夜 · 银灰", light: "#515f70", dark: "#c4cfd9", previous: "#c7cddc"}
  };
  const legacyAccents = {reimu: "#ffb7bf", patchouli: "#ddc4ff", youmu: "#a7e6cf"};
  const appearanceKeys = ["brightness", "blur", "saturation", "accent"];
  const storageKey = "ncm-immersive.touhouTheme";
  const read = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; }
    catch (_) { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  };
  const currentAppearance = () => {
    const preferences = ui.getState().preferences;
    return Object.fromEntries(appearanceKeys.map(key => [key, preferences[key]]));
  };
  const storedTheme = read(storageKey, "cover");
  let selected = Object.prototype.hasOwnProperty.call(themes, storedTheme) ? storedTheme : "cover";
  const storedTone = read("ncm-immersive.touhouTone", "auto");
  let selectedTone = ["auto", "light", "dark"].includes(storedTone) ? storedTone : "auto";
  const nativeTone = () => root.dataset.ncmGlassTone === "dark" ? "dark" : "light";
  let effectiveTone = selectedTone === "auto" ? nativeTone() : selectedTone;
  let paletteKey = "";
  let cachedPalette = null;
  let coverAppearance = currentAppearance();
  if (selected !== "cover") {
    try {
      const saved = JSON.parse(read("ncm-immersive.touhouCoverAppearance", "null"));
      if (saved && appearanceKeys.every(key => typeof saved[key] === typeof coverAppearance[key])) coverAppearance = saved;
    } catch (_) {}
  }

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const group = create("details", "settings-group touhou-settings");
  group.open = true;
  group.dataset.touhouSettings = "";
  group.appendChild(create("summary", "", "东方主题"));
  const picker = create("label", "setting-select-row touhou-theme-picker");
  const pickerLabel = create("span", "touhou-theme-label", "主题配色");
  const swatch = create("span", "touhou-theme-swatch");
  swatch.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) swatch.appendChild(create("i"));
  pickerLabel.appendChild(swatch);
  picker.appendChild(pickerLabel);
  const select = create("select", "font-select touhou-theme-select");
  select.setAttribute("aria-label", "东方主题配色");
  select.dataset.touhouSelect = "";
  Object.entries(themes).forEach(([key, theme]) => {
    const option = create("option", "", theme.name);
    option.value = key;
    select.appendChild(option);
  });
  picker.appendChild(select);
  group.appendChild(picker);
  const toneRow = create("label", "setting-select-row");
  toneRow.appendChild(create("span", "", "主题色调"));
  const toneSelect = create("select", "font-select touhou-theme-select");
  toneSelect.setAttribute("aria-label", "东方主题色调");
  toneSelect.dataset.touhouTone = "";
  [["auto", "跟随网易云"], ["light", "浅色"], ["dark", "深色"]].forEach(([value, label]) => {
    const option = create("option", "", label);
    option.value = value;
    toneSelect.appendChild(option);
  });
  toneSelect.value = selectedTone;
  toneRow.appendChild(toneSelect);
  group.appendChild(toneRow);
  const captionRow = create("label", "setting-row");
  const captionCopy = create("span", "setting-copy");
  captionCopy.appendChild(create("span", "", "桌面歌词跟随主题"));
  const captionHint = create("small", "", "关闭后使用网易云桌面歌词配色");
  captionHint.id = "ncm-caption-theme-hint";
  captionCopy.appendChild(captionHint);
  const captionSwitch = create("span", "switch");
  const captionInput = create("input");
  captionInput.type = "checkbox";
  captionInput.checked = read("ncm-immersive.captionTheme", "on") !== "off";
  captionInput.dataset.captionTheme = "";
  captionInput.setAttribute("aria-label", "桌面歌词跟随主题");
  captionInput.setAttribute("aria-describedby", captionHint.id);
  captionSwitch.appendChild(captionInput);
  captionSwitch.appendChild(create("span", "switch-track"));
  captionRow.appendChild(captionCopy);
  captionRow.appendChild(captionSwitch);
  group.appendChild(captionRow);
  settings.insertBefore(group, settings.querySelector(".settings-group"));

  const stockAccent = (theme, accent) => theme !== "cover" &&
    [themes[theme].light, themes[theme].dark, themes[theme].previous, legacyAccents[theme]]
      .some(color => color && color.toLowerCase() === String(accent).toLowerCase());

  function applyTheme() {
    [root, ui.host, view].forEach(element => {
      if (selected === "cover") {
        element.removeAttribute("data-ncm-touhou");
        element.removeAttribute("data-ncm-touhou-tone");
      } else {
        element.setAttribute("data-ncm-touhou", selected);
        element.setAttribute("data-ncm-touhou-tone", effectiveTone);
      }
    });
    select.value = selected;
    toneSelect.disabled = selected === "cover";
    swatch.dataset.theme = selected;
    paletteKey = "";
  }
  function onThemeChange() {
    const previous = selected;
    const accent = currentAppearance().accent;
    if (selected === "cover" && select.value !== "cover") {
      coverAppearance = currentAppearance();
      write("ncm-immersive.touhouCoverAppearance", JSON.stringify(coverAppearance));
    }
    selected = select.value;
    write(storageKey, selected);
    applyTheme();
    // Keep custom lyric ink; stock highlights follow the new theme and tone.
    if (selected === "cover") ui.applyAppearance({accent: coverAppearance.accent});
    else if (previous === "cover" || stockAccent(previous, accent)) ui.applyAppearance({accent: themes[selected][effectiveTone]});
  }
  function syncTone() {
    const next = selectedTone === "auto" ? nativeTone() : selectedTone;
    if (next === effectiveTone) return;
    const accent = currentAppearance().accent;
    effectiveTone = next;
    applyTheme();
    if (stockAccent(selected, accent)) ui.applyAppearance({accent: themes[selected][effectiveTone]});
  }
  function onToneChange() {
    selectedTone = toneSelect.value;
    write("ncm-immersive.touhouTone", selectedTone);
    syncTone();
  }
  function onCaptionThemeChange() {
    write("ncm-immersive.captionTheme", captionInput.checked ? "on" : "off");
  }
  select.addEventListener("change", onThemeChange);
  toneSelect.addEventListener("change", onToneChange);
  captionInput.addEventListener("change", onCaptionThemeChange);
  const toneObserver = new MutationObserver(syncTone);
  toneObserver.observe(root, {attributes: true, attributeFilter: ["data-ncm-glass-tone"]});
  applyTheme();
  if (stockAccent(selected, currentAppearance().accent)) {
    ui.applyAppearance({accent: themes[selected][effectiveTone]});
  }

  function palette() {
    if (selected === "cover") return null;
    const preferredAccent = ui.getState().preferences.accent;
    const accent = /^#[0-9a-f]{6}$/i.test(preferredAccent) ? preferredAccent : themes[selected][effectiveTone];
    const key = selected + ":" + effectiveTone + ":" + accent;
    if (key !== paletteKey) {
      const style = getComputedStyle(root);
      const background = style.getPropertyValue("--touhou-deep").trim();
      cachedPalette = {
        id: selected,
        background,
        foreground: style.getPropertyValue("--touhou-ink").trim(),
        muted: style.getPropertyValue("--touhou-muted").trim(),
        accent,
        accentText: stockAccent(selected, accent) ? style.getPropertyValue("--touhou-on-accent").trim() : accentText(accent)
      };
      paletteKey = key;
    }
    return cachedPalette;
  }

  function accentText(accent) {
    const channels = accent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return luminance > .179 ? "#1b222a" : "#fffaf4";
  }

  return {palette, destroy() {
    select.removeEventListener("change", onThemeChange);
    toneSelect.removeEventListener("change", onToneChange);
    captionInput.removeEventListener("change", onCaptionThemeChange);
    toneObserver.disconnect();
    group.remove();
    [root, ui.host, view].forEach(element => {
      element.removeAttribute("data-ncm-touhou");
      element.removeAttribute("data-ncm-touhou-tone");
    });
  }};
}
