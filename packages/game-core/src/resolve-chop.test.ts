import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveChop } from './resolve-chop.ts';

const soft = { hardness: 0.32 };
const hard = { hardness: 0.78 };
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
  });
});
