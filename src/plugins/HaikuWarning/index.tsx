import { SlickPlugin, type Delta } from '$slick';
import { blocksToSlackText, dictionaryLookup, findHaiku } from './haiku.ts';
import * as meta from './meta.ts';

type SendArgs = { delta: Delta; channelId?: string; replyToTs?: string; viewContext?: string };
type SendProps = {
  prepareAndSendMessage: (args: SendArgs) => Promise<unknown>;
  channelId?: string;
};
type InputProxy = { clear: () => void };
type GetInputProxy = (key: { viewContext?: string; channelId?: string; threadTs?: string }) => InputProxy | undefined;

// Orpheus skips this channel (notice_poetry.rb).
const EXCLUDED_CHANNEL = 'C09MATKQM8C';
// Her checklist runs only on messages shorter than this, in code points.
const MAX_LENGTH = 300;
// Pinned, so the counts match the deployed bot; the cache key follows the pin.
const DICTIONARY_URL =
  'https://raw.githubusercontent.com/hackclub/orpheus-bot/aece7f5fcc873b8e71ecccfa5216849fafd959e1/app/lib/haiku_check/syllable_counts.txt';
const DICTIONARY_KEY = 'syllables-aece7f5';

export default class HaikuWarning extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private dictionary: Promise<string | null> = Promise.resolve(null);
  private prompt: { close: () => void } | null = null;
  // Set while an approved send runs, so a wrapper further down the same call lets it through.
  private approved = false;

  start() {
    this.dictionary = this.loadDictionary();
    for (const name of ['MessagePaneInput', 'InputContainer'] as const) {
      this.api.patchComponent<SendProps>(name, (Original) => (props) => {
        const send = (args: SendArgs) => this.onSend(props, args);
        return <Original {...props} prepareAndSendMessage={send} />;
      });
    }
  }

  stop() {
    this.prompt?.close();
    this.prompt = null;
  }

  private async onSend(props: SendProps, args: SendArgs): Promise<unknown> {
    const channelId = args.channelId || props.channelId;
    if (this.approved || channelId === EXCLUDED_CHANNEL) return props.prepareAndSendMessage(args);

    const haiku = await this.findHaiku(args.delta);
    if (!haiku) return props.prepareAndSendMessage(args);

    this.ask(haiku, () => this.sendAnyway(props, args));
    // The composer clears itself before sending and puts the message back when
    // the send rejects, which is how Slack's own warning dialogs hold a send.
    throw new Error('HaikuWarning: waiting for confirmation');
  }

  private ask(haiku: string[], send: () => void) {
    // A newer send replaces a prompt still open for an older one.
    this.prompt?.close();
    const settle = () => {
      if (this.prompt === handle) this.prompt = null;
    };
    const { MrkdwnElement } = this.api.elements;
    const handle = this.api.modal.openModal({
      title: <MrkdwnElement text=":orpheus-woah: Found a haiku in your message!" />,
      submitText: 'Send anyway',
      cancelText: 'Keep editing',
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            If Orpheus is in this channel she'll quote it back in the thread, where deleting yours won't remove it.
          </p>
          <blockquote style={{ whiteSpace: 'pre-line', margin: 0 }}>{haiku.join('\n')}</blockquote>
        </>
      ),
      onSubmit: () => {
        settle();
        if (!this.api.signal.aborted) send();
      },
      onCancel: settle,
      onClose: settle,
    });
    this.prompt = handle;
  }

  private sendAnyway(props: SendProps, args: SendArgs) {
    // Slack's dialogs clear the restored message the same way before sending it.
    const getInputProxy = this.api.getExport<GetInputProxy>(
      (exp: any) => typeof exp === 'function' && exp.name === 'getInputProxy',
    );
    getInputProxy?.({ viewContext: args.viewContext, channelId: args.channelId, threadTs: args.replyToTs })?.clear();

    this.approved = true;
    try {
      Promise.resolve(props.prepareAndSendMessage(args)).catch((error) => this.log('send failed', error));
    } catch (error) {
      this.log('send failed', error);
    } finally {
      this.approved = false;
    }
  }

  private async findHaiku(delta: Delta): Promise<string[] | null> {
    try {
      const [dictionary, blocks] = await Promise.all([this.loaded(), this.api.blocks.fromDelta(delta)]);
      // Without her dictionary the result would be a guess; don't hold the send for one.
      if (!dictionary) return null;

      const text = blocksToSlackText(blocks);
      // Ruby's String#length counts code points, not UTF-16 units.
      if ([...text].length >= MAX_LENGTH) return null;
      return findHaiku(text, (word) => dictionaryLookup(dictionary, word));
    } catch (error) {
      this.log('could not check message', error);
      return null;
    }
  }

  // A first-run download still in flight shouldn't hold a send for long.
  private loaded(): Promise<string | null> {
    return Promise.race([this.dictionary, new Promise<null>((resolve) => setTimeout(resolve, 3000, null))]);
  }

  private async loadDictionary(): Promise<string | null> {
    const cached = await this.api.storage.get<string | null>(DICTIONARY_KEY, null);
    if (cached) return cached;

    try {
      // Through the main process: the Slack page can't reach GitHub.
      const response = await this.api.fetch(DICTIONARY_URL);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      // The real file is ~1.4 MB; anything much smaller is a truncated download.
      if (response.body.length < 1_000_000) throw new Error('incomplete dictionary');
      if (this.api.signal.aborted) return null;
      await this.api.storage.set(DICTIONARY_KEY, response.body);
      return response.body;
    } catch (error) {
      if (!this.api.signal.aborted) this.log('could not load the syllable dictionary; not checking', error);
      return null;
    }
  }
}
