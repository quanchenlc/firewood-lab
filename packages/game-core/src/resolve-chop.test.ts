import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getSweetSliderRange,
  resolveChop,
  sweetHalfWindow,
} from './resolve-chop.ts';

const soft = { hardness: 0.32 };
const hard = { hardness: 0.78 };
const toona = { hardness: 0.42 };
const camp = { weight: 0.5, sharpness: 0.7, precision: 0.65 };
const maul = { weight: 0.95, sharpness: 0.4, precision: 0.4 };

describe('resolveChop', () => {
  it('returns too_light for near-zero slider', () => {
    assert.equal(resolveChop({ slider01: 0, species: soft, axe: camp }), 'too_light');
    assert.equal(resolveChop({ slider01: 0.05, species: soft, axe: camp }), 'too_light');
  });

  it('returns sweet near softwood mid force with camp axe', () => {
    assert.equal(resolveChop({ slider01: 0.4, species: soft, axe: camp }), 'sweet');
  });

  it('returns too_heavy for max slider on softwood', () => {
    assert.equal(resolveChop({ slider01: 1, species: soft, axe: camp }), 'too_heavy');
  });

  it('needs more force for hardwood', () => {
    assert.equal(resolveChop({ slider01: 0.45, species: hard, axe: camp }), 'too_light');
    assert.equal(resolveChop({ slider01: 0.95, species: hard, axe: maul }), 'sweet');
  });

  it('Camp + Toona: mid slider is teachable sweet (feel polish)', () => {
    assert.equal(resolveChop({ slider01: 0.5, species: toona, axe: camp }), 'sweet');
    assert.equal(resolveChop({ slider01: 0.25, species: toona, axe: camp }), 'too_light');
    assert.equal(resolveChop({ slider01: 0.85, species: toona, axe: camp }), 'too_heavy');
  });

  it('clamps NaN slider to too_light band start', () => {
    assert.equal(resolveChop({ slider01: Number.NaN, species: soft, axe: camp }), 'too_light');
  });

  it('wider precision enlarges sweet window', () => {
    const precise = { weight: 0.5, sharpness: 0.7, precision: 1 };
    const blunt = { weight: 0.5, sharpness: 0.7, precision: 0 };
    const mid = resolveChop({ slider01: 0.38, species: soft, axe: precise });
    const midBlunt = resolveChop({ slider01: 0.38, species: soft, axe: blunt });
    assert.equal(mid, 'sweet');
    assert.ok(midBlunt === 'too_light' || midBlunt === 'sweet');
    assert.ok(sweetHalfWindow(precise) > sweetHalfWindow(blunt));
  });
});

describe('getSweetSliderRange', () => {
  it('marks a non-empty Camp+Toona sweet band covering 0.5', () => {
    const { lo, hi } = getSweetSliderRange(toona, camp);
    assert.ok(hi > lo);
    assert.ok(lo <= 0.5 && 0.5 <= hi);
    assert.ok(lo >= 0.25 && hi <= 0.85);
  });

  it('matches resolveChop at band edges', () => {
    const { lo, hi } = getSweetSliderRange(toona, camp);
    assert.equal(resolveChop({ slider01: lo + 0.01, species: toona, axe: camp }), 'sweet');
    assert.equal(resolveChop({ slider01: hi - 0.01, species: toona, axe: camp }), 'sweet');
    if (lo > 0.02) {
      assert.equal(resolveChop({ slider01: lo - 0.02, species: toona, axe: camp }), 'too_light');
    }
    if (hi < 0.98) {
      assert.equal(resolveChop({ slider01: hi + 0.02, species: toona, axe: camp }), 'too_heavy');
    }
  });
});
