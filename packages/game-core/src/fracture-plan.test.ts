import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRechopWorthy, planFracture } from './fracture-plan.ts';

describe('planFracture', () => {
  it('too_light is nick-only with zero fragments', () => {
    const p = planFracture({ outcome: 'too_light' });
    assert.equal(p.fragmentCount, 0);
    assert.equal(p.nickOnly, true);
    assert.equal(p.messy, false);
  });

  it('sweet requests a moderate fragment budget', () => {
    const p = planFracture({
      outcome: 'sweet',
      axe: { weight: 0.5, edge: 0.6 },
    });
    assert.ok(p.fragmentCount >= 6 && p.fragmentCount <= 22);
    assert.equal(p.nickOnly, false);
    assert.equal(p.messy, false);
    assert.ok(p.impulse > 0);
    // Feel polish: modest impulse so chips settle instead of exploding
    assert.ok(p.impulse < 2.2);
  });

  it('too_heavy is messier with more fragments and impulse than sweet', () => {
    const axe = { weight: 0.7, edge: 0.85 };
    const sweet = planFracture({ outcome: 'sweet', axe });
    const heavy = planFracture({ outcome: 'too_heavy', axe });
    assert.ok(heavy.fragmentCount >= sweet.fragmentCount);
    assert.ok(heavy.impulse > sweet.impulse);
    assert.equal(heavy.messy, true);
    assert.ok(heavy.impulse < 3.5);
  });

  it('weakDevice caps fragment count', () => {
    const p = planFracture({
      outcome: 'too_heavy',
      weakDevice: true,
      axe: { weight: 1, edge: 1 },
    });
    assert.ok(p.fragmentCount <= 12);
  });

  it('later generations reduce fragment budget', () => {
    const g0 = planFracture({ outcome: 'sweet', generation: 0 });
    const g1 = planFracture({ outcome: 'sweet', generation: 1 });
    assert.ok(g1.fragmentCount <= g0.fragmentCount);
  });
});

describe('isRechopWorthy', () => {
  it('rejects tiny or over-generated pieces', () => {
    assert.equal(isRechopWorthy(0.2, 0), false);
    assert.equal(isRechopWorthy(0.5, 2), false);
    assert.equal(isRechopWorthy(0.5, 0), true);
  });
});
