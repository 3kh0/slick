// This attempt's log (callLog.ts) under the "couldn't join" / "call ended"
// message, with a button that copies it as plain text for a bug report.

import type { CallLog } from '../callLog.ts';

const COPIED_MS = 2_000;

function logHeader(): string {
  return `Better Huddles log · ${new Date().toISOString()} · ${navigator.userAgent}`;
}

/** Copies the text, or selects it in `fallback` so ⌘C / Ctrl+C works when the clipboard API is refused. */
async function copyText(text: string, fallback: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn(
      `[slick] [Better Huddles] clipboard write refused, selecting the log instead: ${(error as Error).message}`,
    );
    if (fallback) window.getSelection()?.selectAllChildren(fallback);
    return false;
  }
}

export function CallLogPanel({ log }: { log: CallLog }) {
  const entries = React.useSyncExternalStore(log.entries.subscribe, log.entries.get);
  const [copyLabel, setCopyLabel] = React.useState('Copy logs');
  const textRef = React.useRef<HTMLPreElement>(null);

  React.useEffect(() => {
    if (copyLabel === 'Copy logs') return;
    const timer = setTimeout(() => setCopyLabel('Copy logs'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copyLabel]);

  const copy = async () => {
    const copied = await copyText(log.format(logHeader()), textRef.current);
    setCopyLabel(copied ? 'Copied' : 'Selected: press ⌘C / Ctrl+C');
  };

  if (entries.length === 0) return null;
  return (
    <div className="sbh-log">
      <div className="sbh-log-bar">
        <span>Logs ({entries.length})</span>
        <button type="button" className="sbh-text-button" onClick={copy}>
          {copyLabel}
        </button>
      </div>
      <pre className="sbh-log-text" ref={textRef}>
        {log.format()}
      </pre>
    </div>
  );
}
