// Slack's modal system, reduced to `openModal` plus confirm/alert helpers.
//
// The modal is opened by dispatching Slack's own `openModal` thunk with a
// rendered element, so it stacks, traps focus and themes exactly like every
// other Slack dialog.

import { reactReady } from '../slack/react.tsx';
import { getStore } from '../slack/redux.ts';
import { waitForExport } from '../slack/webpack.ts';
import { elementsReady } from './elements.ts';

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

/** Build the convenience dialogs over a given `openModal`. */
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
  const elements = await elementsReady;

  let openModalThunk: OpenModalThunk | undefined;
  void waitForExport<OpenModalThunk>((exp: any) => typeof exp === 'function' && exp.meta?.name === 'openModal').then(
    (found) => {
      openModalThunk = found;
    },
  );

  const Confirmation = elements.ConfirmationModal;

  function openModal(options: OpenModalOptions): ModalHandle | null {
    const store = getStore();
    const openModalAction = openModalThunk;
    if (!store || !openModalAction) {
      console.error('[slick] modal: Slack modal system unavailable');
      return null;
    }

    // The close function only exists after dispatch, but the element's
    // handlers need it, so it is reached through a box rather than captured.
    const closeRef = { current: () => {} };
    const element = (
      <Confirmation
        title={options.title}
        submitButtonText={options.submitText ?? 'Save'}
        cancelButtonText={options.cancelText ?? 'Cancel'}
        submitButtonType={options.danger ? 'danger' : 'primary'}
        showCancelButton={options.showCancelButton ?? true}
        showSubmitButton={options.showSubmitButton ?? true}
        onSubmit={() => {
          options.onSubmit?.();
          closeRef.current();
        }}
        onCancel={() => {
          options.onCancel?.();
          closeRef.current();
        }}
        onClose={() => {
          options.onClose?.();
          closeRef.current();
        }}
      >
        {options.body}
      </Confirmation>
    );

    const name = typeof options.title === 'string' ? options.title : 'modal';
    const handle = store.dispatch(openModalAction({ element, name })) as RawModalHandle | undefined;
    closeRef.current = () => handle?.close();

    return { close: () => handle?.close() };
  }

  return { openModal, ...dialogHelpersFor(openModal) };
})();

export type ModalAPI = Awaited<typeof modalReady>;
