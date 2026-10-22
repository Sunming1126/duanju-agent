/* Navigation, contextual sheets and per-site appearance. No creation state lives here. */
(() => {
  'use strict';
  const one = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const presets = new Set(['water', 'cloud', 'dune', 'plain']);
  const storageKey = `duanju.background.${window.SITE_MARKET || 'japan'}`;
  const views = {
    studio: ['navCreate', 'introCreate', 'studioReference', 'referenceMaterials'],
    writer: ['navCreate', 'introCreate', 'writerResources', 'historyAndLibrary'],
    hub: ['navLibrary', 'introLibrary', 'resourceImport', 'importRes'],
    inspire: ['navIdeas', 'introIdeas', 'inspirationRelated', 'relatedAndCompare'],
    graph: ['navGraph', 'introGraph'],
    hooks: ['hooks', 'introHooks', 'hookTools', 'hookToolsTitle'],
    cats: ['cats', 'introCategories', 'categoryInfo', 'catHelpTitle'],
  };
  let currentView = 'studio';
  let creationMode = 'studio';
  let activeDrawer = null;
  let drawerTrigger = null;
  const picker = one('#backgroundPopover');
  const backgroundButton = one('#btnBackground');
  const contextButton = one('#btnContext');
  const tools = one('#toolsMenu');
  const focusable = (container) => allIn(container, 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]');
  function allIn(container, selector) {
    return [...container.querySelectorAll(selector)].filter((el) => !el.closest('.hidden') && !el.hidden && el.getClientRects().length);
  }

  function applyBackground(value, persist = false) {
    const selected = presets.has(value) ? value : 'water';
    document.body.dataset.background = selected;
    all('[data-background].background-option').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.background === selected));
    });
    if (persist) {
      try { localStorage.setItem(storageKey, selected); } catch { /* Session-only when storage is unavailable. */ }
    }
  }
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch { saved = null; }
  applyBackground(saved);

  function closeBackground(restoreFocus = false) {
    picker.classList.add('hidden');
    backgroundButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) backgroundButton.focus();
  }
  backgroundButton.addEventListener('click', () => {
    const opening = picker.classList.contains('hidden');
    closeDrawer();
    tools.open = false;
    picker.classList.toggle('hidden', !opening);
    backgroundButton.setAttribute('aria-expanded', String(opening));
    if (opening) picker.querySelector('[aria-pressed="true"]').focus();
  });
  one('#closeBackground').addEventListener('click', () => closeBackground(true));
  all('.background-option').forEach((button) => button.addEventListener('click', () => applyBackground(button.dataset.background, true)));

  function openDrawer(id, trigger = document.activeElement) {
    const drawer = document.getElementById(id);
    if (!drawer || !drawer.classList.contains('drawer') || drawer.closest('main.hidden')) return;
    closeDrawer();
    closeBackground();
    tools.open = false;
    drawerTrigger = trigger;
    activeDrawer = drawer;
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-modal', 'true');
    one('#drawerBackdrop').classList.remove('hidden');
    document.body.classList.add('drawer-open');
    contextButton.setAttribute('aria-expanded', 'true');
    if (trigger?.setAttribute) trigger.setAttribute('aria-expanded', 'true');
    drawer.focus({ preventScroll: true });
  }
  function closeDrawer(restoreFocus = false) {
    if (!activeDrawer) return;
    activeDrawer.classList.add('hidden');
    activeDrawer.removeAttribute('aria-modal');
    one('#drawerBackdrop').classList.add('hidden');
    document.body.classList.remove('drawer-open');
    contextButton.setAttribute('aria-expanded', 'false');
    if (drawerTrigger?.setAttribute) drawerTrigger.setAttribute('aria-expanded', 'false');
    const previous = drawerTrigger;
    activeDrawer = null;
    drawerTrigger = null;
    if (restoreFocus && previous?.isConnected && !previous.closest('.hidden')) previous.focus();
  }
  function toggleDrawer(id, trigger) {
    if (activeDrawer?.id === id) closeDrawer(true);
    else openDrawer(id, trigger);
  }
  contextButton.addEventListener('click', () => toggleDrawer(views[currentView][2], contextButton));
  all('[data-open-drawer]').forEach((button) => button.addEventListener('click', () => toggleDrawer(button.dataset.openDrawer, button)));
  // Dismiss before the native click, without cancelling it or replaying an action.
  // The backdrop is visual only, so the intended outside control receives the first click.
  document.addEventListener('pointerdown', (event) => {
    if (!activeDrawer || event.target.closest('.drawer') || event.target.closest('#modalMask')) return;
    if (event.target.closest('#btnContext') || event.target.closest('[data-open-drawer]')) return;
    closeDrawer();
  }, true);
  all('[data-close-drawer]').forEach((button) => button.addEventListener('click', () => closeDrawer(true)));
  one('#drawerBackdrop').addEventListener('click', () => closeDrawer(true));

  function refreshLabels() {
    const [title, intro, drawerId, action] = views[currentView];
    one('#pageTitle').textContent = window.t(title);
    one('#pageDescription').textContent = window.t(intro);
    document.title = `${window.t(title)} · ${window.t('brandName')}`;
    contextButton.classList.toggle('hidden', !drawerId);
    if (drawerId) {
      contextButton.textContent = window.t(action);
      contextButton.setAttribute('aria-controls', drawerId);
    }
    one('#creationModes').classList.toggle('hidden', !['studio', 'writer'].includes(currentView));
    one('#creationModes').setAttribute('aria-label', window.t('creationMode'));
    one('#mainnav').setAttribute('aria-label', window.t('mainNavigation'));
    one('#globalLocaleSelect').setAttribute('aria-label', window.t('interfaceLanguage'));
    all("[data-i18n-aria-label]").forEach((el) => el.setAttribute("aria-label", window.t(el.dataset.i18nAriaLabel)));
    picker.setAttribute('aria-label', window.t('chooseBackground'));
    all('.icon-button').forEach((button) => button.setAttribute('aria-label', window.t('close')));
    const zoom = one('#zoomChip');
    if (zoom) {
      const value = zoom.textContent.match(/[0-9]+(?:\.[0-9]+)?/);
      zoom.textContent = window.t('gZoom', { v: value ? value[0] : '1.0' });
    }
    const state = one('#svcStatus').dataset.state;
    if (state) one('#statusText').textContent = window.t(state === 'ok' ? 'svcOk' : 'svcOff');
  }
  function onView(view) {
    if (!views[view]) return;
    closeDrawer();
    closeBackground();
    tools.open = false;
    currentView = view;
    if (view === 'studio' || view === 'writer') creationMode = view;
    all('.navtab').forEach((button) => {
      const selected = button.dataset.view === view || (button.dataset.view === 'studio' && view === 'writer');
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    tools.classList.toggle('active', ['hooks', 'cats'].includes(view));
    all('[data-mode]').forEach((button) => {
      const selected = button.dataset.mode === creationMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    refreshLabels();
  }
  all('[data-mode]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.mode)));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.background-control')) closeBackground();
    if (!event.target.closest('#toolsMenu')) tools.open = false;
    if (event.target.closest('#toolsMenu button')) tools.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeDrawer) { closeDrawer(true); event.preventDefault(); }
      else if (!picker.classList.contains('hidden')) { closeBackground(true); event.preventDefault(); }
      else if (tools.open) { tools.open = false; tools.querySelector('summary').focus(); }
    }
    if (event.key === 'Tab' && activeDrawer && !one('#modalMask')) {
      const items = focusable(activeDrawer);
      if (!items.length) { event.preventDefault(); activeDrawer.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === activeDrawer)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === activeDrawer)) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('focusin', (event) => {
    if (!picker.classList.contains('hidden') && !event.target.closest('.background-control')) closeBackground();
  });
  one('#hubDropZone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); one('#hubFileInput').click(); }
  });
  // Browser tabs at the same origin can keep their appearance in sync.
  window.addEventListener('storage', (event) => { if (event.key === storageKey) applyBackground(event.newValue); });
  document.addEventListener('duanju:locale', refreshLabels);
  window.WorkspaceUI = { onView, openDrawer, closeDrawer, creationMode: () => creationMode };
  window.duanjuApplyI18n();
  switchView('studio');
})();
