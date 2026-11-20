function mountImmersiveRuntime(version, viewCss, nativeCss, config) {
  const bridge = window.NCMImmersiveBridge;
  const dispose = [];
  let runtime;
  let destroyed = false;
  let captionWithHint = null;

  function clearCaptionHint() {
    if (captionWithHint) captionWithHint.removeAttribute("title");
    captionWithHint = null;
  }

  function showCaptionHint(event) {
    const caption = event.target.closest?.('[data-testid="tid_playlist_card_title"]');
    if (caption === captionWithHint) return;
    clearCaptionHint();
    if (caption && !caption.hasAttribute("title") && caption.scrollHeight > caption.clientHeight + 1) {
      caption.title = caption.textContent.trim();
      captionWithHint = caption;
    }
  }

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("pagehide", cleanup);
    // Each completed mount registers its inverse immediately. A failed native
    // restore must still let the remaining listeners and visual layers detach.
    for (const release of dispose.reverse()) {
      try { release(); }
      catch (error) { console.error("沉浸听歌组件清理失败", error); }
    }
    if (window.__pachiImmersive === runtime) delete window.__pachiImmersive;
    if (window.NCMImmersiveBridge === bridge) delete window.NCMImmersiveBridge;
    delete window.NcmImmersiveView;
    delete window.createNCMImmersiveBridge;
    delete window.createTouhouOriginClient;
    delete window.NcmTouhouNames;
    delete window.NcmCharacterProfiles;
    delete window.NcmCharacterPalettes;
    delete window.NcmCharacterAffinities;
    delete window.NcmCharacterMusic;
    delete window.NcmCharacterArt;
    delete window.NcmCharacterQuiz;
    delete window.NcmCharacterExport;
    delete window.NcmClientApi;
    delete window.NcmUpdates;
  }

  dispose.push(() => bridge.dispose());
  try {
    const glass = createGlassArtwork();
    dispose.push(() => glass.destroy());
    const simplify = createSimplifyControls();
    dispose.push(() => simplify.destroy());
    const ui = window.NcmImmersiveView.mount(bridge, viewCss, {
      onClose: bridge.closeDetail,
      onCover: glass.update,
      simplify
    });
    dispose.push(() => ui.destroy());
    const characterExport = window.NcmCharacterExport;
    if (characterExport) dispose.push(() => characterExport.dispose());

    const sheet = document.createElement("style");
    sheet.id = "ncm-immersive-native-style";
    sheet.textContent = nativeCss;
    document.head.appendChild(sheet);
    dispose.push(() => sheet.remove());
    document.documentElement.setAttribute("data-ncm-skin", "desktop");
    dispose.push(() => document.documentElement.removeAttribute("data-ncm-skin"));
    const settingsEntry = mountSettingsEntry(ui);
    dispose.push(() => settingsEntry.destroy());
    const updates = mountUpdateSettings(ui, config);
    dispose.push(() => updates.destroy());
    const touhouThemes = mountTouhouThemes(ui);
    dispose.push(() => touhouThemes.destroy());
    const origins = window.createTouhouOriginClient();
    dispose.push(() => origins.dispose());
    const originCard = mountOriginCard(ui, bridge, origins);
    dispose.push(() => originCard.destroy());
    document.addEventListener("pointerover", showCaptionHint);
    dispose.push(() => {
      document.removeEventListener("pointerover", showCaptionHint);
      clearCaptionHint();
    });

    const stopDialogs = watchPlayerDialogs(ui);
    dispose.push(stopDialogs);
    const stopLyrics = watchDesktopLyrics(bridge, touhouThemes.palette);
    dispose.push(stopLyrics);
    dispose.push(mountDesktopLyricSettings(() => stopLyrics.getState().preferences));
    try { dispose.push(mountDesktopLyricMenu(() => stopLyrics.getState().preferences)); }
    catch (error) { console.warn("TouhouNCM 桌面歌词菜单", error.message); }
    dispose.push(() => setMinibarPalette(null, glass.palette));
    let lastColor;
    const stopWatching = bridge.subscribe(snapshot => {
      settingsEntry.sync();
      simplify.sync();
      if (lastColor !== snapshot.coverColor) {
        lastColor = snapshot.coverColor;
        setMinibarPalette(lastColor, glass.palette);
      }
      if (snapshot.detailState === "opening" || snapshot.detailState === "opened") ui.open();
      else if (snapshot.detailState === "closed") ui.close();
    });
    dispose.push(stopWatching);
    runtime = {
      version, releaseVersion: config.version, updates,
      state: () => ui.getState(),
      openSettings: ui.openSettings,
      desktopLyrics: stopLyrics.getState,
      desktopCaption: stopLyrics.caption,
      desktopAction: stopLyrics.action,
      miniSnapshot: makeMiniSnapshot(bridge, glass, touhouThemes.palette),
      miniAction: bridge.miniAction,
      characterExportReady: session => characterExport?.nativeReady(session),
      characterExportTake: () => characterExport?.takeRequest() || null,
      characterExportChunk: (id, offset) => characterExport?.readChunk(id, offset),
      characterExportFinish: (id, result) => characterExport?.finish(id, result),
      reclaimNativeStyleCache() {
        if (destroyed || !document.hidden || !sheet.isConnected) return false;
        // CEF 91 retains native style allocations across repeated updates.
        // A no-op rule edit invalidates that cache while preserving every rule.
        const css = sheet.sheet;
        if (!css) return false;
        const index = css.cssRules.length;
        css.insertRule(":root {}", index);
        css.deleteRule(index);
        return true;
      },
      destroy: cleanup
    };
    window.__pachiImmersive = runtime;
    window.addEventListener("pagehide", cleanup, { once: true });
    try { window.__pachiNcmImmersiveNativeWake?.("ready"); }
    catch (error) { console.warn("TouhouNCM 原生窗口唤醒", error.message); }
    return "ready";
  } catch (error) {
    cleanup();
    throw error;
  }
}
