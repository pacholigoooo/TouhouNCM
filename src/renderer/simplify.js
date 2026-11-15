function createSimplifyControls() {
  const entries = [
    { id: "recommend", label: "推荐入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_recommend"]' },
    { id: "choice", label: "精选入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_choice"]' },
    { id: "podcasts", label: "播客与我的播客", selector: '#page_pc_main_tab [data-testid="tid_navitem_audio"], #page_pc_main_tab [data-testid="tid_navitem_myAudio"]' },
    { id: "roam", label: "漫游入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_privateFm"]' },
    { id: "community", label: "关注动态入口", selector: '#page_pc_main_tab [data-testid="tid_navitem_community"]' },
    { id: "pet", label: "宠物模式", selector: '#page_pc_main_nav [data-ncm-simplify-entry="pet"]' },
    { id: "messages", label: "顶部消息入口", selector: '#page_pc_main_nav [data-ncm-simplify-entry="messages"]' },
    { id: "decoration", label: "顶部换肤入口", selector: '#page_pc_main_nav [data-ncm-simplify-entry="decoration"]' }
  ];
  const distractionEntries = [
    { id: "notificationBadges", label: "隐藏通知红点", selector: '#page_pc_main_nav .cmd-badge > .cmd-badge-primary, #page_pc_main_tab .cmd-badge > .cmd-badge-primary' },
    { id: "marketingNotifications", label: "屏蔽推广弹窗", selector: '[data-ncm-marketing-notification]' },
    { id: "ads", label: "屏蔽页面广告", selector: '#root [class*="AdvertisementContainer_"], #root [class*="AdvertisementCardWrapper_"], #root [class*="ClosableBannerWrapper_"]' }
  ];
  const controls = entries.concat(distractionEntries);
  // Native marketing components confirmed in the client's bundled source.
  // Keep ordinary toasts, playback notices and user-opened dialogs available.
  const marketingSelector = [
    "cell_pc_nav_bar_vip_guide", "cell_pc_nav_bar_ad_guide",
    "mod_pc_desktop_pet_guide", "btn_pc_mini_bar_guide_up", "mod_pc_home_ad_renew"
  ].map(oid => '[data-log*=\'"' + oid + '"\']').concat('.modal-general-send-vip').join(", ");
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

  function mark(node, attribute, value = "") {
    if (!node) return;
    if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
    marked.add(node);
  }

  function sync() {
    for (const node of marked) {
      if (!node.isConnected) marked.delete(node);
    }
    for (const [id, selector] of [
      ["messages", '[data-testid="tid_header_msg_btn"]'],
      ["decoration", '[data-testid="tid_header_skin_btn"]'],
      ["pet", '.cmd-icon-mini-pet']
    ]) {
      const icon = document.querySelector('#page_pc_main_nav ' + selector);
      // The badge owns the red dot and toolbar slot, not the icon inside it.
      const item = icon?.closest('[class*="MiniModeIconBar_"] > *');
      mark(item || icon?.closest(".cmd-badge") || icon, "data-ncm-simplify-entry", id);
    }
    document.querySelectorAll(marketingSelector).forEach(content => {
      const modal = content.closest('[class*="ModalWrapper_"]');
      const container = modal || content.closest('.cmd-popover-wrapper, [class*="BubbleWrapper_"]') || content;
      mark(container, "data-ncm-marketing-notification");
      // Dismiss known marketing modals through their own close action so their
      // focus trap and scroll lock are released along with the backdrop.
      if (state.marketingNotifications && modal && !dismissed.has(modal)) {
        const close = modal.querySelector(".cmd-modal-close");
        if (close) { dismissed.add(modal); close.click(); }
      }
    });
  }
  const dismissed = new WeakSet();
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
      for (const node of marked) {
        node.removeAttribute("data-ncm-simplify-entry");
        node.removeAttribute("data-ncm-marketing-notification");
      }
      marked.clear();
      document.documentElement.removeAttribute("data-ncm-simplify");
    }
  };
}
