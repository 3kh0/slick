import { SlickPlugin } from '$slick';
import { formatDuration } from './duration.ts';
import * as meta from './meta.ts';

type ClientStore = {
  getState: () => { clientHuddles?: { lastStartTs?: number; mostRecentHuddle?: { huddleState?: string } } };
  subscribe: (listener: () => void) => () => void;
};
type ClientStoreContext = React.Context<{ store?: ClientStore } | null>;

const isClientStoreContext = (exp: any) =>
  exp?.$$typeof === Symbol.for('react.context') && exp.displayName === 'ClientStoreContext';
const noStore = () => () => {};

export default class CallTimer extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['format'];

  private readonly NoClientStore: ClientStoreContext = React.createContext<{ store?: ClientStore } | null>(null);
  private readonly clientStore = new this.api.Store<ClientStoreContext | undefined>(undefined);
  private readonly active = new this.api.Store(false);
  private readonly human = new this.api.Store(false);
  private readonly BottomBar = React.createContext(false);

  private useJoinedAt() {
    const active = this.active.use();
    const context = this.clientStore.use() ?? this.NoClientStore;
    const store = React.useContext(context)?.store;
    const joinedAt = React.useSyncExternalStore(store?.subscribe ?? noStore, () => {
      const huddles = store?.getState().clientHuddles;
      return huddles?.mostRecentHuddle?.huddleState === 'STARTED' ? (huddles.lastStartTs ?? 0) : 0;
    });
    return active ? joinedAt : 0;
  }

  start() {
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    this.onSettingsChange();
    void this.api.waitForExport<ClientStoreContext>(isClientStoreContext).then(this.clientStore.set);

    this.api.setStyle(`
      .slick-call-timer {
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .p-multi_view_window_title__huddle + .slick-call-timer {
        margin-left: 8px;
      }
      [data-qa='huddle_details_title'] .slick-call-timer {
        flex: 0 0 auto;
        margin-left: 6px;
      }
    `);

    const Timer = ({ since }: { since: number }) => {
      const human = this.human.use();
      const [now, setNow] = React.useState(Date.now);
      React.useEffect(() => {
        let timeout: ReturnType<typeof setTimeout>;
        const tick = () => {
          setNow(Date.now());
          timeout = setTimeout(tick, 1000 - ((Date.now() - since) % 1000));
        };
        tick();
        return () => clearTimeout(timeout);
      }, [since]);
      return (
        <span className="slick-call-timer" role="timer">
          {formatDuration(now - since, human)}
        </span>
      );
    };

    this.api.patchComponent('HuddleMvaWindowTitle', (Original) => (props) => {
      const since = this.useJoinedAt();
      return (
        <>
          <Original {...props} />
          {since > 0 && <Timer since={since} />}
        </>
      );
    });

    this.api.patchComponent('HuddleBottomBarContent', (Original) => (props) => (
      <this.BottomBar.Provider value={true}>
        <Original {...props} />
      </this.BottomBar.Provider>
    ));

    this.api.patchComponent('HuddleRecordingIndicator', (Original) => (props) => {
      const since = this.useJoinedAt();
      const inBottomBar = React.useContext(this.BottomBar);
      return (
        <>
          <Original {...props} />
          {inBottomBar && since > 0 && <Timer since={since} />}
        </>
      );
    });
  }

  onSettingsChange() {
    this.human.set(this.config.format === 'human');
  }
}
