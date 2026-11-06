// The "Video effect" part of the settings panel: turn your shader on or off,
// start from a template, edit the GLSL, and apply it (live, if it's on).

import { ShaderCompileError } from '../media/shaderSource.ts';
import { SHADER_TEMPLATES } from '../media/shaderTemplates.ts';
import { checkShaderSource } from '../media/shaderVideo.ts';
import { useCallState, useHuddleUi, usePreferences } from './context.ts';

const INDENT = '  ';

/** Tab indents instead of leaving the editor; ⌘/Ctrl+Enter applies. */
function handleEditorKeys(event: React.KeyboardEvent<HTMLTextAreaElement>, onApply: () => void): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    onApply();
    return;
  }
  if (event.key !== 'Tab' || event.shiftKey) return;
  event.preventDefault();
  const editor = event.currentTarget;
  // execCommand keeps the browser's undo history, unlike setting `value`.
  if (!editor.ownerDocument.execCommand('insertText', false, INDENT))
    editor.setRangeText(INDENT, editor.selectionStart, editor.selectionEnd, 'end');
}

/** Line numbers beside the code, so "Error (line 12)" is easy to find. */
function CodeEditor({
  value,
  onChange,
  onApply,
}: {
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
}) {
  const gutterRef = React.useRef<HTMLPreElement>(null);
  const lineCount = value.split('\n').length;
  const numbers = Array.from({ length: lineCount }, (_unused, index) => index + 1).join('\n');
  return (
    <div className="sbh-code">
      <pre className="sbh-code-gutter" ref={gutterRef} aria-hidden="true">
        {numbers}
      </pre>
      <textarea
        className="sbh-code-text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        aria-label="Shader code (GLSL)"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => handleEditorKeys(event, onApply)}
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (source: string) => void }) {
  return (
    <select
      className="sbh-select"
      value=""
      aria-label="Load a template"
      onChange={(event) => {
        const template = SHADER_TEMPLATES.find((candidate) => candidate.id === event.currentTarget.value);
        if (template) onPick(template.source);
      }}
    >
      <option value="">Load a template…</option>
      {SHADER_TEMPLATES.map((template) => (
        <option key={template.id} value={template.id}>
          {template.camera ? `${template.name} (uses your camera)` : template.name}
        </option>
      ))}
    </select>
  );
}

export function ShaderEditor({ onControlError }: { onControlError: (prefix: string, error: unknown) => void }) {
  const { call, document: uiDocument } = useHuddleUi();
  const state = useCallState();
  const saved = usePreferences().shaderSource;
  const [draft, setDraft] = React.useState(saved);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState('');
  const dirty = draft !== saved;

  const apply = () => {
    const problems = checkShaderSource(draft);
    setErrors(problems);
    setStatus('');
    if (problems.length) return;
    call
      .setShaderSource(draft)
      .then(() => setStatus(call.state.get().shaderOn ? 'Sent to the huddle.' : 'Saved.'))
      .catch((error: unknown) => {
        if (error instanceof ShaderCompileError) setErrors(error.lines);
        else onControlError("Couldn't apply the video effect", error);
      });
  };
  const loadTemplate = (source: string) => {
    if (dirty && !uiDocument.defaultView?.confirm('Replace your unapplied changes with this template?')) return;
    setDraft(source);
    setErrors([]);
    setStatus('');
  };
  const toggle = () =>
    call.toggleShader().catch((error: unknown) => onControlError("Couldn't switch your video effect", error));

  return (
    <section className="sbh-settings-section">
      <div className="sbh-settings-row">
        <span className="sbh-hint">{state.shaderOn ? 'Sending to the huddle' : 'Not sending'}</span>
        <button
          type="button"
          className={state.shaderOn ? 'sbh-text-button sbh-text-button--active' : 'sbh-text-button'}
          aria-pressed={state.shaderOn}
          disabled={state.status !== 'connected'}
          onClick={toggle}
        >
          {state.shaderOn ? 'Stop sending' : 'Send effect'}
        </button>
      </div>
      <p className="sbh-hint">
        A GLSL shader sent as your video, camera on or off. Write a Shadertoy-style <code>mainImage</code>.
      </p>
      <TemplatePicker onPick={loadTemplate} />
      <CodeEditor
        value={draft}
        onChange={(value) => {
          setDraft(value);
          setStatus('');
        }}
        onApply={apply}
      />
      {errors.length > 0 && (
        <pre className="sbh-code-errors" role="alert">
          {errors.join('\n')}
        </pre>
      )}
      <div className="sbh-settings-row">
        <span className="sbh-hint" role="status">
          {status || (dirty ? 'Unapplied changes' : '')}
        </span>
        <button
          type="button"
          className="sbh-text-button"
          title="⌘/Ctrl+Enter"
          disabled={!dirty && errors.length === 0}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </section>
  );
}
