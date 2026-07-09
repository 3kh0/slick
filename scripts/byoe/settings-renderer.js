'use strict';

(() => {
  if (window.__slickSettingsLoaded) return 'already-loaded';
  window.__slickSettingsLoaded = true;

  const S = window.__slickSettings || { controlUrl: 'https://slick.control/', plugins: [], themes: [], theme: '' };
  const TAB_ID = 'slick';
  const CUSTOM_THEME_ID = '__custom__';
  const SEL = {
    overlay: '.p-prefs_dialog',
    modal: '.p-prefs_dialog__modal',
    menu: '.p-prefs_dialog__menu',
    panel: '.p-prefs_dialog__panel',
  };
  const $ = (id) => document.getElementById(id);
  const q = (sel) => document.querySelector(sel);

  const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" data-rrf="true" aria-hidden="true" class="" width="15" height="15" style="display:block;width:15px;height:15px">' +
    '<path fill="currentColor" fill-rule="evenodd" d="m9.151 3.676.271-1.108a2.5 2.5 0 0 1 1.156 0l.271 1.108a2 2 0 0 0 3.022 1.252l.976-.592a2.5 2.5 0 0 1 .817.817l-.592.975a2 2 0 0 0 1.252 3.023l1.108.27c.09.38.09.777 0 1.157l-1.108.27a2 2 0 0 0-1.252 3.023l.592.975a2.5 2.5 0 0 1-.817.818l-.976-.592a2 2 0 0 0-3.022 1.251l-.271 1.109a2.5 2.5 0 0 1-1.156 0l-.27-1.108a2 2 0 0 0-3.023-1.252l-.975.592a2.5 2.5 0 0 1-.818-.818l.592-.975a2 2 0 0 0-1.252-3.022l-1.108-.271a2.5 2.5 0 0 1 0-1.156l1.108-.271a2 2 0 0 0 1.252-3.023l-.592-.975a2.5 2.5 0 0 1 .818-.817l.975.592A2 2 0 0 0 9.15 3.676m2.335-2.39a4 4 0 0 0-2.972 0 .75.75 0 0 0-.45.518l-.372 1.523-.004.018a.5.5 0 0 1-.758.314l-.016-.01-1.34-.813a.75.75 0 0 0-.685-.048 4 4 0 0 0-2.1 2.1.75.75 0 0 0 .047.685l.814 1.34.01.016a.5.5 0 0 1-.314.759l-.018.004-1.523.372a.75.75 0 0 0-.519.45 4 4 0 0 0 0 2.971.75.75 0 0 0 .519.45l1.523.373.018.004a.5.5 0 0 1 .314.758l-.01.016-.814 1.34a.75.75 0 0 0-.048.685 4 4 0 0 0 2.101 2.1.75.75 0 0 0 .685-.048l1.34-.813.016-.01a.5.5 0 0 1 .758.314l.004.018.372 1.523a.75.75 0 0 0 .45.518 4 4 0 0 0 2.972 0 .75.75 0 0 0 .45-.518l.372-1.523.004-.018a.5.5 0 0 1 .758-.314l.016.01 1.34.813a.75.75 0 0 0 .685.049 4 4 0 0 0 2.101-2.101.75.75 0 0 0-.048-.685l-.814-1.34-.01-.016a.5.5 0 0 1 .314-.758l.018-.004 1.523-.373a.75.75 0 0 0 .519-.45 4 4 0 0 0 0-2.97.75.75 0 0 0-.519-.45l-1.523-.373-.018-.004a.5.5 0 0 1-.314-.759l.01-.015.814-1.34a.75.75 0 0 0 .048-.685 4 4 0 0 0-2.101-2.101.75.75 0 0 0-.685.048l-1.34.814-.016.01a.5.5 0 0 1-.758-.315l-.004-.017-.372-1.524a.75.75 0 0 0-.45-.518M8 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0m2-3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7" clip-rule="evenodd"/></svg>';

  function ctl(params) {
    try {
      fetch(S.controlUrl + '?' + new URLSearchParams(params), { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    } catch {}
  }

  if (!$('slick-settings-style')) {
    const st = document.createElement('style');
    st.id = 'slick-settings-style';
    st.textContent = [
      '#slick-panel-overlay{position:fixed;z-index:1200;overflow-y:auto;box-sizing:border-box;padding:20px 28px}',
      '#slick-panel-overlay .slick-intro{margin:0 0 18px;opacity:.62;line-height:1.45}',
      '#slick-panel-overlay .slick-legend{margin:0 0 12px}',
      '#slick-panel-overlay .slick-plugin{padding:14px 0;border-top:1px solid rgba(127,127,127,.16);position:relative}',
      '#slick-panel-overlay .slick-plugin:last-of-type{border-bottom:1px solid rgba(127,127,127,.16)}',
      '#slick-panel-overlay .slick-plugin .c-label{margin:0}',
      '#slick-applybar{position:sticky;bottom:-20px;margin:20px -28px -20px;padding:14px 28px;display:flex;align-items:center;gap:14px;background:rgba(127,127,127,.10);border-top:1px solid rgba(127,127,127,.2);backdrop-filter:blur(8px)}',
      '#slick-applybar .slick-msg{flex:1;opacity:.85}',
      '#slick-applybar.hidden{display:none}',
      '#slick-panel-overlay .slick-cog{display:inline-block;opacity:.55;padding:2px;margin-left:8px;vertical-align:text-bottom;border-radius:4px;cursor:pointer}',
      '#slick-panel-overlay .slick-cog:hover,#slick-panel-overlay .slick-cog:focus-visible{opacity:1;background:rgba(127,127,127,.2)}',
      '#slick-panel-overlay .slick-cog:focus-visible{outline:2px solid rgba(29,155,209,.65);outline-offset:1px}',
      '#slick-config-backdrop{position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}',
      '#slick-config-modal{width:560px;max-width:90vw;max-height:80vh;overflow-y:auto;border-radius:12px;padding:20px 28px;box-shadow:0 18px 48px rgba(0,0,0,.35)}',
      '#slick-config-modal .slick-config-head{display:flex;align-items:center;margin-bottom:4px}',
      '#slick-config-modal .slick-config-head .c-legend{flex:1;margin:0}',
      '#slick-config-modal .slick-config-close{opacity:.6;font-size:22px;line-height:1;padding:2px 8px;border-radius:4px}',
      '#slick-config-modal .slick-config-close:hover{opacity:1;background:rgba(127,127,127,.2)}',
      '#slick-config-modal .slick-plugin[data-cfg-kind="text"] .c-label,#slick-config-modal .slick-plugin[data-cfg-kind="number"] .c-label,#slick-config-modal .slick-plugin[data-cfg-kind="select"] .c-label{display:block;width:100%}',
      '#slick-config-modal .slick-plugin[data-cfg-kind="text"] .c-label__text,#slick-config-modal .slick-plugin[data-cfg-kind="number"] .c-label__text,#slick-config-modal .slick-plugin[data-cfg-kind="select"] .c-label__text{display:block;margin-bottom:8px;width:100%}',
      '#slick-config-modal .slick-plugin[data-cfg-kind="text"] .c-label__children,#slick-config-modal .slick-plugin[data-cfg-kind="number"] .c-label__children,#slick-config-modal .slick-plugin[data-cfg-kind="select"] .c-label__children{display:block;width:100%}',
      '#slick-config-modal .slick-cfg-text{width:100%;box-sizing:border-box}',
      '#slick-config-modal .slick-cfg-select{width:100%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit}',
      '#slick-config-modal .slick-cfg-color{width:36px;height:24px;padding:0;border:1px solid rgba(127,127,127,.4);border-radius:6px;background:transparent;cursor:pointer}',
      '#slick-config-modal .slick-cfg-file{display:flex;align-items:center;gap:8px;width:100%}',
      '#slick-config-modal .slick-cfg-file .slick-cfg-text{flex:1;min-width:0}',
      '#slick-config-modal .slick-cfg-file .slick-cfg-file-button{flex:none}',
      '#slick-config-modal .slick-config-note{margin:14px 0 0;opacity:.55;font-size:12px}',
      '#slick-config-modal .slick-restart-required{display:inline-block;margin-left:8px;padding:1px 6px;border-radius:999px;background:rgba(224,30,90,.14);color:#e01e5a;font-size:11px;font-weight:600}',
      '#slick-panel-overlay .slick-customcss-edit{position:absolute;top:50%;right:0;transform:translateY(-50%)}',
      '#slick-panel-overlay .slick-editor-back{opacity:.7;padding:4px 0;font-size:13px}',
      '#slick-panel-overlay .slick-editor-back:hover{opacity:1}',
      '#slick-panel-overlay .slick-customcss-editor{width:100%;min-height:320px;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;padding:10px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.06);color:inherit;resize:vertical;tab-size:2}',
      '#slick-panel-overlay .slick-customcss-editor:focus{outline:2px solid rgba(29,155,209,.5);outline-offset:1px}',
    ].join('\n');
    document.head.appendChild(st);
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );

  function row(text, sub, control, attrs = '', extra = '') {
    sub = sub ? '<span class="c-label__subtext" data-qa-label-subtext="true">' + esc(sub) + '</span>' : '';
    return (
      '<div class="slick-plugin"' +
      attrs +
      '>' +
      '<label class="c-label c-label--inline' +
      (sub ? ' c-label--with_subtext' : '') +
      ' c-label--pointer" data-qa-label="true">' +
      '<span class="c-label__text" data-qa-label-text="true">' +
      text +
      sub +
      '</span>' +
      '<span class="c-label__children" data-qa-label-children="true">' +
      control +
      '</span>' +
      '</label>' +
      extra +
      '</div>'
    );
  }

  const pluginRow = (p) =>
    row(
      esc(p.name) +
        (p.settings && p.settings.length
          ? '<span class="c-button-unstyled slick-cog" role="button" tabindex="0" data-cog="' +
            esc(p.dir) +
            '" aria-haspopup="dialog" aria-label="Configure ' +
            esc(p.name) +
            '">' +
            ICON +
            '</span>'
          : ''),
      p.description,
      '<input class="c-input_checkbox" type="checkbox" data-plugin="' +
        esc(p.dir) +
        '"' +
        (p.enabled ? ' checked' : '') +
        '>',
      ' data-plugin-row="' + esc(p.dir) + '"',
    );

  function settingControl(dir, def, value) {
    const data =
      ' data-cfg-plugin="' +
      esc(dir) +
      '" data-cfg-key="' +
      esc(def.key) +
      '"' +
      (def.restartRequired ? ' data-cfg-restart="1"' : '');
    if (def.type === 'boolean')
      return '<input class="c-input_checkbox" type="checkbox"' + data + (value ? ' checked' : '') + '>';
    if (def.type === 'select')
      return (
        '<select class="slick-cfg-select"' +
        data +
        '>' +
        (def.options || [])
          .map((o) => {
            const v = o && o.value !== undefined ? o.value : o;
            const label = (o && o.label) || v;
            return (
              '<option value="' +
              esc(v) +
              '"' +
              (String(v) === String(value) ? ' selected' : '') +
              '>' +
              esc(label) +
              '</option>'
            );
          })
          .join('') +
        '</select>'
      );
    if (def.type === 'color')
      return '<input class="slick-cfg-color" type="color"' + data + ' value="' + esc(value) + '">';
    if (def.type === 'file')
      return (
        '<span class="slick-cfg-file">' +
        '<input class="c-input_text slick-cfg-text" type="text"' +
        data +
        ' value="' +
        esc(value) +
        '">' +
        '<button class="c-button c-button--outline c-button--small slick-cfg-file-button" type="button"' +
        data +
        ' data-cfg-file-pick="1">Browse</button>' +
        '</span>'
      );
    if (def.type === 'number')
      return '<input class="c-input_text slick-cfg-text" type="number"' + data + ' value="' + esc(value) + '">';
    return '<input class="c-input_text slick-cfg-text" type="text"' + data + ' value="' + esc(value) + '">';
  }

  function closeConfig() {
    const bd = $('slick-config-backdrop');
    if (!bd) return;
    if (bd.__onKey) document.removeEventListener('keydown', bd.__onKey, true);
    bd.remove();
  }

  function refreshConfigFields() {
    const modal = $('slick-config-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-cfg-plugin][data-cfg-key]').forEach((input) => {
      if (input.getAttribute('data-cfg-file-pick') === '1') return;
      const plugin = input.getAttribute('data-cfg-plugin');
      const key = input.getAttribute('data-cfg-key');
      const p = (S.plugins || []).find((entry) => entry.dir === plugin);
      if (!p || !p.values || p.values[key] === undefined) return;
      if (input.type === 'checkbox') input.checked = !!p.values[key];
      else input.value = p.values[key];
    });
  }

  function openConfig(p) {
    closeConfig();
    const bd = document.createElement('div');
    bd.id = 'slick-config-backdrop';
    bd.innerHTML =
      '<div id="slick-config-modal" role="dialog" aria-modal="true">' +
      '<div class="slick-config-head">' +
      '<div class="c-legend">' +
      esc(p.name) +
      '</div>' +
      '<button class="c-button-unstyled slick-config-close" type="button" aria-label="Close">&times;</button>' +
      '</div>' +
      p.settings
        .map((def) =>
          row(
            esc(def.label) +
              (def.restartRequired ? '<span class="slick-restart-required">Restart required</span>' : ''),
            def.description,
            settingControl(p.dir, def, p.values[def.key]),
            ' data-cfg-kind="' + esc(def.type) + '"',
          ),
        )
        .join('') +
      '</div>';
    document.body.appendChild(bd);

    const modal = bd.firstChild;
    const mref = q(SEL.modal);
    if (mref) modal.style.background = getComputedStyle(mref).backgroundColor;

    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('.slick-config-close')) closeConfig();
    });
    bd.__onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeConfig();
    };
    document.addEventListener('keydown', bd.__onKey, true);

    modal.addEventListener('change', (e) => {
      const t = e.target;
      const plugin = t.getAttribute('data-cfg-plugin');
      if (!plugin) return;
      const key = t.getAttribute('data-cfg-key');
      const value = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
      ctl({ op: 'cfg', plugin, key, value });
      p.values[key] = t.type === 'checkbox' ? t.checked : value;
      if (t.getAttribute('data-cfg-restart') === '1') {
        const applybar = $('slick-applybar');
        if (applybar) applybar.classList.remove('hidden');
      }
    });
    modal.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-cfg-file-pick]');
      if (!t) return;
      e.preventDefault();
      ctl({ op: 'file', plugin: t.getAttribute('data-cfg-plugin'), key: t.getAttribute('data-cfg-key') });
    });
  }

  const themeRadio = (t) =>
    '<input class="c-input_radio" type="radio" name="slick-theme" value="' +
    esc(t.file) +
    '"' +
    (t.active ? ' checked' : '') +
    '>';

  const themeRow = (t) => {
    const extra =
      t.file === CUSTOM_THEME_ID
        ? '<button class="c-button c-button--outline c-button--small slick-customcss-edit" type="button" data-open-customcss>Edit Custom CSS</button>'
        : '';
    return row(esc(t.label), t.description, themeRadio(t), '', extra);
  };

  const rows = (items, render, dir) =>
    items.length
      ? items.map(render).join('')
      : '<div class="slick-intro">Nothing found in <code>' + dir + '/</code>.</div>';

  function buildOverlay() {
    let ov = $('slick-panel-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'slick-panel-overlay';
    ov.style.display = 'none';
    ov.innerHTML =
      '<div id="slick-view-list">' +
      '<p class="slick-intro">Configure your Slick settings here.</p>' +
      '<div class="c-legend slick-legend">Theme</div>' +
      '<div id="slick-theme-list">' +
      rows(S.themes || [], themeRow, 'themes') +
      '</div>' +
      '<div class="c-legend slick-legend" style="margin-top:24px">Plugins</div>' +
      '<div id="slick-plugin-list">' +
      rows(S.plugins, pluginRow, 'plugins') +
      '</div>' +
      '<div id="slick-applybar" class="hidden">' +
      '<span class="slick-msg">These changes take effect after restarting Slick.</span>' +
      '<button id="slick-restart" class="c-button c-button--primary c-button--medium" type="button">Apply &amp; Restart</button>' +
      '</div>' +
      '</div>' +
      '<div id="slick-view-editor" style="display:none">' +
      '<button class="c-button-unstyled slick-editor-back" type="button" data-editor-back>&larr; Back</button>' +
      '<div class="c-legend slick-legend" style="margin-top:14px">Custom CSS</div>' +
      '<p class="slick-intro">Edits apply live, no restart needed. Select &ldquo;Custom CSS&rdquo; in the theme list to activate it.</p>' +
      '<textarea id="slick-customcss" class="slick-customcss-editor" spellcheck="false" placeholder="/* your css here */"></textarea>' +
      '</div>';
    document.body.appendChild(ov);

    function showView(name) {
      const list = ov.querySelector('#slick-view-list');
      const editor = ov.querySelector('#slick-view-editor');
      if (list) list.style.display = name === 'editor' ? 'none' : 'block';
      if (editor) editor.style.display = name === 'editor' ? 'block' : 'none';
      if (name === 'editor') {
        const ta = ov.querySelector('#slick-customcss');
        if (ta) ta.focus();
      }
    }
    ov.__slickShowView = showView;

    const editBtn = ov.querySelector('[data-open-customcss]');
    if (editBtn)
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showView('editor');
      });
    const backBtn = ov.querySelector('[data-editor-back]');
    if (backBtn) backBtn.addEventListener('click', () => showView('list'));

    const cssArea = ov.querySelector('#slick-customcss');
    if (cssArea) {
      cssArea.value = S.customCss || '';
      let cssDebounce;
      cssArea.addEventListener('input', () => {
        clearTimeout(cssDebounce);
        const value = cssArea.value;
        cssDebounce = setTimeout(() => {
          ctl({ op: 'customcss', value });
          S.customCss = value;
        }, 400);
      });
    }

    ov.querySelectorAll('input[name="slick-theme"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        ctl({ op: 'theme', name: e.target.value });
        setTimeout(positionOverlay, 300);
      });
    });
    function openCog(btn, e) {
      e.preventDefault();
      e.stopPropagation();
      const p = (S.plugins || []).find((x) => x.dir === btn.getAttribute('data-cog'));
      if (p) openConfig(p);
    }
    ov.querySelectorAll('[data-cog]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        openCog(btn, e);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        openCog(btn, e);
      });
    });
    ov.querySelectorAll('[data-plugin-row]').forEach((pluginRowEl) => {
      pluginRowEl.addEventListener('click', (e) => {
        const target = e.target && e.target.nodeType === 1 ? e.target : e.target.parentElement;
        if (target && target.closest('label,input,[data-cog]')) return;
        const input = pluginRowEl.querySelector('input[data-plugin]');
        if (!input) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    ov.querySelectorAll('input[data-plugin]').forEach((input) => {
      input.addEventListener('change', (e) => {
        ctl({ op: 'toggle', plugin: e.target.getAttribute('data-plugin'), enabled: e.target.checked ? 1 : 0 });
        ov.querySelector('#slick-applybar').classList.remove('hidden');
      });
    });
    ov.querySelector('#slick-restart').addEventListener('click', () => ctl({ op: 'restart' }));
    return ov;
  }

  function positionOverlay() {
    const panel = q(SEL.panel);
    const ov = $('slick-panel-overlay');
    if (!panel || !ov) return;
    const r = panel.getBoundingClientRect();
    Object.assign(ov.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
    const modal = q(SEL.modal);
    if (modal) ov.style.background = getComputedStyle(modal).backgroundColor;
  }

  const setTabActive = (tab, on) => {
    if (!tab) return;
    tab.classList.toggle('c-tabs__tab--active', on);
    tab.setAttribute('aria-selected', String(on));
  };

  function setSlickActive(on) {
    setTabActive($(TAB_ID), on);
    if (on)
      document.querySelectorAll(SEL.menu + ' .c-tabs__tab--active').forEach((t) => {
        if (t.id !== TAB_ID) setTabActive(t, false);
      });
    const ov = buildOverlay();
    if (on) positionOverlay();
    ov.style.display = on ? 'block' : 'none';
  }

  function injectTab() {
    const menu = q(SEL.menu);
    if (!menu || $(TAB_ID)) return;
    const btn = document.createElement('button');
    btn.className = 'c-button-unstyled c-tabs__tab js-tab c-tabs__tab--full_width';
    btn.id = TAB_ID;
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-qa', 'tabs_item');
    btn.setAttribute('aria-selected', 'false');
    btn.tabIndex = -1;
    btn.innerHTML =
      '<div class="c-tabs__tab_icon--left" data-qa="tabs_item_render_icon">' +
      ICON +
      '</div><span class="c-tabs__tab_content"><span>Slick</span></span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSlickActive(true);
    });
    menu.appendChild(btn);

    if (!menu.dataset.slickBound) {
      menu.dataset.slickBound = '1';
      menu.addEventListener(
        'click',
        (e) => {
          const t = e.target.closest && e.target.closest('.c-tabs__tab');
          if (t && t.id !== TAB_ID) setSlickActive(false);
        },
        true,
      );
    }
  }

  new MutationObserver(() => {
    if (q(SEL.overlay)) {
      injectTab();
    } else {
      closeConfig();
      const ov = $('slick-panel-overlay');
      if (ov) {
        ov.style.display = 'none';
        if (ov.__slickShowView) ov.__slickShowView('list');
      }
      const tab = $(TAB_ID);
      if (tab) tab.classList.remove('c-tabs__tab--active');
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', () => {
    const ov = $('slick-panel-overlay');
    if (ov && ov.style.display === 'block') positionOverlay();
  });
  window.addEventListener('slick:settings', refreshConfigFields);

  injectTab();
  return 'slick-settings-renderer ready';
})();
