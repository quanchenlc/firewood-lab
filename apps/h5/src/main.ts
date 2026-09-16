import './style.css';
import * as THREE from 'three';
import { resolveChop, type Axe, type ChopOutcome, type Species } from '@firewood/game-core';
import { axes, species } from '@firewood/content';
import { createH5Platform } from '@firewood/platform';
import { createLogScene, tintLog } from './log-scene';

type Phase = 'aim' | 'power' | 'result';

const platform = createH5Platform();
platform.storage.setItem('firewood.h5.loop', 'aim-power-v1');

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const flashEl = document.querySelector<HTMLDivElement>('#flash')!;
const phaseHint = document.querySelector<HTMLParagraphElement>('#phase-hint')!;
const speciesSelect = document.querySelector<HTMLSelectElement>('#species')!;
const axeSelect = document.querySelector<HTMLSelectElement>('#axe')!;
const speciesMeta = document.querySelector<HTMLParagraphElement>('#species-meta')!;
const axeMeta = document.querySelector<HTMLParagraphElement>('#axe-meta')!;
const powerPanel = document.querySelector<HTMLDivElement>('#power-panel')!;
const slider = document.querySelector<HTMLInputElement>('#slider')!;
const sliderValue = document.querySelector<HTMLOutputElement>('#slider-value')!;
const chopBtn = document.querySelector<HTMLButtonElement>('#chop-btn')!;
const resetAimBtn = document.querySelector<HTMLButtonElement>('#reset-aim-btn')!;
const againBtn = document.querySelector<HTMLButtonElement>('#again-btn')!;
const resultEl = document.querySelector<HTMLParagraphElement>('#result')!;
const tipEl = document.querySelector<HTMLParagraphElement>('#tip')!;

const labels: Record<ChopOutcome, string> = {
  too_light: 'too_light · 力道不足',
  sweet: 'sweet · 恰到好处',
  too_heavy: 'too_heavy · 力道过猛',
};

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

const logScene = createLogScene(canvas);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

let phase: Phase = 'aim';
let aimPoint: THREE.Vector3 | null = null;
let lastOutcome: ChopOutcome | null = null;

function currentSpecies(): Species {
  return species.find((s) => s.id === speciesSelect.value) ?? species[0]!;
}

function currentAxe(): Axe {
  return axes.find((a) => a.id === axeSelect.value) ?? axes[0]!;
}

function refreshMeta(): void {
  const sp = currentSpecies();
  const axe = currentAxe();
  speciesMeta.textContent = `硬度 ${sp.hardness.toFixed(2)} · ${sp.tip}`;
  axeMeta.textContent = `重量 ${axe.weight.toFixed(2)} · 精度 ${axe.precision.toFixed(2)} · ${axe.tip}`;
  tipEl.textContent =
    phase === 'aim'
      ? '点木头瞄准落点；拖动画布可轻微绕转。'
      : phase === 'power'
        ? '调好力道后点「劈下去」（按住再松手也可）。'
        : lastOutcome
          ? `${labels[lastOutcome]} — ${sp.tip}`
          : tipEl.textContent;
}

function setPhase(next: Phase): void {
  phase = next;
  powerPanel.classList.toggle('is-disabled', next !== 'power');
  powerPanel.setAttribute('aria-disabled', String(next !== 'power'));
  againBtn.classList.toggle('is-hidden', next !== 'result');
  if (next === 'aim') {
    phaseHint.textContent = '点击木头瞄准落点';
    resultEl.textContent = '—';
    resultEl.className = 'result';
  } else if (next === 'power') {
    phaseHint.textContent = '已瞄准 — 调节力道后劈下';
  } else {
    phaseHint.textContent = lastOutcome === 'sweet' ? '劈开了！再来一斧？' : '再调整力道，或重瞄再试';
  }
  refreshMeta();
}

function slider01(): number {
  return Number(slider.value) / 100;
}

function updateSliderLabel(): void {
  sliderValue.textContent = slider01().toFixed(2);
}

function flash(outcome: ChopOutcome): void {
  flashEl.className = `flash is-on ${outcome}`;
  window.setTimeout(() => {
    flashEl.className = 'flash';
  }, 120);
}

