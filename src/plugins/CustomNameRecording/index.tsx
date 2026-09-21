// Upload an audio file as your name recording, instead of recording one.
//
// Slack computes a duration and a waveform when it records, and then reads
// them back off the File object at upload time rather than measuring the
// audio. An uploaded file has to carry the same fields or Slack rejects it, so
// `describe` decodes the audio and derives them.
//
// v1 built its buttons by cloning Slack's DOM and re-binding the handlers.
// v2 renders alongside Slack's own button and uses its props -- the upload
// callbacks (`onChangeFile`, `onFileUploadStart`/`End`) are already there, so
// the recording lands through exactly the path Slack's own recorder uses.
//
// Adapted from Taut's CustomNameRecording (MIT, github.com/jeremy46231/taut).

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type AudioButtonProps = {
  onChangeFile?: (fileId: string | null) => void;
  onFileUploadStart?: () => void;
  onFileUploadEnd?: () => void;
};

const FILE_NAME = 'audio_name_pronunciation.mp3';
const SUBTYPE = 'slack_name_pronunciation';

/** The file they chose, or null if they closed the picker. */
function pickAudio(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    Object.assign(input, { type: 'file', accept: 'audio/mpeg,.mp3' });
    input.style.display = 'none';

    const done = (file: File | null) => {
      resolve(file);
      input.remove();
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

/** The waveform Slack draws: one peak per bar, each 0-100. */
function peaks(channel: Float32Array, count: number): number[] {
  const width = Math.max(1, Math.floor(channel.length / count));
  return Array.from({ length: count }, (_, bar) => {
    const start = bar * width;
    const end = Math.min(channel.length, start + width);
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
    return Math.round(peak * 100);
  });
}

export default class CustomNameRecording extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    this.api.setStyle(`
      .slick-cnr__upload { margin-left: 8px; }
      .slick-cnr__error { margin-top: 4px; }
    `);

    this.api.patchComponent<AudioButtonProps>('EditAudioButton', (Original) => (props) => (
      <>
        <Original {...props} />
        <this.UploadButton {...props} />
      </>
    ));
  }

  private readonly UploadButton = (props: AudioButtonProps) => {
    const { Button, SvgIcon, InlineAlert } = this.api.elements;
    const [busy, setBusy] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const onClick = () => {
      setError(null);
      this.upload(props, setBusy)
        .catch((problem) => setError((problem as Error)?.message || 'Could not upload that file'))
        .finally(() => setBusy(null));
    };

    return (
      <>
        <Button className="slick-cnr__upload" type="outline" size="medium" onClick={onClick} disabled={busy !== null}>
          <SvgIcon name="file-upload" size={18} inline />
          <span className="margin_left_25">{busy ?? 'Upload audio'}</span>
        </Button>
        {error ? <InlineAlert className="slick-cnr__error c-inline_alert--level_error">{error}</InlineAlert> : null}
      </>
    );
  };

  private async upload(props: AudioButtonProps, setBusy: (label: string | null) => void) {
    const source = await pickAudio();
    if (!source) return;

    setBusy('Checking…');
    const file = await this.describe(source);

    setBusy('Uploading…');
    props.onFileUploadStart?.();
    try {
      props.onChangeFile?.(await this.api.files.upload(file));
    } finally {
      // Always paired, or Slack's dialog stays stuck in its uploading state.
      props.onFileUploadEnd?.();
    }
  }

  /** Slack reads these fields off the File rather than measuring it. */
  private async describe(source: File): Promise<File> {
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await source.arrayBuffer());
      const bars = Math.min(100, Math.max(20, Math.round(audio.duration * 5)));
      return Object.assign(new File([source], FILE_NAME, { type: 'audio/mpeg' }), {
        subtype: SUBTYPE,
        duration: audio.duration,
        audio_wave_samples: peaks(audio.getChannelData(0), bars),
      });
    } catch {
      throw new Error('That file could not be read as audio');
    } finally {
      void context.close();
    }
  }
}
