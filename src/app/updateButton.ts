import { setStyle } from './api/css.ts';
import type { SlickBridge } from './bridge.ts';
import type { UpdateStatus } from './updateStatus.ts';

export function installUpdateButton(bridge: SlickBridge): void {
  if (!bridge.getUpdateStatus || !bridge.onUpdateStatus || !bridge.activateUpdate) return;
  setStyle(
    `
    .slick-update-button {
      position:relative; overflow:hidden; flex-shrink:0; margin:0 8px;
      height:26px; display:inline-flex; align-items:center; justify-content:center; align-self:center; padding:0 9px; border:1px solid currentColor; border-radius:6px;
      background:transparent; color:#81d99b; font:inherit; font-size:12px;
      cursor:pointer; -webkit-app-region:no-drag; white-space:nowrap;
    }
    .slick-update-button:hover { background:rgba(129,217,155,.12); }
    .slick-update-button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
    .slick-update-button:disabled { cursor:default; }
    .slick-update-button::before {
      content:''; position:absolute; inset:0; background:currentColor; opacity:.18;
      transform:scaleX(var(--slick-update-progress,0)); transform-origin:left;
      transition:transform .2s;
    }
    .slick-update-button[data-indeterminate=true]::before {
      transform:none; width:35%; animation:slick-update-slide 1.2s ease-in-out infinite;
    }
    .slick-update-button span { position:relative; }
    @keyframes slick-update-slide { from { left:-35%; } to { left:100%; } }
    @media (prefers-reduced-motion:reduce) {
      .slick-update-button::before { transition:none; animation:none !important; }
    }
  `,
    'update-button',
  );

  let status: UpdateStatus = { state: 'idle' };
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'slick-update-button';
  const label = document.createElement('span');
  button.append(label);
  button.addEventListener('click', () => {
    void bridge.activateUpdate!().catch((error) => {
      render({ state: 'error', latestBuild: status.latestBuild, detail: String(error) });
    });
  });

  function mount(): void {
    if (status.state === 'idle') {
      button.remove();
      return;
    }
    if (button.isConnected) return;
    // Slack wraps HelpButton in a block element. Join the nearest flex row
    // instead so the update and help controls stay side by side.
    const help = document.querySelector('.p-top_nav__help');
    const right = help?.closest('.p-ia4_top_nav__right_container');
    if (!help || !right) return;
    let anchor: Element = help;
    while (anchor.parentElement && right.contains(anchor.parentElement)) {
      const parent = anchor.parentElement;
      const display = getComputedStyle(parent).display;
      if (display === 'flex' || display === 'inline-flex') {
        anchor.before(button);
        return;
      }
      anchor = parent;
    }
  }

  function render(next: UpdateStatus): void {
    status = next;
    const downloading = status.state === 'downloading';
    button.disabled = downloading;
    label.textContent =
      status.state === 'ready'
        ? 'Click to apply update'
        : status.state === 'error'
          ? 'Retry update'
          : downloading
            ? `${status.title ?? 'Downloading update'}${status.percent === undefined ? '…' : ` · ${status.percent}%`}`
            : '↓ Download update';
    button.title = [
      status.latestBuild ? `Slick Build ${status.latestBuild}` : '',
      status.detail ?? '',
      status.state === 'ready' ? 'Restart Slick to apply the update, or it will install when you quit.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    button.setAttribute('aria-label', `${label.textContent}${status.detail ? `. ${status.detail}` : ''}`);
    button.setAttribute('aria-busy', String(downloading));
    button.dataset.indeterminate = String(downloading && status.percent === undefined);
    button.style.setProperty('--slick-update-progress', String(Math.max(0, Math.min(100, status.percent ?? 0)) / 100));
    mount();
  }

  // Slack can replace the title bar during navigation. Reattach the same button.
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  let received = false;
  const unsubscribe = bridge.onUpdateStatus((next) => {
    received = true;
    render(next);
  });
  void bridge
    .getUpdateStatus()
    .then((next) => {
      if (!received) render(next);
    })
    .catch(console.error);
  window.addEventListener(
    'pagehide',
    () => {
      observer.disconnect();
      unsubscribe();
    },
    { once: true },
  );
}
