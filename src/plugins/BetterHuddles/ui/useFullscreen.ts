// Browser full screen for the call window. Only the window goes full screen (not the Slack page under it), and
// Esc or the browser's own UI can leave it, so the real state is followed.

export function useFullscreen(targetRef: React.RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    const target = targetRef.current;
    const document = target?.ownerDocument;
    if (!document) return;
    const sync = () =>
      setFullscreen(Boolean(document.fullscreenElement && document.fullscreenElement === targetRef.current));
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      // The call ending (window unmounting) also leaves full screen.
      if (document.fullscreenElement && document.fullscreenElement === target) {
        document
          .exitFullscreen()
          .catch((error: Error) =>
            console.warn(`[slick] [Better Huddles] leaving full screen failed: ${error.message}`),
          );
      }
    };
  }, [targetRef]);

  const toggle = React.useCallback(async () => {
    const document = targetRef.current?.ownerDocument;
    if (!document) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await targetRef.current?.requestFullscreen();
    } catch (error) {
      // Browsers refuse full screen outside a user gesture or in some embedded frames; the window still works.
      console.warn(`[slick] [Better Huddles] full screen isn't available here: ${(error as Error).message}`);
    }
  }, [targetRef]);

  return { fullscreen, toggle };
}
