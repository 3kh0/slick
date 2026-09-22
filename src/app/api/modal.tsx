// Dispatches Slack's `openModal` thunk with owned markup: Slack provides the
// modal stack and focus trap, without depending on private component props.

import { reactReady } from '../slack/react.tsx';
import { getStore } from '../slack/redux.ts';
import { waitForExport } from '../slack/webpack.ts';

type RawModalHandle = { close: () => void; render: (props: unknown) => void };
type OpenModalThunk = (opts: { element: React.ReactElement; name?: string }) => unknown;

export type OpenModalOptions = {
  title: React.ReactNode;
  body: React.ReactNode;
  submitText?: string;
  cancelText?: string;
  danger?: boolean;
  showCancelButton?: boolean;
  showSubmitButton?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
};

export type ModalHandle = { close: () => void };

export type ConfirmOptions = {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export type AlertOptions = {
  title: React.ReactNode;
  body?: React.ReactNode;
  closeText?: string;
};

export function dialogHelpersFor(openModal: (options: OpenModalOptions) => ModalHandle | null) {
  /** Resolves true if confirmed, false on cancel or dismissal. */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const handle = openModal({
        title: options.title,
        body: options.body ?? null,
        submitText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        danger: options.danger,
        onSubmit: () => settle(true),
        onCancel: () => settle(false),
        onClose: () => settle(false),
      });
      // A modal that could not open must still settle, or the caller hangs.
      if (!handle) settle(false);
    });
  }

  /** A title, a body and one close button. Resolves once dismissed. */
  function alert(options: AlertOptions): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const handle = openModal({
        title: options.title,
        body: options.body ?? null,
        submitText: options.closeText ?? 'OK',
        showCancelButton: false,
        onSubmit: settle,
        onClose: settle,
      });
      if (!handle) settle();
    });
  }

  return { confirm, alert };
}

export const modalReady = (async () => {
  await reactReady;

  let openModalThunk: OpenModalThunk | undefined;
  void waitForExport<OpenModalThunk>((exp: any) => typeof exp === 'function' && exp.meta?.name === 'openModal').then(
    (found) => {
      openModalThunk = found;
    },
  );

  function openModal(options: OpenModalOptions): ModalHandle | null {
    const store = getStore();
    const openModalAction = openModalThunk;
    if (!store || !openModalAction) {
      console.error('[slick] modal: Slack modal system unavailable');
      return null;
    }

    // The close function only exists after dispatch, so handlers reach it through a box.
    const closeRef = { current: () => {} };
    const finish = (kind: string, callback: (() => void) | undefined) => {
      try {
        callback?.();
      } catch (error) {
        console.error(`[slick] modal ${kind} callback failed:`, error);
      } finally {
        closeRef.current();
      }
    };
    const element = (
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof options.title === 'string' ? options.title : 'Slick dialog'}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2 style={{ flex: 1, margin: 0 }}>{options.title}</h2>
          <button type="button" aria-label="Close" onClick={() => finish('close', options.onClose)}>
            ×
          </button>
        </header>
        <div style={{ marginBlock: 20 }}>{options.body}</div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {(options.showCancelButton ?? true) && (
            <button type="button" onClick={() => finish('cancel', options.onCancel)}>
              {options.cancelText ?? 'Cancel'}
            </button>
          )}
          {(options.showSubmitButton ?? true) && (
            <button
              type="button"
              onClick={() => finish('submit', options.onSubmit)}
              style={options.danger ? { color: 'var(--dt_color-content-destructive)' } : undefined}
            >
              {options.submitText ?? 'Save'}
            </button>
          )}
        </footer>
      </section>
    );

    const name = typeof options.title === 'string' ? options.title : 'modal';
    const handle = store.dispatch(openModalAction({ element, name })) as RawModalHandle | undefined;
    closeRef.current = () => handle?.close();

    return { close: () => handle?.close() };
  }

  return { openModal, ...dialogHelpersFor(openModal) };
})();

export type ModalAPI = Awaited<typeof modalReady>;
