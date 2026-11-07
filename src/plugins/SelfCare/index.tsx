import { SlickPlugin } from '$slick';
import { BREAK_KEY, breakEnd, countdown, notificationGuard, NOTIFICATION_THUNKS, storedEnd } from './break.ts';
import * as meta from './meta.ts';
import { css } from './style.ts';

type LockScreen = { dialog: HTMLDialogElement; message: HTMLElement; timer: HTMLElement; end: HTMLElement };

export default class SelfCare extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['redux', 'elements', 'modal', 'addSendCheck'] as const;
  static readonly liveSettings = Object.keys(meta.settings);

  private until = 0;
  private timer?: ReturnType<typeof setInterval>;
  private syncing = false;
  private starting = false;
  private generation = 0;
  private screens = new Map<Document, LockScreen>();
  private modal: { close(): void } | null = null;

  async start() {
    this.api.setStyle(css);
    await this.sync();
    if (!this.api.isActive()) return;
    this.addDocument(document);
    this.api.onDocument((doc) => this.addDocument(doc));
    for (const name of NOTIFICATION_THUNKS) {
      this.api.redux.patchThunk(name, (original) => notificationGuard(original, () => this.until > Date.now()));
    }
    this.api.addSendCheck(() => this.until <= Date.now());
    this.api.settings.addTab({ label: 'Self Care', icon: 'heart', render: () => this.panel() });
    this.api.patchComponent<Record<string, unknown>>('HelpButton', (Original) => (props) => (
      <>
        <div className="p-top_nav__windows_controls_container">
          <button
            type="button"
            className="c-button-unstyled p-top_nav__button p-top_nav__help"
            aria-label="Take a self-care break"
            title="Take a self-care break"
            onClick={() => this.open()}
          >
            <this.api.elements.SvgIcon name="heart" size={20} />
          </button>
        </div>
        <Original {...props} />
      </>
    ));
    if (this.api.loader === 'electron') {
      this.api.main.on('started', (value) => {
        this.generation++;
        this.until = storedEnd(value);
        this.render();
      });
    }
    this.timer = setInterval(() => {
      this.render();
      void this.sync().catch((error) => this.log('could not check the break', error));
    }, 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.modal?.close();
    for (const { dialog } of this.screens.values()) {
      if (dialog.open) dialog.close();
      dialog.remove();
    }
    this.screens.clear();
  }

  onSettingsChange() {
    this.render();
  }

  private async sync() {
    if (this.syncing || this.starting) return;
    this.syncing = true;
    const generation = this.generation;
    try {
      const value =
        this.api.loader === 'electron'
          ? await this.api.main.call<number>('status')
          : await this.api.storage.get<unknown>(BREAK_KEY, 0);
      if (!this.api.isActive() || generation !== this.generation) return;
      this.until = storedEnd(value);
      this.render();
    } finally {
      this.syncing = false;
    }
  }

  private async begin(minutes: number) {
    if (this.starting) return;
    const next = breakEnd(minutes);
    this.starting = true;
    this.generation++;
    try {
      await this.api.settings.set('minutes', minutes);
      if (!this.api.isActive()) return;
      if (this.api.loader === 'electron') {
        this.until = storedEnd(await this.api.main.call<number>('begin', minutes));
      } else {
        const existing = storedEnd(await this.api.storage.get<unknown>(BREAK_KEY, 0));
        const until = existing > Date.now() ? existing : next;
        if (!(await this.api.storage.set(BREAK_KEY, until))) {
          throw new Error('Could not save your break. Please try again.');
        }
        this.until = until;
      }
      if (!this.api.isActive()) return;
      this.modal?.close();
      this.modal = null;
      this.render();
    } finally {
      this.starting = false;
    }
  }

  private addDocument(doc: Document) {
    if (this.screens.has(doc)) return;
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', () => this.addDocument(doc), { once: true, signal: this.api.signal });
      return;
    }
    const dialog = doc.createElement('dialog');
    dialog.className = 'slick-self-care';
    dialog.setAttribute('aria-label', 'Self-care break');
    const content = doc.createElement('div');
    content.className = 'slick-self-care__content';
    const symbol = doc.createElement('div');
    symbol.className = 'slick-self-care__symbol';
    symbol.textContent = '🌱';
    symbol.setAttribute('aria-hidden', 'true');
    const title = doc.createElement('h1');
    title.textContent = 'Take care of yourself';
    const message = doc.createElement('p');
    const timer = doc.createElement('div');
    timer.className = 'slick-self-care__countdown';
    timer.setAttribute('role', 'timer');
    timer.setAttribute('aria-label', 'Time remaining');
    const end = doc.createElement('p');
    end.className = 'slick-self-care__end';
    content.append(symbol, title, message, timer, end);
    dialog.append(content);
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    doc.body.append(dialog);
    this.screens.set(doc, { dialog, message, timer, end });
    this.render();
  }

  private render() {
    const active = this.until > Date.now();
    for (const [doc, screen] of this.screens) {
      if (doc.defaultView?.closed) {
        this.screens.delete(doc);
        continue;
      }
      const { dialog, message, timer, end } = screen;
      if (!active) {
        if (dialog.open) dialog.close();
        continue;
      }
      message.textContent = String(this.config.message || meta.settings.message.default);
      timer.textContent = countdown(this.until);
      const backAt = new Date(this.until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      end.textContent = `Your notifications are paused. Slack will be back at ${backAt}.`;
      if (!dialog.open && dialog.isConnected) dialog.showModal();
    }
  }

  private open() {
    this.modal?.close();
    this.modal = this.api.modal.openModal({
      title: 'Self Care',
      body: this.panel(),
      showSubmitButton: false,
      cancelText: 'Cancel',
    });
  }

  private panel() {
    return <BreakPanel minutes={Number(this.config.minutes)} begin={(minutes) => this.begin(minutes)} />;
  }
}

function BreakPanel({ minutes, begin }: { minutes: number; begin: (minutes: number) => Promise<void> }) {
  const [duration, setDuration] = React.useState(String(minutes));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  return (
    <form
      className="slick-self-care-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        void begin(Number(duration))
          .catch((reason) => {
            setError(reason instanceof Error ? reason.message : 'Could not start your break. Please try again.');
          })
          .finally(() => setBusy(false));
      }}
    >
      <p>
        Give yourself some time away. Slick will silence notifications and leave you alone. There is no end early
        button.
      </p>
      <label htmlFor="slick-self-care-minutes">Break duration (minutes)</label>
      <input
        id="slick-self-care-minutes"
        className="c-input_text"
        type="number"
        min={1}
        max={10080}
        step="any"
        required
        value={duration}
        onChange={(event) => setDuration(event.currentTarget.value)}
      />
      {error && <p role="alert">{error}</p>}
      <div>
        <button type="submit" className="c-button c-button--primary c-button--medium" disabled={busy}>
          {busy ? 'Starting break...' : 'Start self-care break'}
        </button>
      </div>
    </form>
  );
}
