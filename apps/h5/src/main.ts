import './style.css';
import * as THREE from 'three';
import { resolveChop, type Axe, type ChopOutcome, type Species } from '@firewood/game-core';
import { axes, species } from '@firewood/content';
import { createH5Platform } from '@firewood/platform';

const platform = createH5Platform();
platform.storage.setItem('firewood.h5.boot', String(Date.now()));

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const speciesSelect = document.querySelector<HTMLSelectElement>('#species')!;
const axeSelect = document.querySelector<HTMLSelectElement>('#axe')!;
const slider = document.querySelector<HTMLInputElement>('#slider')!;
const sliderValue = document.querySelector<HTMLOutputElement>('#slider-value')!;
const resultEl = document.querySelector<HTMLParagraphElement>('#result')!;
const tipEl = document.querySelector<HTMLParagraphElement>('#tip')!;

for (const s of species) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.name;
  speciesSelect.append(opt);
}

for (const a of axes) {
  const opt = document.createElement('option');
  opt.value = a.id;
  opt.textContent = a.name;
  axeSelect.append(opt);
}

speciesSelect.value = 'toona';
axeSelect.value = 'camp-axe';

const labels: Record<ChopOutcome, string> = {
  too_light: 'too_light · 力道不足',
  sweet: 'sweet · 恰到好处',
  too_heavy: 'too_heavy · 力道过猛',
};

function currentSpecies(): Species {
  return species.find((s) => s.id === speciesSelect.value) ?? species[0]!;
}

function currentAxe(): Axe {
  return axes.find((a) => a.id === axeSelect.value) ?? axes[0]!;
}

function refresh(): void {
  const slider01 = Number(slider.value) / 100;
  sliderValue.textContent = slider01.toFixed(2);
  const sp = currentSpecies();
  const axe = currentAxe();
  const outcome = resolveChop({ slider01, species: sp, axe });
  resultEl.textContent = labels[outcome];
  resultEl.className = `result ${outcome}`;
  tipEl.textContent = `${sp.tip} / ${axe.tip}`;
  log.material.color.set(outcomeColor(outcome));
  platform.audio.play(`chop:${outcome}`, { volume: 0.4 });
}

function outcomeColor(outcome: ChopOutcome): number {
  if (outcome === 'sweet') return 0x8fbf7a;
  if (outcome === 'too_light') return 0xe0c36a;
  return 0xc8785a;
}

/* --- minimal Three.js scene: a log on a stump plane --- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a1410, 6, 14);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
camera.position.set(2.4, 1.8, 3.2);
camera.lookAt(0, 0.4, 0);

const hemi = new THREE.HemisphereLight(0xfff0dd, 0x3a2a1c, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe2c0, 1.2);
key.position.set(3, 5, 2);
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.4, 48),
  new THREE.MeshStandardMaterial({ color: 0x3d2f22, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const log = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.58, 0.9, 28),
  new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 }),
);
log.rotation.z = Math.PI / 2;
log.position.y = 0.55;
scene.add(log);

const rings = new THREE.Mesh(
  new THREE.CircleGeometry(0.54, 28),
  new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 }),
);
rings.position.set(0.46, 0.55, 0);
rings.rotation.y = Math.PI / 2;
scene.add(rings);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

platform.input.attach(canvas);
platform.input.onPointer((sample) => {
  if (sample.phase === 'down') {
    // Nudge log color briefly on tap — platform input smoke test
    log.rotation.y += 0.08;
  }
});

speciesSelect.addEventListener('change', refresh);
axeSelect.addEventListener('change', refresh);
slider.addEventListener('input', refresh);
refresh();

let t = 0;
function frame(): void {
  t += 0.008;
  log.rotation.y = Math.sin(t) * 0.15;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
