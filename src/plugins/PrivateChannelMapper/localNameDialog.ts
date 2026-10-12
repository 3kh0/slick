type LocalNameOptions = {
  id: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  onClose: () => void;
};

export function openLocalNameDialog(doc: Document, options: LocalNameOptions): { close: () => void } {
  const dialog = doc.createElement('dialog');
  dialog.className = 'slick-pcm-dialog';
  dialog.setAttribute('aria-labelledby', 'slick-pcm-title');
  const style = doc.createElement('style');
  style.textContent = `
    .slick-pcm-dialog { width: 420px; max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: 24px; border: 1px solid var(--dt_color-otl-ter, #666); border-radius: 12px;
      background: var(--dt_color-base-pry, #fff); color: var(--dt_color-content-pry, #1d1c1d);
      font: inherit; box-shadow: 0 16px 48px #0006; }
    .slick-pcm-dialog::backdrop { background: #0008; }
    .slick-pcm-dialog h2 { font-size: 20px; margin: 0 0 20px; }
    .slick-pcm-dialog label { display: block; font-weight: 700; margin-bottom: 8px; }
    .slick-pcm-dialog input { width: 100%; box-sizing: border-box; padding: 10px;
      border: 1px solid var(--dt_color-otl-pry, #777); border-radius: 4px;
      background: inherit; color: inherit; font: inherit; }
    .slick-pcm-dialog p { margin: 8px 0 20px; font-size: 13px; }
    .slick-pcm-dialog footer { display: flex; justify-content: flex-end; gap: 8px; }
    .slick-pcm-dialog button { font: inherit; font-weight: 700; padding: 8px 16px;
      border-radius: 4px; border: 1px solid var(--dt_color-otl-pry, #777);
      background: transparent; color: inherit; cursor: pointer; }
    .slick-pcm-dialog button[type=submit] { background: #007a5a; border-color: #007a5a; color: white; }
  `;
  const form = doc.createElement('form');
  const title = doc.createElement('h2');
  title.id = 'slick-pcm-title';
  title.textContent = 'Set local channel name';
  const label = doc.createElement('label');
  label.htmlFor = 'slick-pcm-local-name';
  label.textContent = options.id;
  const input = doc.createElement('input');
  input.id = label.htmlFor;
  input.value = options.value;
  input.placeholder = options.placeholder;
  input.autofocus = true;
  input.autocomplete = 'off';
  input.setAttribute('aria-describedby', 'slick-pcm-hint');
  const hint = doc.createElement('p');
  hint.id = 'slick-pcm-hint';
  hint.textContent = 'Only you see this name. Leave blank to remove your local name.';
  const footer = doc.createElement('footer');
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = doc.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  footer.append(cancel, save);
  form.append(title, label, input, hint, footer);
  dialog.append(style, form);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    options.onClose();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', close);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('keyup', (event) => event.stopPropagation());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onSave(input.value);
    close();
  });
  doc.body.append(dialog);
  dialog.showModal();
  input.select();
  return { close };
}
