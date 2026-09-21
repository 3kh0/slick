// Mask configured words in Slack messages, on this client only.
//
// v1 walked every rendered text node through the MutationObserver hub, so the
// uncensored word flashed for a frame and the cost scaled with the whole DOM.
// v2 transforms `state.messages` on read: React never sees the original, and
// the cost scales with messages actually read.
//
// `messages` is nested two levels (`messages[channelId][ts]`). A single-level
// `patchSlice` receives a channel bucket, compiles, runs, and does nothing.

import { SlickPlugin, type ComponentType, type SlackMessage } from '$slick';
import { compile, censorMessage, emptyMatcher, type Matcher } from './censor.ts';
import * as meta from './meta.ts';

type SearchProps = {
  result?: { messages?: SlackMessage[] };
};

const LIVE = ['terms', 'style', 'replacement', 'keepFirstLetter', 'keepLastLetter'] as const;

export default class Censorship extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = LIVE;

  private matcher: Matcher = emptyMatcher;

  start() {
    this.compile();
    this.api.redux.patchSlice<object>('messages', (_channelId, bucket) => {
      if (!bucket || typeof bucket !== 'object') return bucket;
      return this.api.redux.mapEntries<SlackMessage>(bucket, (_ts, message) => this.censor(message));
    });
    this.patchSearch();
    this.patchActivityFeed();
    this.log(this.matcher.pattern ? 'masking configured terms in messages' : 'no terms configured');
  }

  onSettingsChange() {
    this.compile();
    // mapEntries memos on the patch version. Without a refresh the closure keeps
    // serving results computed from the old terms and the plugin looks dead.
    this.api.redux.refresh();
  }

  private compile() {
    this.matcher = compile(this.config);
  }

  private censor(message?: SlackMessage): SlackMessage | undefined {
    return censorMessage(message, this.matcher);
  }

  /**
   * The activity feed renders from its own payload, not from `state.messages`
   * -- verified against a live client, where `MessageWrapper` and `Blocks` had
   * both rendered while `state.messages` was still empty. Without this, a
   * censored term is masked in the channel and visible in the activity feed.
   */
  private patchActivityFeed() {
    this.api.patchComponent<{ msg?: SlackMessage }>('ActivityItem', (Original) => (props) => {
      const React = this.api.react;
      const version = this.api.redux.usePatchVersion();
      const msg = React.useMemo(() => this.censor(props.msg), [props.msg, version]);
      return React.createElement(Original, { ...props, msg });
    });
  }

  // Search keeps its own copies that never pass through `messages`.
  private patchSearch() {
    this.api.patchComponent<SearchProps>(
      'MessageListItem',
      (Original) => (props) => this.renderSearch(Original, props),
    );
  }

  private renderSearch(Original: ComponentType<SearchProps>, props: SearchProps) {
    const React = this.api.react;
    const version = this.api.redux.usePatchVersion();
    const result = React.useMemo(() => {
      const found = props.result?.messages;
      if (!found?.length) return props.result;
      const next = found.map((msg) => this.censor(msg) ?? msg);
      return next.some((msg, i) => msg !== found[i]) ? { ...props.result, messages: next } : props.result;
    }, [props.result, version]);
    return React.createElement(Original, { ...props, result });
  }
}
