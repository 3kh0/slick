// Mask configured words by transforming `state.messages` on read, so React
// never sees the original (no flash of the uncensored word).
//
// `messages` is nested two levels (`messages[channelId][ts]`): the patchSlice
// callback gets a channel bucket, not a message.

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
    this.patchMessageRows();
    this.patchSearch();
    this.patchActivityFeed();
    this.log(this.matcher.pattern ? 'masking configured terms in messages' : 'no terms configured');
  }

  onSettingsChange() {
    this.compile();
    // mapEntries memos on the patch version; without a refresh it keeps
    // serving results masked with the old terms.
    this.api.redux.refresh();
  }

  private compile() {
    this.matcher = compile(this.config);
  }

  private censor(message?: SlackMessage): SlackMessage | undefined {
    return censorMessage(message, this.matcher);
  }

  /** These rows receive copied message props, so the store patch alone can't
   *  update an already mounted conversation. */
  private patchMessageRows() {
    for (const name of ['MessageWrapper', 'ThreadRootGeneric']) {
      this.api.patchComponent<{ msg?: SlackMessage }>(name, (Original) => (props) => {
        const React = this.api.react;
        const version = this.api.redux.usePatchVersion();
        const msg = React.useMemo(() => this.censor(props.msg), [props.msg, version]);
        return React.createElement(Original, { ...props, msg });
      });
    }
  }

  /** `ActivityItem` gets its own message payload, not one from the store. */
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
