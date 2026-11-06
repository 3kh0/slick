// The call window's stylesheet (installed with api.setStyle). Colours are
// the call's own tokens, scoped to the window so Slack themes don't
// recolour a video call. Every class is prefixed `sbh-` to stay out of Slack's way.

export const CALL_WINDOW_CSS = `
.sbh-window {
  --sbh-stage-bg: #1a1d21;
  --sbh-tile-bg: #000000;
  --sbh-pill-bg: rgba(255, 255, 255, 0.95);
  --sbh-pill-text: #1d1c1d;
  --sbh-speaking-ring: #ffffff;
  --sbh-speaking-glow: rgba(255, 255, 255, 0.45);
  --sbh-speaking-bars: #2bac76;
  --sbh-badge-bg: rgba(0, 0, 0, 0.6);
  --sbh-group-outline: rgba(255, 255, 255, 0.16);
  --sbh-group-bg: rgba(255, 255, 255, 0.03);
  --sbh-control-bg: rgba(255, 255, 255, 0.12);
  --sbh-control-hover: rgba(255, 255, 255, 0.2);
  --sbh-control-text: #ffffff;
  --sbh-success: #2bac76;
  --sbh-danger: #e01e5a;
  --sbh-log-bg: rgba(0, 0, 0, 0.35);
  --sbh-radius: 12px;
  --sbh-tile-radius: 10px;

  position: fixed;
  z-index: 10000;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: var(--sbh-radius);
  background: var(--sbh-stage-bg);
  color: var(--sbh-control-text);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08);
  font-family: Slack-Lato, Lato, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.4;
}
.sbh-window--filled, .sbh-window:fullscreen {
  inset: 0;
  border-radius: 0;
  box-shadow: none;
}
.sbh-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 12px 16px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.sbh-window--filled .sbh-header, .sbh-window:fullscreen .sbh-header { cursor: default; }
.sbh-where {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 18px;
  font-weight: 900;
}
.sbh-where svg { flex: none; color: var(--sbh-success); }
.sbh-where-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sbh-header-end { display: inline-flex; align-items: center; gap: 8px; min-width: 0; margin: -4px -8px -4px 0; }
.sbh-meta {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  opacity: 0.75;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sbh-icon-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.sbh-icon-button:hover { background: var(--sbh-control-bg); }
.sbh-body { min-height: 0; }
.sbh-stage {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 12px;
}
.sbh-stage-status { margin: 0; font-size: 18px; opacity: 0.8; }
.sbh-tile {
  position: relative;
  flex: none;
  margin: 0;
  overflow: hidden;
  border-radius: var(--sbh-tile-radius);
  background: var(--sbh-tile-bg);
  box-shadow: 0 0 0 0 transparent;
  transition: box-shadow 0.15s ease;
}
.sbh-tile--speaking {
  box-shadow: 0 0 0 3px var(--sbh-speaking-ring), 0 0 18px 4px var(--sbh-speaking-glow);
}
/* Four people without video sharing one video-sized slot. */
.sbh-group {
  display: grid;
  flex: none;
  box-sizing: border-box;
  grid-template-columns: repeat(2, max-content);
  grid-auto-rows: max-content;
  /* Top-left, so tiles stay put as people join or leave the group. */
  align-content: start;
  justify-content: start;
  border-radius: var(--sbh-tile-radius);
  /* Outlines the whole slot, so a half-empty group still shows it's one big tile's worth of space. */
  outline: 1px solid var(--sbh-group-outline);
  background: var(--sbh-group-bg);
}
/* Icons in the pill and corner scale with the tile too. */
.sbh-pill svg, .sbh-corner-button svg {
  width: calc(14px * var(--sbh-scale, 1));
  height: calc(14px * var(--sbh-scale, 1));
}
.sbh-bars { transform: scale(var(--sbh-scale, 1)); transform-origin: left center; }
.sbh-video, .sbh-photo {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--sbh-tile-bg);
  object-fit: cover;
}
/* Your own camera is mirrored like every video app, so moving left looks left. */
.sbh-video--mirrored { transform: scaleX(-1); }
.sbh-initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #ffffff;
  font-weight: 900;
  letter-spacing: 0.02em;
}
.sbh-corner {
  position: absolute;
  top: calc(8px * var(--sbh-scale, 1));
  right: calc(8px * var(--sbh-scale, 1));
  display: flex;
  gap: calc(6px * var(--sbh-scale, 1));
}
/* The gear on your own tile only shows while you hover it (or tab to it). */
.sbh-corner-button--on-hover { opacity: 0; transition: opacity 0.12s ease; }
.sbh-tile:hover .sbh-corner-button--on-hover, .sbh-corner-button--on-hover:focus-visible { opacity: 1; }
.sbh-corner-button {
  display: grid;
  place-items: center;
  width: calc(26px * var(--sbh-scale, 1));
  height: calc(26px * var(--sbh-scale, 1));
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: var(--sbh-badge-bg);
  color: var(--sbh-control-text);
  cursor: pointer;
}
.sbh-corner-button:hover, .sbh-corner-button--active { background: var(--sbh-pill-bg); color: var(--sbh-pill-text); }
.sbh-caption {
  --sbh-inset: calc(12px * var(--sbh-scale, 1));
  position: absolute;
  left: var(--sbh-inset);
  right: var(--sbh-inset);
  bottom: var(--sbh-inset);
  display: flex;
}
.sbh-pill {
  display: inline-flex;
  align-items: center;
  gap: calc(8px * var(--sbh-scale, 1));
  max-width: 100%;
  padding: calc(4px * var(--sbh-scale, 1)) calc(12px * var(--sbh-scale, 1));
  overflow: hidden;
  border-radius: 999px;
  background: var(--sbh-pill-bg);
  color: var(--sbh-pill-text);
  font-size: calc(15px * var(--sbh-scale, 1));
  white-space: nowrap;
}
.sbh-pill strong, .sbh-pill-pronouns { overflow: hidden; text-overflow: ellipsis; }
.sbh-pill strong { font-weight: 700; }
.sbh-pill-pronouns { flex-shrink: 1000; }
.sbh-pill-muted { display: grid; color: var(--sbh-danger); }
.sbh-bars { display: inline-flex; align-items: center; gap: 2px; height: 14px; }
.sbh-bars i {
  width: 3px;
  height: 5px;
  border-radius: 2px;
  background: var(--sbh-speaking-bars);
  animation: sbh-talk 0.9s ease-in-out infinite;
}
.sbh-bars i:nth-child(2) { animation-delay: -0.3s; }
.sbh-bars i:nth-child(3) { animation-delay: -0.6s; }
.sbh-bars i:nth-child(4) { animation-delay: -0.15s; }
@keyframes sbh-talk { 0%, 100% { height: 5px; } 50% { height: 14px; } }
@media (prefers-reduced-motion: reduce) { .sbh-bars i { animation: none; height: 10px; } }
.sbh-footer { padding: 12px 16px 20px; }
.sbh-notice { margin: 0 0 8px; font-size: 13px; text-align: center; color: #ffd6e0; }
.sbh-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; }
.sbh-control {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--sbh-control-bg);
  color: var(--sbh-control-text);
  cursor: pointer;
  transition: background 0.12s ease;
}
.sbh-control:hover:not(:disabled) { background: var(--sbh-control-hover); }
.sbh-control:disabled { cursor: default; opacity: 0.45; }
.sbh-control--active, .sbh-control--active:hover:not(:disabled) { background: var(--sbh-success); }
.sbh-control--warning, .sbh-control--warning:hover:not(:disabled) { background: var(--sbh-control-text); color: var(--sbh-stage-bg); }
.sbh-control--warning:hover:not(:disabled) { filter: brightness(0.9); }
.sbh-control--danger, .sbh-control--danger:hover:not(:disabled) { width: 64px; border-radius: 26px; background: var(--sbh-danger); }
.sbh-control--active:hover:not(:disabled), .sbh-control--danger:hover:not(:disabled) { filter: brightness(1.1); }
.sbh-failure {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  height: 100%;
  padding: 16px 24px;
  overflow: auto;
  text-align: center;
}
.sbh-failure p { margin: 0; max-width: 48ch; line-height: 1.4; }
.sbh-text-button {
  padding: 6px 16px;
  border: 0;
  border-radius: 6px;
  background: var(--sbh-control-bg);
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.sbh-text-button:hover { background: var(--sbh-control-hover); }
.sbh-log { display: grid; gap: 6px; width: 100%; min-width: 0; text-align: left; }
.sbh-log-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; opacity: 0.8; }
.sbh-log-bar .sbh-text-button { padding: 4px 10px; font-size: 12px; }
.sbh-log-text {
  max-height: 180px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--sbh-log-bg);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
/* Invisible grab strips on every side and corner; the bottom-right one also shows a grip. */
.sbh-resize { position: absolute; z-index: 2; touch-action: none; }
.sbh-resize--n, .sbh-resize--s { left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.sbh-resize--n { top: 0; }
.sbh-resize--s { bottom: 0; }
.sbh-resize--e, .sbh-resize--w { top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
.sbh-resize--e { right: 0; }
.sbh-resize--w { left: 0; }
.sbh-resize--ne, .sbh-resize--nw, .sbh-resize--se, .sbh-resize--sw { width: 16px; height: 16px; }
.sbh-resize--ne { top: 0; right: 0; cursor: nesw-resize; }
.sbh-resize--sw { bottom: 0; left: 0; cursor: nesw-resize; }
.sbh-resize--nw { top: 0; left: 0; cursor: nwse-resize; }
.sbh-resize--se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 55%, rgba(255, 255, 255, 0.35) 55%, rgba(255, 255, 255, 0.35) 62%, transparent 62%, transparent 75%, rgba(255, 255, 255, 0.35) 75%, rgba(255, 255, 255, 0.35) 82%, transparent 82%);
}
/* Collapsed to an audio-only bar. */
.sbh-window--bar {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 16px);
  padding-right: 12px;
  border-radius: 999px;
}
.sbh-window--bar .sbh-header { flex: 1 1 auto; padding: 8px 4px 8px 20px; }
.sbh-window--bar .sbh-where { font-size: 15px; }
.sbh-window--bar .sbh-header-end { margin: 0; }
.sbh-window--bar .sbh-controls { flex-wrap: nowrap; gap: 8px; }
.sbh-window--bar .sbh-control { width: 40px; height: 40px; }
.sbh-window--bar .sbh-control--danger { width: 52px; }
/* Settings slide over the stage. */
.sbh-body { position: relative; }
.sbh-settings {
  --sbh-settings-bg: #222529;
  --sbh-field-bg: #1a1d21;
  --sbh-field-border: rgba(255, 255, 255, 0.18);
  --sbh-error-text: #ffd6e0;
  position: absolute;
  z-index: 1;
  top: 8px;
  right: 8px;
  bottom: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(420px, calc(100% - 16px));
  padding: 12px 16px 16px;
  overflow: auto;
  border-radius: var(--sbh-tile-radius);
  background: var(--sbh-settings-bg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.sbh-settings[hidden] { display: none; }
.sbh-settings h2, .sbh-settings h3 { margin: 0; font-weight: 900; }
.sbh-settings h2 { font-size: 16px; }
.sbh-settings h3 { font-size: 14px; }
.sbh-settings-section { display: flex; flex-direction: column; gap: 8px; }
.sbh-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sbh-select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--sbh-field-border);
  border-radius: 6px;
  background: var(--sbh-field-bg);
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.sbh-hint { margin: 0; font-size: 12px; opacity: 0.75; }
.sbh-hint code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.sbh-text-button:disabled { cursor: default; opacity: 0.45; }
.sbh-text-button--active { background: var(--sbh-success); }
.sbh-text-button--active:hover { background: var(--sbh-success); filter: brightness(1.1); }
.sbh-code {
  display: flex;
  height: 260px;
  min-height: 120px;
  overflow: hidden;
  border: 1px solid var(--sbh-field-border);
  border-radius: 6px;
  background: var(--sbh-field-bg);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
}
.sbh-code-gutter {
  flex: none;
  margin: 0;
  padding: 8px 6px 8px 8px;
  overflow: hidden;
  font: inherit;
  text-align: right;
  opacity: 0.4;
  user-select: none;
}
.sbh-code-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: pre;
  tab-size: 2;
  resize: none;
}
.sbh-code-errors {
  max-height: 120px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--sbh-log-bg);
  color: var(--sbh-error-text);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
`;
