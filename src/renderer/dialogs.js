// NetEase mounts its playback queue, playlist picker and sign-in dialogs outside the player root.
function watchPlayerDialogs(ui) {
  const portalSelector = "body > .cmd-portal";
  const modalSelector = ".cmd-modal-wrap, [data-testid='tid_favourite_modal']";
  const front = "data-ncm-immersive-dialog";
  const panelSelectors = [
    ["queue", "#page_pc_playlist"],
    ["search", ".SearchResults_s92u6ho"],
    ["collection", "[data-testid='tid_favourite_modal']"]
  ];
  const style = document.createElement("style");
  style.textContent = portalSelector + "[" + front + "] { z-index: 2147483100 !important; }";
  document.head.appendChild(style);
  let portals = [];
  function isVisible(element) {
    return Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility === "visible");
  }
  function sync() {
    let blocking = false;
    for (const portal of portals) {
      // PlayBarPlaylist is a native sidesheet, not a modal. Raise only its known
      // root; hidden native sheets must release the immersive focus trap.
      const queue = portal.querySelector("#page_pc_playlist");
      const visible = isVisible(queue) || [...portal.querySelectorAll(modalSelector)].some(isVisible);
      portal.toggleAttribute(front, visible);
      const panel = panelSelectors.find(([, selector]) => portal.querySelector(selector));
      if (panel) {
        if (portal.dataset.ncmPanel !== panel[0]) portal.dataset.ncmPanel = panel[0];
      } else if (portal.hasAttribute("data-ncm-panel")) portal.removeAttribute("data-ncm-panel");
      blocking = blocking || visible;
    }
    ui.setNativeDialogOpen(blocking);
  }
  const contents = new MutationObserver(sync);
  function refresh() {
    contents.disconnect();
    portals = Array.from(document.querySelectorAll(portalSelector));
    for (const portal of portals) contents.observe(portal, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    });
    sync();
  }
  const body = new MutationObserver(refresh);
  body.observe(document.body, {childList: true});
  refresh();
  return () => {
    body.disconnect();
    contents.disconnect();
    for (const portal of portals) {
      portal.removeAttribute(front);
      portal.removeAttribute("data-ncm-panel");
    }
    style.remove();
    ui.setNativeDialogOpen(false);
  };
}
