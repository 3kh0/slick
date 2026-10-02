export function installCookieSignInButton(doc: Document, open: () => void) {
  const id = 'slick-cookie-sign-in';
  const update = () => {
    if (doc.getElementById(id)) return;
    const primary = Array.from(doc.querySelectorAll<HTMLElement>('button, a, [role="button"]')).find(
      (element) =>
        /^sign\s*in(?:\s+to\s+.+)?$/i.test(element.textContent?.trim() ?? '') &&
        element.getBoundingClientRect().width > 0,
    );
    if (!primary) return;
    const button = doc.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = 'Sign In with cookies';
    const style = doc.defaultView!.getComputedStyle(primary);
    Object.assign(button.style, {
      display: 'block',
      width: `${primary.getBoundingClientRect().width}px`,
      maxWidth: '100%',
      minHeight: style.height,
      borderRadius: style.borderRadius,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontStretch: style.fontStretch,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      marginTop: '12px',
      marginBottom: '12px',
      padding: style.padding,
      background: 'transparent',
      color: style.color,
      border: `1px solid ${style.color}`,
      cursor: 'pointer',
    });
    button.addEventListener('click', open);
    primary.after(button);
  };
  const observer = new MutationObserver(update);
  observer.observe(doc, { childList: true, subtree: true, characterData: true });
  update();
  return () => {
    observer.disconnect();
    doc.getElementById(id)?.remove();
  };
}
