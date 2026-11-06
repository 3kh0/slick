import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  avatarHue,
  avatarInitials,
  conversationLabel,
  formatHuddleDuration,
  memberDisplayName,
  memberPhotoUrl,
  peopleCountLabel,
} from '../../ui/callText.ts';

describe('formatHuddleDuration', () => {
  it('says "just now", minutes, then hours and minutes', () => {
    assert.equal(formatHuddleDuration(20), 'just now');
    assert.equal(formatHuddleDuration(3 * 60), '3 min');
    assert.equal(formatHuddleDuration(65 * 60), '1 h 5 min');
    assert.equal(formatHuddleDuration(120 * 60), '2 h');
    assert.equal(formatHuddleDuration(-5), 'just now');
  });
});

describe('memberDisplayName', () => {
  it('prefers the display name, then real names, then the handle', () => {
    assert.equal(memberDisplayName({ profile: { display_name: 'ada', real_name: 'Ada L' } }), 'ada');
    assert.equal(memberDisplayName({ profile: { display_name: '', real_name: 'Ada L' } }), 'Ada L');
    assert.equal(memberDisplayName({ name: 'ada.l' }), 'ada.l');
    assert.equal(memberDisplayName(undefined), 'Someone');
  });
});

describe('memberPhotoUrl', () => {
  it('picks the biggest https photo and refuses other schemes', () => {
    assert.equal(
      memberPhotoUrl({
        profile: {
          image_original: 'https://avatars.slack-edge.com/big.png',
          image_192: 'https://avatars.slack-edge.com/small.png',
        },
      }),
      'https://avatars.slack-edge.com/big.png',
    );
    assert.equal(
      memberPhotoUrl({
        profile: { image_original: 'javascript:alert(1)', image_512: 'https://avatars.slack-edge.com/512.png' },
      }),
      'https://avatars.slack-edge.com/512.png',
    );
    assert.equal(memberPhotoUrl({ profile: { image_512: 'http://insecure.example/a.png' } }), '');
  });
});

describe('conversationLabel', () => {
  const names = (userId: string) => (userId === 'U1' ? 'ada' : undefined);

  it('names channels with a #, DMs after the other person', () => {
    assert.equal(conversationLabel({ name: 'general', is_channel: true }, names), '#general');
    assert.equal(conversationLabel({ is_im: true, user: 'U1' }, names), 'ada');
    assert.equal(conversationLabel({ is_im: true, user: 'U2' }, names), 'Direct message');
    assert.equal(conversationLabel({ is_mpim: true, name: 'mpdm-ada--grace-1' }, names), 'Group message');
  });

  it('falls back to "Huddle" for conversations that aren’t loaded', () => {
    assert.equal(conversationLabel(undefined, names), 'Huddle');
  });
});

describe('peopleCountLabel', () => {
  it('uses the singular for one person', () => {
    assert.equal(peopleCountLabel(1), '1 person');
    assert.equal(peopleCountLabel(3), '3 people');
  });
});

describe('avatarHue / avatarInitials (no-photo tile)', () => {
  it('gives each seed a stable hue in 0..359', () => {
    assert.equal(avatarHue('U123'), avatarHue('U123'));
    assert.notEqual(avatarHue('U123'), avatarHue('U124'));
    for (const seed of ['', 'U1', 'a much longer seed string']) {
      const hue = avatarHue(seed);
      assert.ok(hue >= 0 && hue < 360);
    }
  });

  it('uses the first two letters, upper-cased', () => {
    assert.equal(avatarInitials('ada'), 'AD');
    assert.equal(avatarInitials('Z'), 'Z');
  });
});
