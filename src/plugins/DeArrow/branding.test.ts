import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandingOf, replacements, videoIdOf } from './branding.ts';

test('videoIdOf reads every YouTube link shape', () => {
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=5_Fayfx2NUM'), '5_Fayfx2NUM');
  assert.equal(videoIdOf('https://www.youtube.com/watch?feature=share&v=5_Fayfx2NUM&t=10'), '5_Fayfx2NUM');
  assert.equal(videoIdOf('https://youtu.be/5_Fayfx2NUM?si=abc'), '5_Fayfx2NUM');
  assert.equal(videoIdOf('https://m.youtube.com/shorts/5_Fayfx2NUM'), '5_Fayfx2NUM');
  assert.equal(videoIdOf('https://www.youtube.com/live/5_Fayfx2NUM'), '5_Fayfx2NUM');
  assert.equal(videoIdOf('https://www.youtube.com/@kurzgesagt'), null);
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(videoIdOf('https://example.com/watch?v=5_Fayfx2NUM'), null);
  assert.equal(videoIdOf(undefined), null);
});

test('brandingOf keeps only submissions the community agrees on', () => {
  assert.deepEqual(
    brandingOf({
      titles: [{ title: 'How >Cisplatin saved >Philipp', original: false, votes: 1 }],
      thumbnails: [{ timestamp: 3.9, original: false, votes: 2 }],
    }),
    { title: 'How Cisplatin saved Philipp', thumbTime: 3.9 },
  );
  assert.deepEqual(
    brandingOf({
      titles: [{ title: 'Better', votes: 0 }],
      thumbnails: [{ timestamp: null, original: true, votes: 9 }],
    }),
    { title: 'Better' },
  );
  assert.equal(brandingOf({ titles: [{ title: 'Worse', votes: -1 }], thumbnails: [] }), null);
  assert.equal(brandingOf({ titles: [{ title: 'Same', original: true, votes: 3 }] }), null);
  assert.equal(brandingOf(null), null);
});

test('replacements follow the Replace setting', () => {
  const branding = { title: 'Better', thumbTime: 1.5 };
  const thumbUrl = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=5_Fayfx2NUM&time=1.5';
  assert.deepEqual(replacements('5_Fayfx2NUM', branding, 'all'), { title: 'Better', thumbUrl });
  assert.deepEqual(replacements('5_Fayfx2NUM', branding, 'titles'), { title: 'Better', thumbUrl: undefined });
  assert.deepEqual(replacements('5_Fayfx2NUM', branding, 'thumbnails'), { title: undefined, thumbUrl });
  assert.deepEqual(replacements('5_Fayfx2NUM', null, 'all'), { title: undefined, thumbUrl: undefined });
});
