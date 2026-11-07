type AttentionApp = Pick<Electron.App, 'getBadgeCount' | 'setBadgeCount'> & {
  dock?: Pick<Electron.Dock, 'getBadge' | 'setBadge' | 'bounce'>;
};

export function silenceAttention(app: AttentionApp, active: () => boolean) {
  const setCount = app.setBadgeCount;
  const dock = app.dock;
  const setBadge = dock?.setBadge;
  const bounce = dock?.bounce;
  let locked = false;
  let count = 0;
  let badge = '';

  const update = () => {
    const next = active();
    if (next && !locked) {
      count = app.getBadgeCount();
      badge = dock?.getBadge() ?? '';
      locked = true;
      setCount.call(app, 0);
      setBadge?.call(dock, '');
    } else if (!next && locked) {
      locked = false;
      setCount.call(app, count);
      setBadge?.call(dock, badge);
    }
  };

  app.setBadgeCount = function (value) {
    update();
    if (!locked) return setCount.call(this, value);
    count = value ?? 0;
    badge = count > 0 ? String(count) : '';
    return true;
  };
  if (dock && setBadge && bounce) {
    dock.setBadge = function (value) {
      update();
      if (!locked) return setBadge.call(this, value);
      badge = value;
    };
    dock.bounce = function (...args) {
      return active() ? -1 : bounce.apply(this, args);
    };
  }
  update();

  return {
    update,
    dispose() {
      if (locked) {
        setCount.call(app, count);
        setBadge?.call(dock, badge);
      }
      app.setBadgeCount = setCount;
      if (dock && setBadge && bounce) {
        dock.setBadge = setBadge;
        dock.bounce = bounce;
      }
    },
  };
}
