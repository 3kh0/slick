// Join / leave / media scenarios, including token fallback, the failure notice and participants.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHuddleCall } from '../huddleCall.ts';
import type { MediaCallbacks, MediaSession, MediaSessionOptions } from '../media/mediaSession.ts';
import { ShaderCompileError } from '../media/shaderSource.ts';
import { DEFAULT_PREFERENCES, type CallPreferences } from '../preferences.ts';
import { SlackApiError, type TeamCredential } from '../slackApi.ts';

const TEAM: TeamCredential = { id: 'T1', token: 'xoxc-T1', url: 'https://t1.slack.com/', userId: 'U_ME' };
const JOINED = {
  call: { call_id: 'R123', free_willy: { meeting: { MeetingId: 'm' }, attendee: { AttendeeId: 'a1' } } },
};

interface FakeMedia extends MediaSession {
  inputs: string[];
  outputs: string[];
  muted: boolean[];
  camera: boolean[];
  shaders: (string | null)[];
  stopped: number;
}

function setup({
  joinResult = JSON.parse(JSON.stringify(JOINED)) as unknown,
  joinError,
  mediaError,
  cameraError,
  leaveError,
  shaderError,
}: {
  joinResult?: unknown;
  joinError?: Error;
  mediaError?: Error;
  cameraError?: Error;
  leaveError?: Error;
  shaderError?: Error;
} = {}) {
  const saved: CallPreferences[] = [];
  const posts: { team: string; method: string; params: Record<string, unknown>; keepalive?: boolean }[] = [];
  const medias: FakeMedia[] = [];
  let callbacks: MediaCallbacks | undefined;
  let mediaOptions: MediaSessionOptions | undefined;
  let releaseMedia: (() => void) | undefined;
  const holdMedia = { enabled: false };

  const call = createHuddleCall({
    preferences: { ...DEFAULT_PREFERENCES, shaderSource: 'void mainImage(out vec4 c, in vec2 p) {}' },
    savePreferences: (preferences) => void saved.push(preferences),
    teams: () => [TEAM],
    timeZone: () => 'Europe/London',
    join: (async (_teams: TeamCredential[], method: string, params: Record<string, unknown>) => {
      posts.push({ team: TEAM.id, method, params });
      if (joinError) throw joinError;
      return { result: joinResult, team: TEAM };
    }) as never,
    post: (async (
      team: TeamCredential,
      method: string,
      params: Record<string, unknown>,
      options?: { keepalive?: boolean },
    ) => {
      posts.push({ team: team.id, method, params, keepalive: options?.keepalive });
      if (leaveError) throw leaveError;
      return { ok: true };
    }) as never,
    createMedia: async (options) => {
      mediaOptions = options;
      callbacks = options.callbacks;
      if (mediaError) throw mediaError;
      if (holdMedia.enabled) await new Promise<void>((resolve) => (releaseMedia = resolve));
      const media: FakeMedia = {
        inputs: [],
        outputs: [],
        muted: [],
        camera: [],
        shaders: [],
        stopped: 0,
        setMuted: (muted) => void media.muted.push(muted),
        setAudioInput: async (id) => void media.inputs.push(id),
        setAudioOutput: async (id) => void media.outputs.push(id),
        setCamera: async (enabled) => {
          if (cameraError) throw cameraError;
          media.camera.push(enabled);
        },
        setShader: async (source) => {
          if (shaderError) throw shaderError;
          media.shaders.push(source);
        },
        setScreenShare: async () => {},
        bindTile: () => {},
        unbindTile: () => {},
        setVideoDisplayHeight: () => {},
        stop: async () => void media.stopped++,
      };
      medias.push(media);
      return media;
    },
  });
  return {
    call,
    posts,
    medias,
    holdMedia,
    saved,
    release: () => releaseMedia?.(),
    callbacks: () => callbacks!,
    mediaOptions: () => mediaOptions!,
  };
}

