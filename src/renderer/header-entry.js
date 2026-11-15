function mountSettingsEntry(ui) {
  const button = document.createElement("button");
  button.id = "ncm-immersive-settings-entry";
  button.type = "button";
  button.title = "TouhouNCM · 插件设置";
  button.setAttribute("aria-label", "TouhouNCM设置");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3.5a8.7 8.7 0 1 0 7.5 7.5M5.7 12a6 6 0 0 1 4.1-5.4"/><circle cx="11.8" cy="12.2" r="2.2"/><path d="m18.2 1.7 1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1Z"/></svg>';
  function open(event) {
    event.stopPropagation();
    ui.openSettings();
    sync();
  }
  function sync() {
    if (!button.isConnected) {
      const anchor = document.querySelector('#page_pc_main_nav [data-testid="tid_header_setting_btn"]');
      // Each native icon sits inside its own badge. Join the toolbar row, not
      // the badge's inline content, so the native settings icon stays aligned.
      if (anchor) (anchor.closest(".cmd-badge") || anchor).before(button);
    }
    const expanded = String(ui.getState().settingsOpen === true);
    if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded);
  }
  button.addEventListener("click", open);
  sync();
  return {
    sync,
    destroy() { button.removeEventListener("click", open); button.remove(); }
  };
}
