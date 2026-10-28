import { SlickPlugin } from '$slick';
import { levelOf } from './level.ts';
import * as meta from './meta.ts';

type Count = { length: number; selected: number; max: number };
type Quill = {
  getLength(): number;
  getSelection(focus?: boolean): { length: number } | null;
  on(event: 'editor-change', handler: () => void): void;
  off(event: 'editor-change', handler: () => void): void;
};
type Texty = { instance?: { quill?: Quill; getDelta?(): unknown } };
type TextyProps = { maxLength?: number; ref?: React.Ref<Texty> };
type LengthOf = (delta: unknown) => number;
type CountStore = { get(): Count; set(next: Count): void; use(): Count };

const EMPTY: Count = { length: 0, selected: 0, max: 0 };

const named = (name: string) => (exp: any) => typeof exp === 'function' && exp.name === name;
const isTextyInput = (component: any) =>
  component?.$$typeof === Symbol.for('react.memo') &&
  typeof component.type?.prototype?.getNumCharsOverLimit === 'function';

function forwardRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') return ref(node);
  if (ref) (ref as React.RefObject<T | null>).current = node;
}

export default class CharacterCounter extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['colorEffects'];

  private readonly Composer = React.createContext<CountStore | null>(null);
  private readonly lengthOf = new this.api.Store<LengthOf | undefined>(undefined);
  // pop-out composers aren't re-rendered when the patch goes, so the counter hides itself
  private readonly active = new this.api.Store(false);
  private readonly colors = new this.api.Store(true);

  start() {
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    this.onSettingsChange();
    void this.api.waitForExport<LengthOf>(named('getMessageLengthForDelta')).then(this.lengthOf.set);
    const { Tooltip } = this.api.elements;

    this.api.setStyle(`
      .slick-char-counter {
        align-self: center;
        margin-right: 4px;
        font-size: 12px;
        line-height: 16px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        color: var(--dt_color-content-ter);
      }
      .slick-char-counter--warn { color: var(--dt_color-content-hgl-3); }
      .slick-char-counter--high { color: color-mix(in srgb, var(--dt_color-content-hgl-3), var(--dt_color-content-imp)); }
      .slick-char-counter--danger { color: var(--dt_color-content-imp); }
      .slick-char-counter__selected { color: var(--dt_color-content-hgl-1); }
    `);

    this.api.patchComponent('WysiwygContainer', (Original) => (props) => {
      const count = React.useMemo(() => new this.api.Store(EMPTY), []);
      return (
        <this.Composer.Provider value={count}>
          <Original {...props} />
        </this.Composer.Provider>
      );
    });

    this.api.patchComponent<TextyProps>({ filter: isTextyInput }, (Original) => (props) => {
      const count = React.useContext(this.Composer);
      const lengthOf = this.lengthOf.use();
      const [texty, setTexty] = React.useState<Texty | null>(null);
      const forward = props.ref;
      const ref = React.useCallback(
        (node: Texty | null) => {
          setTexty(node);
          const cleanup = forwardRef(forward, node);
          return () => {
            setTexty(null);
            if (typeof cleanup === 'function') cleanup();
            else forwardRef(forward, null);
          };
        },
        [forward],
      );
      const max = props.maxLength ?? 0;

      React.useEffect(() => {
        const quill = texty?.instance?.quill;
        if (!count || !quill) return;
        const update = () => {
          const delta = texty.instance?.getDelta?.();
          const length = lengthOf && delta ? lengthOf(delta) : quill.getLength() - 1;
          const selected = quill.getSelection(false)?.length ?? 0;
          const last = count.get();
          if (last.length !== length || last.selected !== selected || last.max !== max)
            count.set({ length, selected, max });
        };
        update();
        quill.on('editor-change', update);
        return () => {
          quill.off('editor-change', update);
          count.set(EMPTY);
        };
      }, [texty, count, lengthOf, max]);

      return <Original {...props} ref={ref} />;
    });

    const Counter = ({ count }: { count: CountStore }) => {
      const { length, selected, max } = count.use();
      const active = this.active.use();
      const colors = this.colors.use();
      if (!active || length <= 0) return null;
      const level = colors ? levelOf(length, max) : 'normal';
      const format = (n: number) => n.toLocaleString();
      const tip = `${format(length)} of ${format(max)} characters`;
      return (
        <Tooltip tip={max ? tip : `${format(length)} characters`} position="top">
          <span className={`slick-char-counter slick-char-counter--${level}`}>
            {selected > 0 && (
              <>
                <span className="slick-char-counter__selected">{format(selected)}</span>/
              </>
            )}
            {format(length)}
            {max > 0 && `/${format(max)}`}
          </span>
        </Tooltip>
      );
    };

    this.api.patchComponent('SendButton', (Original) => (props) => {
      const count = React.useContext(this.Composer);
      return (
        <>
          {count && <Counter count={count} />}
          <Original {...props} />
        </>
      );
    });
  }

  onSettingsChange() {
    this.colors.set(this.config.colorEffects !== false);
  }
}