describe('huddleCall join', () => {
  it('joins via rooms.join and connects Chime with the returned credentials as you', async () => {
    const { call, posts, mediaOptions } = setup();
    await call.join('C1');
    assert.deepEqual(posts[0], {
      team: 'T1',
      method: 'rooms.join',
      params: { channel_id: 'C1', regions: 'us-east-2' },
    });
    assert.deepEqual(mediaOptions().credentials, JOINED.call.free_willy);
    assert.equal(mediaOptions().localUserId, 'U_ME');
    const state = call.state.get();
    assert.equal(state.status, 'connected');
    assert.equal(state.roomId, 'R123');
    assert.equal(state.localUserId, 'U_ME');
  });

  it('starts muted when Slack asked for a muted join', async () => {
    const { call, medias, mediaOptions } = setup();
    await call.join('C1', { muted: true });
    // Muted before audio starts, not just after it connects.
    assert.equal(mediaOptions().startMuted, true);
    assert.deepEqual(medias[0].muted, [true]);
    assert.equal(call.state.get().muted, true);
  });

  it('rejoining the huddle you are in is a no-op', async () => {
    const { call, posts } = setup();
    await call.join('C1');
    await call.join('C1');
    assert.equal(posts.filter((post) => post.method === 'rooms.join').length, 1);
  });

  it('switching huddles leaves the first one', async () => {
    const { call, posts, medias } = setup();
    await call.join('C1');
    await call.join('C2');
    assert.equal(medias[0].stopped, 1);
    assert.deepEqual(
      posts.map((post) => post.method),
      ['rooms.join', 'rooms.leave', 'rooms.join'],
    );
    assert.equal(call.state.get().channelId, 'C2');
  });

  it('shows why joining failed when Slack refuses', async () => {
    const { call } = setup({ joinError: new SlackApiError('rooms.join', 'not_in_channel') });
    await call.join('C1');
    const state = call.state.get();
    assert.equal(state.status, 'failed');
    assert.match(state.message, /not_in_channel/);
    call.dismiss();
    assert.equal(call.state.get().status, 'idle');
  });

  it('explains a missing free_willy blob (no attendee was handed out, so there is nothing to rooms.leave)', async () => {
    const { call, posts } = setup({ joinResult: { call: { call_id: 'R9' } } });
    await call.join('C1');
    assert.match(call.state.get().message, /free_willy/);
    assert.deepEqual(
      posts.map((sent) => sent.method),
      ['rooms.join'],
    );
  });

  it("leaves with Slack's own rooms.leave arguments when audio fails after rooms.join", async () => {
    const { call, posts } = setup({ mediaError: new Error('global is not defined') });
    await call.join('C1');
    assert.deepEqual(posts.at(-1), {
      team: 'T1',
      method: 'rooms.leave',
      params: { channel_id: 'C1', call_id: 'R123', attendee_id: 'a1', reason: 'user_initiated' },
      keepalive: false,
    });
  });

  it('leaves the Slack room again if audio fails to connect', async () => {
    const { call, posts } = setup({ mediaError: new Error('Microphone access was blocked.') });
    await call.join('C1');
    assert.match(call.state.get().message, /Microphone access was blocked/);
    assert.equal(posts.at(-1)?.method, 'rooms.leave');
  });

  it('hanging up while audio connects stops the session and leaves the room', async () => {
    const harness = setup();
    harness.holdMedia.enabled = true;
    const joining = harness.call.join('C1');
    await new Promise((resolve) => setImmediate(resolve));
    await harness.call.leave();
    harness.release();
    await joining;
    assert.equal(harness.medias[0].stopped, 1);
    assert.equal(harness.call.state.get().status, 'idle');
    assert.equal(harness.posts.at(-1)?.method, 'rooms.leave');
  });
});

describe('huddleCall in a call', () => {
  it('switches microphone and speaker independently, preserves mute, and remembers both for the next call', async () => {
    const { call, medias, mediaOptions } = setup();
    await call.join('C1', { muted: true });
    await call.selectAudioInput('macbook');
    await call.selectAudioOutput('earbuds');
    assert.deepEqual(medias[0].inputs, ['macbook']);
    assert.deepEqual(medias[0].outputs, ['earbuds']);
    assert.equal(call.state.get().muted, true);
    await call.leave();
    await call.join('C1', { muted: true });
    assert.equal(mediaOptions().audioInputId, 'macbook');
    assert.equal(mediaOptions().audioOutputId, 'earbuds');
  });

  it('does not save a device selection that failed', async () => {
    const { call, medias } = setup();
    await call.join('C1');
    medias[0].setAudioInput = async () => {
      throw new Error('device vanished');
    };
    await assert.rejects(call.selectAudioInput('missing'), /device vanished/);
    assert.equal(call.preferences.get().audioInputId, undefined);
  });
  it('leaves: stops audio, tells Slack with the same token, and can keep the request alive through unload', async () => {
    const { call, posts, medias } = setup();
    await call.join('C1');
    await call.leave({ keepalive: true });
    assert.equal(medias[0].stopped, 1);
    assert.deepEqual(posts.at(-1), {
      team: 'T1',
      method: 'rooms.leave',
      params: { channel_id: 'C1', call_id: 'R123', attendee_id: 'a1', reason: 'unload' },
      keepalive: true,
    });
    assert.equal(call.state.get().status, 'idle');
  });

  it('a rooms.leave failure is only logged (audio is already disconnected)', async () => {
    const { call } = setup({ leaveError: new Error('room_not_found') });
    await call.join('C1');
    const warn = console.warn;
    console.warn = () => {};
    try {
      await call.leave();
    } finally {
      console.warn = warn;
    }
    assert.equal(call.state.get().status, 'idle');
  });

  it('toggles mute on the media session', async () => {
    const { call, medias } = setup();
    await call.join('C1');
    call.toggleMute();
    call.toggleMute();
    assert.deepEqual(medias[0].muted, [true, false]);
    assert.equal(call.state.get().muted, false);
  });

  it('records speakers, muted people, participants and tiles from the media session', async () => {
    const harness = setup();
    await harness.call.join('C1');
    const callbacks = harness.callbacks();
    callbacks.onSpeaking(new Set(['U2']));
    callbacks.onMutedChanged(new Set(['U3']));
    callbacks.onParticipantsChanged(['U_ME', 'U2', 'U3']);
    callbacks.onTilesChanged([{ tileId: 1, userId: 'U2', isLocal: false, isContent: false }]);
    const state = harness.call.state.get();
    assert.deepEqual([...state.speaking], ['U2']);
    assert.deepEqual([...state.mutedUsers], ['U3']);
    assert.deepEqual(state.participants, ['U_ME', 'U2', 'U3']);
    assert.equal(state.tiles.length, 1);
  });

  it('shows why the call ended when Chime drops it', async () => {
    const harness = setup();
    await harness.call.join('C1');
    harness.callbacks().onEnded('The huddle ended.');
    assert.deepEqual(
      [harness.call.state.get().status, harness.call.state.get().message],
      ['failed', 'The huddle ended.'],
    );
  });

  it('turns the camera on and off, and keeps it off when it fails to start', async () => {
    const { call, medias } = setup();
    await call.join('C1');
    await call.toggleCamera();
    await call.toggleCamera();
    assert.deepEqual(medias[0].camera, [true, false]);

    const failing = setup({ cameraError: new Error('Camera access was blocked.') });
    await failing.call.join('C1');
    await assert.rejects(failing.call.toggleCamera(), /Camera access was blocked/);
    assert.equal(failing.call.state.get().cameraOn, false);
  });

  it("ignores controls when you're not in a huddle", async () => {
    const { call, medias } = setup();
    call.toggleMute();
    await call.toggleCamera();
    assert.equal(medias.length, 0);
    assert.equal(call.state.get().status, 'idle');
  });
});