function aimAt(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, logScene.camera);
  const hits = raycaster.intersectObjects(logScene.raycastables, false);
  const hit = hits[0];
  if (!hit) return false;
  aimPoint = hit.point.clone();
  logScene.placeMarker(hit.point, hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0));
  platform.audio.play('aim', { volume: 0.25 });
  setPhase('power');
  return true;
}

function doChop(): void {
  if (phase !== 'power' || !aimPoint) return;
  const sp = currentSpecies();
  const axe = currentAxe();
  const outcome = resolveChop({ slider01: slider01(), species: sp, axe });
  lastOutcome = outcome;
  resultEl.textContent = labels[outcome];
  resultEl.className = `result ${outcome}`;
  tintLog(logScene.logMesh, outcome);
  flash(outcome);
  logScene.punchScale(outcome === 'too_heavy' ? 0.18 : 0.1);
  logScene.setShake(outcome === 'too_heavy' ? 0.22 : outcome === 'too_light' ? 0.06 : 0.12);
  platform.audio.play(`chop:${outcome}`, { volume: 0.55 });
  platform.storage.setItem('firewood.h5.lastOutcome', outcome);

  if (outcome === 'sweet') {
    logScene.playSplit(aimPoint);
  }
  setPhase('result');
}

function resetRound(keepOrbit = true): void {
  void keepOrbit;
  aimPoint = null;
  lastOutcome = null;
  logScene.resetLog();
  setPhase('aim');
}

speciesSelect.addEventListener('change', () => {
  refreshMeta();
  platform.storage.setItem('firewood.h5.species', speciesSelect.value);
});
axeSelect.addEventListener('change', () => {
  refreshMeta();
  platform.storage.setItem('firewood.h5.axe', axeSelect.value);
});
slider.addEventListener('input', updateSliderLabel);

chopBtn.addEventListener('click', () => doChop());
/** Also support release-to-chop after a short press-hold on the button. */
let chopPressedAt = 0;
chopBtn.addEventListener('pointerdown', () => {
  if (phase === 'power') chopPressedAt = performance.now();
});
chopBtn.addEventListener('pointerup', () => {
  if (phase !== 'power' || !chopPressedAt) return;
  const held = performance.now() - chopPressedAt;
  chopPressedAt = 0;
  // Short tap is handled by click; long press (≥180ms) chops on release.
  if (held >= 180) doChop();
});
chopBtn.addEventListener('pointercancel', () => {
  chopPressedAt = 0;
});
resetAimBtn.addEventListener('click', () => {
  aimPoint = null;
  logScene.clearMarker();
  setPhase('aim');
});
againBtn.addEventListener('click', () => resetRound());

/* --- pointer: tap to aim, drag to orbit --- */
const DRAG_PX = 10;
let pointerId: number | null = null;
let downX = 0;
let downY = 0;
let dragging = false;
let orbitYaw = logScene.getOrbit().yaw;
let orbitPitch = logScene.getOrbit().pitch;

platform.input.attach(canvas);
platform.input.onPointer((sample) => {
  if (sample.phase === 'down') {
    pointerId = sample.pointerId;
    downX = sample.x;
    downY = sample.y;
    dragging = false;
    const o = logScene.getOrbit();
    orbitYaw = o.yaw;
    orbitPitch = o.pitch;
    return;
  }

  if (pointerId !== sample.pointerId) return;

  if (sample.phase === 'move') {
    const dx = sample.x - downX;
    const dy = sample.y - downY;
    if (!dragging && Math.hypot(dx, dy) > DRAG_PX) dragging = true;
    if (dragging && phase !== 'result') {
      logScene.setOrbit(orbitYaw - dx * 0.005, orbitPitch + dy * 0.004);
    }
    return;
  }

  if (sample.phase === 'up' || sample.phase === 'cancel') {
    if (!dragging && sample.phase === 'up' && (phase === 'aim' || phase === 'power')) {
      const rect = canvas.getBoundingClientRect();
      aimAt(rect.left + sample.x, rect.top + sample.y);
    }
    pointerId = null;
    dragging = false;
  }
});

window.addEventListener('resize', () => logScene.resize());

updateSliderLabel();
setPhase('aim');
refreshMeta();

let prev = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  logScene.update(dt);
  logScene.renderer.render(logScene.scene, logScene.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
