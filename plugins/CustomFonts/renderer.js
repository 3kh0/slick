(() => {
  'use strict';
  if (window.__slickCustomFonts) return;

  const DIR = 'CustomFonts';
  const CONTROL = 'https://slick.control/';
  let families = [];
  let active = -1;
  let loading;

  const cfg = () => window.__slickPluginSettings?.[DIR] || {};
  const quote = (value) => '"' + String(value).replace(/(["\\])/g, '\\$1') + '"';
  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fileName = (value) =>
    String(value || '')
      .split(/[\\/]/)
      .pop();

  function control(params) {
    fetch(CONTROL + '?' + new URLSearchParams(params), { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  }

  function setSetting(key, value) {
    control({ op: 'cfg', plugin: DIR, key, value });
    cfg()[key] = value;
  }

  function apply() {
    const settings = cfg();
    const path = String(settings.fontPath || '').trim();
    // When the early runtime owns system fonts, only an uploaded file remains here.
    if (window.__slickDesktopEarly?.active?.CustomFonts && !path) {
      const existing = document.getElementById('slick-custom-font-style');
      if (existing) existing.textContent = '';
      return;
    }
    const family = path ? 'SlickCustomFont' : String(settings.fontFamily || '').trim();
    let style = document.getElementById('slick-custom-font-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'slick-custom-font-style';
      document.head.appendChild(style);
    }
    if (!family) {
      style.textContent = '';
      return;
    }
    const face = path
      ? '@font-face{font-family:"SlickCustomFont";src:url("slick-custom-font://local/font?path=' +
        encodeURIComponent(path) +
        '");font-display:swap;}'
      : '';
    const stack = quote(family) + ',var(--font-family-fallback)';
    style.textContent =
      face +
      'body{--font-family-default:' +
      stack +
      ';--font-family-lato:' +
      stack +
      ';font-family:' +
      stack +
      '!important;}';
  }

  async function loadFamilies(status) {
    if (families.length) return families;
    if (loading) return loading;
    if (typeof window.queryLocalFonts !== 'function') {
      status.textContent = 'System font search is unavailable';
      return [];
    }
    status.textContent = 'Loading system fonts…';
    loading = window
      .queryLocalFonts()
      .then((fonts) => {
        families = Array.from(new Set(fonts.map((font) => font.family).filter(Boolean))).toSorted((a, b) =>
          a.localeCompare(b),
        );
        status.textContent = families.length ? families.length + ' system fonts available' : 'No system fonts found';
        return families;
      })
      .catch((error) => {
        status.textContent =
          error?.name === 'NotAllowedError' ? 'Font access was not allowed' : 'Could not load system fonts';
        return [];
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function renderResults(root, query) {
    const list = root.querySelector('.slick-font-results');
    const matches = families.filter((family) => family.toLowerCase().includes(query.toLowerCase()));
    active = matches.length ? 0 : -1;
    list.innerHTML = matches
      .map(
        (family, index) =>
          '<button type="button" role="option" class="slick-font-option' +
          (index === active ? ' active' : '') +
          '" data-font="' +
          esc(family) +
          '" style="font-family:' +
          esc(quote(family)) +
          '">' +
          esc(family) +
          '</button>',
      )
      .join('');
    list.hidden = false;
  }

  function moveActive(root, direction) {
    const options = Array.from(root.querySelectorAll('.slick-font-option'));
    if (!options.length) return;
    active = Math.max(0, Math.min(options.length - 1, active + direction));
    options.forEach((option, index) => option.classList.toggle('active', index === active));
    options[active].scrollIntoView({ block: 'nearest' });
  }

  function mount() {
    const host = document.getElementById('font_typeface_selection');
    if (!host || host.querySelector('.slick-font-picker')) return;
    host.querySelector('.c-basic-select')?.style.setProperty('display', 'none', 'important');

    const root = document.createElement('div');
    root.className = 'slick-font-picker';
    root.innerHTML =
      '<div class="slick-font-search-wrap">' +
      '<input class="c-input_text slick-font-search" type="search" role="combobox" aria-label="Search system fonts" aria-autocomplete="list" aria-expanded="false" placeholder="Search all system fonts…">' +
      '<div class="slick-font-results" role="listbox" hidden></div>' +
      '</div>' +
      '<div class="slick-font-actions">' +
      '<button class="c-button c-button--outline c-button--small" type="button" data-font-upload>Upload font</button>' +
      '<button class="c-button c-button--outline c-button--small" type="button" data-font-reset>Use Slack default</button>' +
      '</div>' +
      '<div class="slick-font-status" aria-live="polite"></div>';
    host.appendChild(root);

    const input = root.querySelector('.slick-font-search');
    const list = root.querySelector('.slick-font-results');
    const status = root.querySelector('.slick-font-status');
    const sync = () => {
      if (document.activeElement !== input)
        input.value = cfg().fontPath ? fileName(cfg().fontPath) : cfg().fontFamily || '';
      status.textContent = cfg().fontPath
        ? 'Using uploaded font: ' + fileName(cfg().fontPath)
        : cfg().fontFamily
          ? 'Using system font: ' + cfg().fontFamily
          : 'Using Slack default';
    };

    async function search() {
      await loadFamilies(status);
      renderResults(root, input.value);
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('focus', search);
    input.addEventListener('input', search);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(root, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        const option = root.querySelectorAll('.slick-font-option')[active];
        if (option) option.click();
      } else if (event.key === 'Escape') {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const option = event.target.closest('.slick-font-option');
      if (!option) return;
      setSetting('fontPath', '');
      setSetting('fontFamily', option.dataset.font);
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.value = option.dataset.font;
      apply();
      sync();
    });
    root
      .querySelector('[data-font-upload]')
      .addEventListener('click', () => control({ op: 'file', plugin: DIR, key: 'fontPath' }));
    root.querySelector('[data-font-reset]').addEventListener('click', () => {
      setSetting('fontPath', '');
      setSetting('fontFamily', '');
      apply();
      sync();
    });
    window.addEventListener('slick:plugin-settings', sync);
    sync();
  }

  const css = document.createElement('style');
  css.textContent =
    '.slick-font-picker{margin-top:8px;width:360px;max-width:100%}' +
    '.slick-font-search-wrap{position:relative}' +
    '.slick-font-search{width:100%}' +
    '.slick-font-results{position:absolute;z-index:1400;top:100%;left:0;right:0;max-height:260px;overflow:auto;margin-top:4px;padding:4px;background:var(--sk_primary_background,#fff);border:1px solid rgba(127,127,127,.35);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25)}' +
    '.slick-font-option{display:block;width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;font-size:15px;cursor:pointer}' +
    '.slick-font-option:hover,.slick-font-option.active{background:rgba(29,155,209,.18)}' +
    '.slick-font-actions{display:flex;gap:8px;margin-top:8px}' +
    '.slick-font-status{margin-top:6px;min-height:18px;font-size:12px;opacity:.65}';
  document.head.appendChild(css);

  window.addEventListener('slick:plugin-settings', apply);
  window.__slickDOM.onRoots(mount);
  apply();
  mount();
  window.__slickCustomFonts = { apply, loadFamilies, mount };
})();