describe('huddle call log', () => {
  it('records the join steps and the failure with its stack', async () => {
    const { call } = setup({ mediaError: new TypeError('qv.default is not a constructor') });
    await call.join('C1');
    const text = call.log.format();
    assert.match(text, /joining the huddle in C1/);
    assert.match(text, /rooms\.join ok with team T1: room R123/);
    assert.match(text, /ERROR join failed: TypeError: qv\.default is not a constructor\n\s+at /);
    assert.match(text, /rooms\.leave sent for R123/);
  });

  it("never shows the attendee's join token", async () => {
    const joinResult = JSON.parse(JSON.stringify(JOINED));
    joinResult.call.free_willy.attendee.JoinToken = 'JOINTOKEN-SECRET-123';
    const { call } = setup({ joinResult, mediaError: new Error('failed with JOINTOKEN-SECRET-123 in it') });
    await call.join('C1');
    assert.ok(!call.log.format().includes('JOINTOKEN-SECRET-123'));
    assert.match(call.log.format(), /Chime meeting m/);
  });

  it('starts a fresh log for each join attempt', async () => {
    const { call } = setup({ joinError: new Error('first') });
    await call.join('C1');
    await call.join('C2');
    assert.doesNotMatch(call.log.format(), /in C1/);
    assert.match(call.log.format(), /in C2/);
  });
});

describe('huddleCall video effect', () => {
  it('sends your saved shader, even with the camera off, and stops it again', async () => {
    const { call, medias } = setup();
    await call.join('C1');
    await call.toggleShader();
    assert.equal(call.state.get().shaderOn, true);
    assert.equal(call.state.get().cameraOn, false);
    await call.toggleShader();
    assert.deepEqual(medias[0].shaders, ['void mainImage(out vec4 c, in vec2 p) {}', null]);
    assert.equal(call.state.get().shaderOn, false);
  });

  it("keeps the effect off when the shader doesn't compile", async () => {
    const { call } = setup({ shaderError: new ShaderCompileError(["Error (line 1): 'x' : undeclared identifier"]) });
    await call.join('C1');
    await assert.rejects(call.toggleShader(), /didn't compile: Error \(line 1\)/);
    assert.equal(call.state.get().shaderOn, false);
  });

  it('new shader code is saved, and sent straight away only while the effect is on', async () => {
    const { call, medias, saved } = setup();
    await call.join('C1');
    await call.setShaderSource('first');
    assert.deepEqual(medias[0].shaders, []);
    await call.toggleShader();
    await call.setShaderSource('second');
    assert.deepEqual(medias[0].shaders, ['first', 'second']);
    assert.deepEqual(
      saved.map((preferences) => preferences.shaderSource),
      ['first', 'second'],
    );
  });

  it('the effect is off again in the next call', async () => {
    const { call } = setup();
    await call.join('C1');
    await call.toggleShader();
    await call.leave();
    await call.join('C2');
    assert.equal(call.state.get().shaderOn, false);
  });
});
