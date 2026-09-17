/**
 * Unit tests for debug-stage chop interaction flags.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEBUG_DIRECT_CHOP, forceBarEnabled } from './debug-flags.ts';

describe('debug-flags', () => {
  it('DEBUG_DIRECT_CHOP is on for this debug pass', () => {
    assert.equal(DEBUG_DIRECT_CHOP, true);
  });

  it('forceBarEnabled is false while DEBUG_DIRECT_CHOP is on', () => {
    assert.equal(forceBarEnabled, !DEBUG_DIRECT_CHOP);
    assert.equal(forceBarEnabled, false);
  });
});
