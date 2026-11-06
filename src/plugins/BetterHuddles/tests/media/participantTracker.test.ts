import { describe, it } from 'node:test';
import { createParticipantTracker } from '../../media/mediaSession.ts';
import { expect, mockFn } from '../expect.ts';

describe('createParticipantTracker', () => {
  it('lists people in join order and reports only changes', () => {
    const onChange = mockFn();
    const tracker = createParticipantTracker(onChange);
    tracker.update('a1', 'U1', true);
    tracker.update('a2', 'U2', true);
    tracker.update('a2', 'U2', true);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(['U1', 'U2']);
    tracker.update('a1', 'U1', false);
    expect(onChange).toHaveBeenLastCalledWith(['U2']);
  });

  it('keeps someone listed until their last device leaves', () => {
    const onChange = mockFn();
    const tracker = createParticipantTracker(onChange);
    tracker.update('phone', 'U1', true);
    tracker.update('laptop', 'U1', true);
    tracker.update('phone', 'U1', false);
    expect(onChange).toHaveBeenCalledTimes(1);
    tracker.update('laptop', 'U1', false);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('ignores screen-share attendees and leaves of unknown attendees', () => {
    const onChange = mockFn();
    const tracker = createParticipantTracker(onChange);
    tracker.update('a1#content', 'U1', true);
    tracker.update('zz', 'U9', false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
