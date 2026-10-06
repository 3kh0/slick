import { SlickPlugin, type Delta } from '$slick';
import { blocksToSlackText, dictionaryLookup, findHaiku } from './haiku.ts';
import * as meta from './meta.ts';
import dictionary from './syllable_counts.txt';

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
// The pinned Orpheus dictionary is bundled offline; see DICTIONARY-NOTICE.txt.

export default class HaikuWarning extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['blocks', 'elements', 'modal'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private prompt: { close: () => void } | null = null;
  // Set while an approved send runs, so a wrapper further down the same call lets it through.
  private approved = false;

  start() {
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
      const blocks = await this.api.blocks.fromDelta(delta);

      const text = blocksToSlackText(blocks);
      // Ruby's String#length counts code points, not UTF-16 units.
      if ([...text].length >= MAX_LENGTH) return null;
      return findHaiku(text, (word) => dictionaryLookup(dictionary, word));
    } catch (error) {
      this.log('could not check message', error);
      return null;
    }
  }
}
