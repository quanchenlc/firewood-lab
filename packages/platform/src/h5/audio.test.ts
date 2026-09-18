/**
 * Unit tests for audio helpers (no Web Audio / DOM required).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chopPlaybackJitter, pickRandomNoRepeat } from './audio.ts';

describe('pickRandomNoRepeat', () => {
  it('returns 0 for empty or single pool', () => {
    assert.equal(pickRandomNoRepeat(0, -1), 0);
    assert.equal(pickRandomNoRepeat(1, 0), 0);
  });

  it('avoids the last index across many draws', () => {
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const next = pickRandomNoRepeat(4, last);
      assert.notEqual(next, last);
      assert.ok(next >= 0 && next < 4);
      last = next;
    }
  });
});

describe('chopPlaybackJitter', () => {
  it('keeps sweet in a mid volume band with mild pitch drift', () => {
    for (let i = 0; i < 20; i++) {
      const j = chopPlaybackJitter('sweet');
      assert.ok(j.volume >= 0.6 && j.volume <= 0.85);
      assert.ok(j.playbackRate >= 0.9 && j.playbackRate <= 1.12);
    }
  });

  it('makes too_light quieter and slightly brighter', () => {
    const j = chopPlaybackJitter('too_light');
    assert.ok(j.volume < 0.55);
    assert.ok(j.playbackRate >= 0.95);
  });

  it('makes too_heavy louder / a bit darker', () => {
    const j = chopPlaybackJitter('too_heavy');
    assert.ok(j.volume >= 0.75);
    assert.ok(j.playbackRate <= 1.05);
  });
});
