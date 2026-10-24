export function openHaikuDialog(doc: Document, haiku: string[], settle: (approved: boolean) => void) {
  const dialog = doc.createElement('dialog');
  dialog.className = 'slick-haiku-dialog';
  dialog.setAttribute('aria-labelledby', 'slick-haiku-title');
  const style = doc.createElement('style');
  style.textContent = `
    .slick-haiku-dialog { width: 520px; max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: 24px; border: 1px solid var(--dt_color-otl-ter, #666); border-radius: 12px;
      background: var(--dt_color-base-pry, #fff); color: var(--dt_color-content-pry, #1d1c1d);
      font: inherit; box-shadow: 0 16px 48px #0006; }
    .slick-haiku-dialog::backdrop { background: #0008; }
    .slick-haiku-dialog h2 { font-size: 20px; margin: 0 0 20px; }
    .slick-haiku-dialog blockquote { white-space: pre-line; margin: 20px 0; }
    .slick-haiku-dialog footer { display: flex; justify-content: flex-end; gap: 8px; }
    .slick-haiku-dialog button { font: inherit; font-weight: 700; padding: 8px 16px;
      border-radius: 4px; border: 1px solid var(--dt_color-otl-pry, #777);
      background: transparent; color: inherit; cursor: pointer; }
    .slick-haiku-dialog button[type=submit] { background: #007a5a; border-color: #007a5a; color: white; }
  `;
  const title = doc.createElement('h2');
  title.id = 'slick-haiku-title';
  title.textContent = 'Found a haiku in your message!';
  const body = doc.createElement('p');
  body.textContent =
    "If Orpheus is in this channel she'll quote it back in the thread, where deleting yours won't remove it.";
  const poem = doc.createElement('blockquote');
  poem.textContent = haiku.join('\n');
  const form = doc.createElement('form');
  const footer = doc.createElement('footer');
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.autofocus = true;
  cancel.textContent = 'Keep editing';
  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Send anyway';
  footer.append(cancel, submit);
  form.append(title, body, poem, footer);
  dialog.append(style, form);
  let closed = false;
  const finish = (approved = false) => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    settle(approved);
  };
  cancel.addEventListener('click', () => finish());
  dialog.addEventListener('close', () => finish());
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('keyup', (event) => event.stopPropagation());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  });
  doc.body.append(dialog);
  try {
    dialog.showModal();
  } catch (error) {
    dialog.remove();
    throw error;
  }
  return { close: () => finish() };
}
