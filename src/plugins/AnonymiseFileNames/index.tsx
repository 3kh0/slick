import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const NAME_LENGTH = 7;

type UploadFile = { id?: string; name?: string; title?: string };
type PendingFile = { file?: UploadFile; pendingFileId?: string; persistedFileId?: string; title?: string };
type UpdatePendingFile = (args: { pendingFileId: string; title: string }) => unknown;

export default class AnonymiseFileNames extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements', 'redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['keepExtension'];

  private restores: (() => void)[] = [];
  private readonly useOriginal = new WeakSet<File>();
  private updatePendingFile?: UpdatePendingFile;
  private readonly originals = new WeakMap<File, string>();
  private readonly uploadedNames = new Map<string, string | undefined>();
  private readonly names = new WeakMap<File, string>();

  start() {
    this.api.setStyle(`
      .slick-afn-attachment { position: relative; display: inline-flex; max-width: 100%; }
      .slick-afn-toggle {
        position: absolute; top: 4px; left: 4px; z-index: 2;
        display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
        border: 1px solid var(--dt_color-otl-ter, #666); border-radius: 4px;
        background: var(--dt_color-base-pry, #222); color: var(--dt_color-content-pry, #fff);
        cursor: pointer; box-shadow: 0 1px 2px #0003;
      }
      .slick-afn-toggle[aria-pressed="true"] { color: var(--dt_color-content-pry, #fff); }
      .slick-afn-toggle[aria-pressed="false"] { color: var(--dt_color-content-sec, #aaa); }
      .slick-afn-toggle:hover { background: var(--dt_color-base-sec, #333); }
      .slick-afn-toggle:focus-visible { outline: 2px solid var(--dt_color-theme-base-inv-pry, #1d9bd1); outline-offset: 2px; }
      .slick-afn-toggle:disabled { cursor: wait; opacity: .5; }
    `);
    this.api.patchComponent<{ pendingFile?: PendingFile }>('MultiFileUploadItem', (Original) => (props) => {
      const file = props.pendingFile?.file;
      if (!file || this.originalFor(file) === undefined) return <Original {...props} />;
      return (
        <div className="slick-afn-attachment">
          <Original {...props} />
          <this.NameToggle pendingFile={props.pendingFile} />
        </div>
      );
    });
    const OriginalName = React.createContext<string | undefined>(undefined);
    this.api.patchComponent<{ file?: { name?: string } }>('FileFieldset', (Original) => (props) => (
      <OriginalName.Provider value={props.file && this.originalFor(props.file)}>
        <Original {...props} />
      </OriginalName.Provider>
    ));
    this.api.patchComponent('EditFileDialogTitle', (Original) => (props) => {
      const original = React.useContext(OriginalName);
      const field = React.useRef<HTMLDivElement>(null);
      const { Button } = this.api.elements;
      const restore = () => {
        const input = field.current?.querySelector('input');
        if (!input || original === undefined) return;
        const view = input.ownerDocument.defaultView;
        if (!view) return;
        const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return;
        // Bypass React's value tracker so Formik receives the native input event.
        setter.call(input, original);
        input.dispatchEvent(new view.Event('input', { bubbles: true }));
        input.focus();
      };
      if (original === undefined) return <Original {...props} />;
      return (
        <div ref={field}>
          <Original {...props} />
          <Button type="outline" size="small" htmlType="button" onClick={restore}>
            Use original name
          </Button>
        </div>
      );
    });
    this.patch(File.prototype);
    this.api.onDocument((doc) => {
      const view = doc.defaultView as (Window & typeof globalThis) | null;
      if (view?.File) this.patch(view.File.prototype);
    });
  }

  private patch(proto: File) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'name');
    if (!descriptor?.get || !descriptor.configurable) {
      this.log('File.prototype.name is not patchable in this runtime');
      return;
    }

    const original = descriptor.get;
    const names = this.names;
    const useOriginal = this.useOriginal;
    const originals = this.originals;
    const uploadedNames = this.uploadedNames;
    const anonymise = (real: string) => this.anonymise(real);

    Object.defineProperty(proto, 'name', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get(this: File) {
        let real: string;
        try {
          real = original.call(this);
        } catch {
          return original.call(this);
        }

        originals.set(this, real);
        const cached = names.get(this);
        if (cached !== undefined) return useOriginal.has(this) ? real : cached;

        const anonymised = anonymise(real);
        names.set(this, anonymised);
        const known = uploadedNames.get(anonymised);
        uploadedNames.set(anonymised, uploadedNames.has(anonymised) && known !== real ? undefined : real);
        if (uploadedNames.size > 1000) uploadedNames.delete(uploadedNames.keys().next().value!);
        return anonymised;
      },
    });

    this.restores.push(() => Object.defineProperty(proto, 'name', descriptor));
    this.log(proto === File.prototype ? 'upload file names anonymised' : 'pop-out file names anonymised');
  }

  private readonly NameToggle = ({ pendingFile }: { pendingFile?: PendingFile }) => {
    const file = pendingFile?.file;
    const pendingId = pendingFile?.pendingFileId;
    const persistedId =
      pendingFile?.persistedFileId ?? (file && !this.originals.has(file as File) ? file.id : undefined);
    const title = this.api.redux.useReduxState(
      (state) =>
        (pendingId && state.pendingFileUploads?.[pendingId]?.title) ||
        (persistedId && state.files?.[persistedId]?.title) ||
        pendingFile?.title ||
        file?.title ||
        file?.name,
    );
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(false);
    const original = file && this.originalFor(file);
    const anonymous = file && (this.names.get(file as File) ?? file.name);
    if (!file || original === undefined || !anonymous) return null;
    const isAnonymous = title !== original;
    const label = error
      ? 'Could not change file name. Click to retry.'
      : isAnonymous
        ? 'Using anonymous file name. Click to use original name.'
        : 'Using original file name. Click to anonymise.';
    const toggle = async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      setBusy(true);
      setError(false);
      const nextTitle = isAnonymous ? original : anonymous;
      try {
        if (persistedId) {
          await this.api.redux.dispatchThunk('editFileApi', { fileId: persistedId, title: nextTitle });
          if (this.api.redux.getRawState()?.files?.[persistedId]?.title !== nextTitle) throw Error('Rename failed');
        }
        if (pendingId) {
          this.updatePendingFile ??= this.api.getExport<UpdatePendingFile>(
            (value: any) => typeof value === 'function' && value.meta?.name === 'updatePendingFile',
          );
          const store = this.api.redux.getStore();
          if (!store || !this.updatePendingFile) throw Error('Pending file action unavailable');
          store.dispatch(this.updatePendingFile({ pendingFileId: pendingId, title: nextTitle }));
          if (!persistedId)
            await this.api.redux.dispatchThunk('maybePersistPendingFileData', { pendingFileId: pendingId });
        }
        if (isAnonymous) this.useOriginal.add(file as File);
        else this.useOriginal.delete(file as File);
      } catch {
        setError(true);
      } finally {
        setBusy(false);
      }
    };
    const { Tooltip } = this.api.elements;
    return (
      <Tooltip tip={label} position="top">
        <button
          type="button"
          className="slick-afn-toggle"
          aria-label={label}
          aria-pressed={isAnonymous}
          disabled={busy || (!pendingId && !persistedId)}
          onClick={toggle}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 9h16M6 9l2-6 4 2 4-2 2 6M10 16h4" />
            <circle cx="6" cy="17" r="4" />
            <circle cx="18" cy="17" r="4" />
            {!isAnonymous && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </Tooltip>
    );
  };

  private originalFor(file: { name?: string }): string | undefined {
    return this.originals.get(file as File) ?? (file.name ? this.uploadedNames.get(file.name) : undefined);
  }

  private anonymise(real: string): string {
    const bytes = new Uint32Array(NAME_LENGTH);
    crypto.getRandomValues(bytes);

    let name = '';
    for (let i = 0; i < NAME_LENGTH; i++) name += ALPHABET[bytes[i] % ALPHABET.length];
    return this.config.keepExtension ? name + extensionOf(real) : name;
  }

  stop() {
    for (const restore of this.restores) {
      try {
        restore();
      } catch {}
    }
    this.restores = [];
  }
}

function extensionOf(name: string): string {
  if (typeof name !== 'string') return '';
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}
