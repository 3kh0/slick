(function () {
  'use strict';
  if (window.__slickSilentTyping) return;
  const state = (window.__slickSilentTyping = { dropped: 0 });

  const og = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === 'string' && data.includes('typing')) {
      try {
        const t = JSON.parse(data).type;
        if (t === 'typing' || t === 'user_typing') {
          state.dropped++;
          return;
        }
      } catch (e) {}
    }
    return og.apply(this, arguments);
  };
})();
