/**
 * Unit tests for mobile-friendly sun-shadow tuning.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  enableSunShadows,
  setShadowFlags,
  shadowTuneForDevice,
} from './shadows.ts';

describe('shadowTuneForDevice', () => {
  it('weak device uses small BasicShadowMap for FPS', () => {
    const t = shadowTuneForDevice(true);
    assert.equal(t.mapSize, 512);
    assert.equal(t.type, THREE.BasicShadowMap);
    assert.ok(t.camSize >= 3 && t.camSize <= 5);
    assert.ok(t.camFar > t.camNear);
    assert.ok(t.normalBias > 0);
  });

  it('desktop uses soft 1024 map', () => {
    const t = shadowTuneForDevice(false);
    assert.equal(t.mapSize, 1024);
    assert.equal(t.type, THREE.PCFSoftShadowMap);
    assert.ok(t.radius >= 1.5);
    assert.ok(t.camSize >= t.camSize); // sanity
    assert.ok(t.camSize >= 3.5 && t.camSize <= 5);
  });

  it('weak map is never larger than desktop', () => {
    assert.ok(shadowTuneForDevice(true).mapSize <= shadowTuneForDevice(false).mapSize);
  });
});

describe('enableSunShadows', () => {
  it('turns on shadowMap and key.castShadow (no WebGL required)', () => {
    const renderer = {
      shadowMap: { enabled: false, type: 0 as THREE.ShadowMapType },
    } as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(3.6, 6.8, 2.6);
    scene.add(key);

    const tune = enableSunShadows(renderer, scene, key, { weakDevice: true });

    assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(renderer.shadowMap.type, THREE.BasicShadowMap);
    assert.equal(key.castShadow, true);
    assert.equal(key.shadow.mapSize.x, tune.mapSize);
    assert.equal(key.shadow.mapSize.y, tune.mapSize);
    assert.equal(key.shadow.bias, tune.bias);
    assert.equal(key.shadow.normalBias, tune.normalBias);
    assert.ok(key.target.parent === scene);
    assert.ok(Math.abs(key.target.position.y - 0.22) < 1e-9);
    assert.equal(key.shadow.camera.left, -tune.camSize);
    assert.equal(key.shadow.camera.right, tune.camSize);
  });

  it('desktop path uses PCF soft type', () => {
    const renderer = {
      shadowMap: { enabled: false, type: 0 as THREE.ShadowMapType },
    } as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight();
    scene.add(key);
    enableSunShadows(renderer, scene, key, { weakDevice: false });
    assert.equal(renderer.shadowMap.type, THREE.PCFSoftShadowMap);
    assert.equal(key.shadow.mapSize.x, 1024);
  });
});

describe('setShadowFlags', () => {
  it('marks mesh + children cast/receive', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    root.add(a);
    a.add(b);
    assert.equal(a.castShadow, false);
    setShadowFlags(root, { cast: true, receive: true });
    assert.equal(a.castShadow, true);
    assert.equal(a.receiveShadow, true);
    assert.equal(b.castShadow, true);
    assert.equal(b.receiveShadow, true);
  });

  it('can cast-only (ground receive stays separate)', () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    setShadowFlags(m, { cast: true, receive: false });
    assert.equal(m.castShadow, true);
    assert.equal(m.receiveShadow, false);
  });
});
