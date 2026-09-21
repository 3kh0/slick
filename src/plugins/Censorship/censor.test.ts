import assert from 'node:assert/strict';
import { test } from 'node:test';
import { censorDeep, censorMessage, censorString, compile, type CensorConfig } from './censor.ts';

const defaults: CensorConfig = {
  terms: 'job, employment',
  style: 'stars',
  replacement: 'uwu',
  keepFirstLetter: false,
  keepLastLetter: false,
};

test('compile: empty terms yield a null pattern', () => {
  const matcher = compile({ ...defaults, terms: '  , \n' });
  assert.equal(matcher.pattern, null);
  assert.equal(censorString('job', matcher), 'job');
});

test('censorString: masks whole words, not substrings', () => {
  const matcher = compile(defaults);
  assert.equal(censorString('job interview', matcher), '*** interview');
  assert.equal(censorString('jobless', matcher), 'jobless');
  assert.equal(censorString('Job', matcher), '***');
});

test('censorString: longer terms win because they are compiled first', () => {
  const matcher = compile({ ...defaults, terms: 'employ, employment' });
  assert.equal(censorString('employment', matcher), '**********');
});

test('censorString: metacharacters in a term cannot blow up or match wildly', () => {
  const matcher = compile({ ...defaults, terms: 'a.b+' });
  assert.equal(censorString('a.b+', matcher), '****');
  assert.equal(censorString('axbx', matcher), 'axbx');
});

test('censorString: multi-word terms allow any whitespace between words', () => {
  const matcher = compile({ ...defaults, terms: 'job interview' });
  assert.equal(censorString('job   interview', matcher), '***   *********');
});

test('censorString: keepFirstLetter and keepLastLetter pin the edges', () => {
  const first = compile({ ...defaults, keepFirstLetter: true });
  const last = compile({ ...defaults, keepLastLetter: true });
  const both = compile({ ...defaults, keepFirstLetter: true, keepLastLetter: true });
  assert.equal(censorString('job', first), 'j**');
  assert.equal(censorString('job', last), '**b');
  assert.equal(censorString('job', both), 'j*b');
});

test('censorString: custom replacement replaces the whole match', () => {
  const matcher = compile({ ...defaults, style: 'custom', replacement: 'redacted' });
  assert.equal(censorString('this job sucks', matcher), 'this redacted sucks');
});

test('censorString: hashtags and blocks use their mask character', () => {
  const hashes = compile({ ...defaults, style: 'hashtags' });
  const blocks = compile({ ...defaults, style: 'blocks' });
  assert.equal(censorString('job', hashes), '###');
  assert.equal(censorString('job', blocks), '███');
});

test('censorDeep: rewrites display strings and leaves structure / ids alone', () => {
  const matcher = compile(defaults);
  const input = {
    type: 'section',
    user: 'U123JOB',
    ts: '1.job',
    text: 'need a job',
    nested: { fallback: 'employment now', type: 'mrkdwn' },
  };
  const out = censorDeep(input, matcher) as typeof input;
  assert.notEqual(out, input);
  assert.equal(out.type, 'section');
  assert.equal(out.user, 'U123JOB');
  assert.equal(out.ts, '1.job');
  assert.equal(out.text, 'need a ***');
  assert.equal(out.nested.fallback, '********** now');
  assert.equal(out.nested.type, 'mrkdwn');
});

test('censorDeep: returns the original object when nothing matched', () => {
  const matcher = compile(defaults);
  const input = { text: 'hello', blocks: [{ text: 'world' }] };
  assert.equal(censorDeep(input, matcher), input);
});

test('censorMessage: walks text, blocks and attachments, not other keys', () => {
  const matcher = compile(defaults);
  const msg = {
    channel: 'C1',
    ts: '1',
    user: 'U1',
    text: 'job',
    username: 'jobbot',
    blocks: [{ type: 'rich_text', elements: [{ type: 'text', text: 'employment' }] }],
    attachments: [{ pretext: 'job', author_name: 'job person' }],
    files: [{ title: 'job.pdf' }],
  };
  const out = censorMessage(msg, matcher)!;
  assert.notEqual(out, msg);
  assert.equal(out.text, '***');
  assert.equal((out.blocks as typeof msg.blocks)[0].elements[0].text, '**********');
  assert.equal((out.attachments as typeof msg.attachments)[0].pretext, '***');
  assert.equal((out.attachments as typeof msg.attachments)[0].author_name, 'job person');
  assert.equal((out.files as typeof msg.files)[0].title, 'job.pdf');
  assert.equal(out.username, 'jobbot');
});

test('censorMessage: identity is preserved when there is no matcher', () => {
  const matcher = compile({ ...defaults, terms: '' });
  const msg = { text: 'job' };
  assert.equal(censorMessage(msg, matcher), msg);
});
