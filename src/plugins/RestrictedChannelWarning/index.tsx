import { SlickPlugin } from '$slick';
import { restrictedAccess, restrictionKey, type RestrictedChannel } from './access.ts';
import * as meta from './meta.ts';

type RoadblockProps = { channelId?: string; roadblockMessage?: React.ReactNode; allowWrap?: boolean };

export default class RestrictedChannelWarning extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  // Session-only overrides: re-enabling the warning restores all roadblocks.
  private ignored = new Map<string, string>();

  start() {
    this.api.redux.patchState((state) => {
      const userId = this.api.members.getCurrentMemberId();
      const access = (id: string) => this.access(id, state, userId);
      // The decision depends on channels as well as the access slices. New
      // mappers per raw snapshot prevent memoized entries retaining old policies.
      return {
        ...state,
        readOnlyChannels: state.readOnlyChannels
          ? this.api.redux.mapEntries<{ isReadOnly?: boolean }>(state.readOnlyChannels, (id, entry) => {
              const next = access(id);
              return next ? { ...entry, isReadOnly: next.readOnly } : entry;
            })
          : state.readOnlyChannels,
        threadOnlyChannels: state.threadOnlyChannels
          ? this.api.redux.mapEntries<{ isThreadOnly?: boolean }>(state.threadOnlyChannels, (id, entry) => {
              const next = access(id);
              return next ? { ...entry, isThreadOnly: next.threadOnly } : entry;
            })
          : state.threadOnlyChannels,
      };
    });
    this.api.patchComponent<RoadblockProps>('MessageInputRoadblock', (Original) => (props) => {
      if (!props.channelId || !this.access(props.channelId)) return <Original {...props} />;
      const { Button } = this.api.elements;
      return (
        <Original
          {...props}
          allowWrap
          roadblockMessage={
            <>
              {props.roadblockMessage}
              <Button
                type="outline"
                size="small"
                style={{ marginLeft: 8 }}
                onClick={() => this.ignore(props.channelId!)}
              >
                Post anyway
              </Button>
            </>
          }
        />
      );
    });
  }

  private access(id: string, state = this.api.redux.getRawState(), userId = this.api.members.getCurrentMemberId()) {
    return restrictedAccess(
      state?.channels?.[id],
      userId,
      {
        readOnly: !!state?.readOnlyChannels?.[id]?.isReadOnly,
        threadOnly: !!state?.threadOnlyChannels?.[id]?.isThreadOnly,
      },
      this.ignored.get(id),
    );
  }

  private ignore(id: string) {
    const userId = this.api.members.getCurrentMemberId();
    if (!userId) return;
    const channel: RestrictedChannel | undefined = this.api.redux.getRawState()?.channels?.[id];
    this.ignored.set(id, restrictionKey(channel, userId));
    this.api.redux.refresh();
  }
}
