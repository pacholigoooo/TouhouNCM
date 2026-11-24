function createSimplifyControls() {
  const entries = [
    { id: "recommend", label: "推荐入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_recommend"]' },
    { id: "choice", label: "精选入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_choice"]' },
    { id: "podcasts", label: "播客与我的播客", selector: '#page_pc_main_tab [data-testid="tid_navitem_audio"], #page_pc_main_tab [data-testid="tid_navitem_myAudio"]' },
    { id: "roam", label: "漫游入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_privateFm"]' },
    { id: "community", label: "关注动态入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_community"]' },
    { id: "pet", label: "顶部宠物模式入口", selector: '[data-ncm-pet-entry]' },
    { id: "messages", label: "顶部消息入口", selector: '#page_pc_main_nav [data-ncm-simplify-entry="messages"]' },
    { id: "decoration", label: "顶部换肤入口", selector: '#page_pc_main_nav [data-ncm-simplify-entry="decoration"]' }
  ];
  const distractionEntries = [
    { id: "notificationBadges", label: "隐藏通知红点", selector: '#page_pc_main_nav .cmd-badge > .cmd-badge-primary, #page_pc_main_tab .cmd-badge > .cmd-badge-primary' },
    { id: "marketingNotifications", label: "屏蔽推广弹窗", selector: '[data-ncm-marketing-notification]' },
    { id: "ads", label: "屏蔽页面广告", selector: '#root [class*="AdvertisementContainer_"], #root [class*="AdvertisementCardWrapper_"], #root [class*="ClosableBannerWrapper_"]' }
  ];
  const controls = entries.concat(distractionEntries);
  const toolbarSlot = '[class*="MiniModeIconBar_"] > *';
  // The same header slot shows an egg before the first visit, a cat after
  // visiting, or an icon with a progress bar while a pet is being generated.
  const petIcons = '.cmd-icon-mini-pet, [class*="EggFlashWrap_"], [class*="PetEntryIconWrap_"], [title="宠物模式"], [aria-label="宠物模式"]';
  const petPopovers = ["mod_pc_desktop_pet_guide", "mod_pc_desktop_pet_entry_float", "mod_pc_desktop_pet_progress"]
    .map(oid => '[data-log*=\'"' + oid + '"\']').join(", ");
  const guideSelector = [
    "cell_pc_nav_bar_vip_guide", "cell_pc_nav_bar_ad_guide",
    "mod_pc_desktop_pet_guide", "btn_pc_mini_bar_guide_up"
  ].map(oid => '[data-log*=\'"' + oid + '"\']').join(", ");
  const promotionModalSelector = '.modal-general-send-vip, [data-log*=\'"mod_pc_home_ad_renew"\']';
  const key = "ncm-immersive.simplify";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (_) {}
  const state = Object.fromEntries(controls.map(item => [item.id, saved?.[item.id] === true]));
  const sheet = document.createElement("style");
  sheet.id = "ncm-immersive-simplify-style";
  sheet.textContent = controls.map(item => item.selector.split(", ").map(selector =>
    'html[data-ncm-simplify~="' + item.id + '"] ' + selector
  ).join(",\n") + " { display: none !important; }").join("\n");
  document.head.appendChild(sheet);
  const marked = new Set();
  let petNodes = new Set();
  let hiddenGuides = new Set();
  let dismissedButtons = new Set();

  function mark(node, attribute, value = "") {
    if (!node) return;
    if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
    marked.add(node);
  }

  function updateMarkers(previous, next, attribute) {
    for (const node of previous) if (!next.has(node)) node.removeAttribute(attribute);
    for (const node of next) if (!node.hasAttribute(attribute)) node.setAttribute(attribute, "");
    return next;
  }

  function syncPetEntry(nav) {
    if (!state.pet && !petNodes.size) return;
    const next = new Set();
    if (state.pet) {
      for (const icon of nav?.querySelectorAll(petIcons) || []) {
        next.add(icon.closest(toolbarSlot) || icon.closest('button, [role="button"], .cmd-badge') || icon);
      }
      for (const portal of document.querySelectorAll(".cmd-portal")) {
        for (const content of portal.querySelectorAll(petPopovers)) {
          next.add(content.closest(".cmd-popover-wrapper") || content);
        }
      }
    }
    petNodes = updateMarkers(petNodes, next, "data-ncm-pet-entry");
  }

  function syncPromotions() {
    if (!state.marketingNotifications && !hiddenGuides.size && !dismissedButtons.size) return;
    const guides = new Set(), buttons = new Set();
    if (state.marketingNotifications) {
      for (const content of document.querySelectorAll(guideSelector)) {
        guides.add(content.closest('.cmd-popover-wrapper, [class*="BubbleWrapper_"]') || content);
      }
      for (const content of document.querySelectorAll(promotionModalSelector)) {
        const modal = content.closest('.cmd-modal-wrap, [class*="ModalWrapper_"]') || content.closest(".cmd-modal");
        const button = (modal || content).querySelector(".cmd-modal-close");
        if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length) buttons.add(button);
      }
    }
    hiddenGuides = updateMarkers(hiddenGuides, guides, "data-ncm-marketing-notification");
    // The native close action also releases the modal mask and keyboard focus.
    const previous = dismissedButtons;
    dismissedButtons = buttons;
    for (const button of buttons) if (!previous.has(button) && button.isConnected) button.click();
  }

  function sync() {
    for (const node of marked) {
      if (!node.isConnected) marked.delete(node);
    }
    const nav = document.getElementById("page_pc_main_nav");
    syncPetEntry(nav);
    for (const [id, selector] of [
      ["messages", '[data-testid="tid_header_msg_btn"]'],
      ["decoration", '[data-testid="tid_header_skin_btn"]']
    ]) {
      const icon = nav?.querySelector(selector);
      // The badge owns the red dot and toolbar slot, not the icon inside it.
      const item = icon?.closest(toolbarSlot);
      mark(item || icon?.closest(".cmd-badge") || icon, "data-ncm-simplify-entry", id);
    }
    syncPromotions();
  }
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-log"] });

  function apply() {
    const active = controls.filter(item => state[item.id]).map(item => item.id).join(" ");
    if (active) document.documentElement.setAttribute("data-ncm-simplify", active);
    else document.documentElement.removeAttribute("data-ncm-simplify");
  }
  function save() {
    apply();
    sync();
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
  }
  sync();
  if (saved && Object.prototype.hasOwnProperty.call(saved, "recognize")) save();
  else apply();
  return {
    sync,
    items: entries.map(({ id, label }) => ({ id, label })),
    distractionItems: distractionEntries.map(({ id, label }) => ({ id, label })),
    get: () => Object.assign({}, state),
    set(id, hidden) {
      if (!Object.prototype.hasOwnProperty.call(state, id)) return;
      state[id] = Boolean(hidden);
      save();
    },
    reset(group = "entries") {
      (group === "distractions" ? distractionEntries : entries).forEach(item => { state[item.id] = false; });
      save();
    },
    destroy() {
      observer.disconnect();
      sheet.remove();
      for (const node of petNodes) node.removeAttribute("data-ncm-pet-entry");
      petNodes.clear();
      for (const node of hiddenGuides) node.removeAttribute("data-ncm-marketing-notification");
      hiddenGuides.clear();
      dismissedButtons.clear();
      for (const node of marked) node.removeAttribute("data-ncm-simplify-entry");
      marked.clear();
      document.documentElement.removeAttribute("data-ncm-simplify");
    }
  };
}
