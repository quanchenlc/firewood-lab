import './style.css';
import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import {
  getSweetSliderRange,
  planFracture,
  resolveChop,
  type Axe,
  type ChopOutcome,
  type Species,
} from '@firewood/game-core';
import { axes, species } from '@firewood/content';
import { createH5Platform } from '@firewood/platform';
import { preloadContentAssets } from './assets';
import { detectWeakDevice } from './fracture-world';
import { createLogScene, tintLog } from './log-scene';

type Phase = 'aim' | 'power' | 'result';

const platform = createH5Platform();
platform.storage.setItem('firewood.h5.loop', 'rhythm-force-v1');

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const flashEl = document.querySelector<HTMLDivElement>('#flash')!;
const loaderEl = document.querySelector<HTMLDivElement>('#loader')!;
const loaderFill = document.querySelector<HTMLDivElement>('#loader-fill')!;
const loaderLabel = document.querySelector<HTMLParagraphElement>('#loader-label')!;
const phaseHint = document.querySelector<HTMLParagraphElement>('#phase-hint')!;
const speciesSelect = document.querySelector<HTMLSelectElement>('#species')!;
const axeSelect = document.querySelector<HTMLSelectElement>('#axe')!;
const speciesMeta = document.querySelector<HTMLParagraphElement>('#species-meta')!;
const axeMeta = document.querySelector<HTMLParagraphElement>('#axe-meta')!;
const powerPanel = document.querySelector<HTMLDivElement>('#power-panel')!;
const rhythmKnob = document.querySelector<HTMLDivElement>('#rhythm-knob')!;
const sliderValue = document.querySelector<HTMLOutputElement>('#slider-value')!;
const sweetZone = document.querySelector<HTMLDivElement>('#sweet-zone')!;
const forcePreview = document.querySelector<HTMLParagraphElement>('#force-preview')!;
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

const previewLabels: Record<ChopOutcome, string> = {
  too_light: '预计：偏轻',
  sweet: '预计：合适',
  too_heavy: '预计：偏重',
};

const weakDevice = detectWeakDevice();

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

function setLoader(ratio: number, label: string): void {
  loaderFill.style.width = `${Math.round(ratio * 100)}%`;
  loaderLabel.textContent = label;
}

async function boot(): Promise<void> {
const preloaded = await preloadContentAssets(species, axes, setLoader);
const logScene = createLogScene(canvas, preloaded.stump, { weakDevice });
await logScene.setSpecies(currentSpecies());
logScene.setAxeVisual(preloaded.axes.get(axeSelect.value) ?? null);
loaderEl.classList.add('is-done');

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

let phase: Phase = 'aim';
let aimPoint: THREE.Vector3 | null = null;
let aimTarget: DestructibleMesh | null = null;
let aimGeneration = 0;
let lastOutcome: ChopOutcome | null = null;
let speciesBusy = false;
let tabHidden = typeof document !== 'undefined' && document.hidden;
/** Locked force sample used by doChop (set on pointerdown). */
let lockedSlider01 = 0.5;
/** Live rhythm pointer in [0, 1], auto ping-pong while aiming power. */
let rhythm01 = 0.5;
let rhythmPhase = 0;
let chopping = false;

function refreshMeta(): void {
  const sp = currentSpecies();
  const axe = currentAxe();
  const bark = sp.attribution?.barkAsset ? ` · ${sp.attribution.barkAsset}` : '';
  speciesMeta.textContent = `硬度 ${sp.hardness.toFixed(2)}${bark} · ${sp.tip}`;
  axeMeta.textContent = `重量 ${axe.weight.toFixed(2)} · 精度 ${axe.precision.toFixed(2)} · ${axe.tip}`;
  tipEl.textContent =
    phase === 'aim'
      ? '点木头（或剩余大块）瞄准；拖动画布可绕转。'
      : phase === 'power'
        ? '绿带随树种/斧头移动；看准后按下「定格劈下」（按下瞬间取样）。'
        : lastOutcome === 'too_light'
          ? '力道太轻，只留下浅痕。再瞄一次，绿带里定格。'
          : '碎片会落下；可点较大碎块继续劈，或「再来一斧」重置。';
  updateForceUi();
}

function setPhase(next: Phase): void {
  phase = next;
  powerPanel.classList.toggle('is-disabled', next !== 'power');
  powerPanel.setAttribute('aria-disabled', String(next !== 'power'));
  againBtn.classList.toggle('is-hidden', next === 'aim' && logScene.fracture.fragments.length === 0);
  if (next === 'aim') {
    phaseHint.textContent = logScene.fracture.fragments.some((f) => f.splittable)
      ? '点击剩余木块继续劈，或重置'
      : '点击木头瞄准落点';
    if (!lastOutcome) {
      resultEl.textContent = '—';
      resultEl.className = 'result';
    }
  } else if (next === 'power') {
    phaseHint.textContent = '已瞄准 — 指针往返时按下定格';
    // Keep phase continuity; don't hard-reset so re-aim feels fluid
  } else if (lastOutcome === 'sweet') {
    phaseHint.textContent = '顺着劈面打开了！';
  } else if (lastOutcome === 'too_heavy') {
    phaseHint.textContent = '力道过猛，碎块更多但仍向两侧';
  } else {
    phaseHint.textContent = '再调整时机，或重瞄再试';
  }
  refreshMeta();
}

/** Full sine cycles per second — slightly faster for harder wood / duller axe. */
function rhythmHz(): number {
  const sp = currentSpecies();
  const axe = currentAxe();
  return 0.42 + sp.hardness * 0.38 + (1 - axe.sharpness) * 0.28;
}

function updateSweetZone(): void {
  const { lo, hi } = getSweetSliderRange(currentSpecies(), currentAxe());
  const left = lo * 100;
  const width = Math.max(2, (hi - lo) * 100);
  sweetZone.style.left = `${left}%`;
  sweetZone.style.width = `${width}%`;
}

function updateForcePreview(): void {
  if (phase !== 'power') {
    forcePreview.textContent = '预计：—';
    forcePreview.className = 'force-preview is-idle';
    return;
  }
  const outcome = resolveChop({
    slider01: rhythm01,
    species: currentSpecies(),
    axe: currentAxe(),
  });
  forcePreview.textContent = previewLabels[outcome];
  forcePreview.className = `force-preview ${outcome}`;
}

function updateForceUi(): void {
  updateSweetZone();
  updateForcePreview();
  sliderValue.textContent = rhythm01.toFixed(2);
  rhythmKnob.style.left = `${rhythm01 * 100}%`;
}

function tickRhythm(dt: number): void {
  if (phase !== 'power' || chopping) return;
  rhythmPhase += dt * rhythmHz() * Math.PI * 2;
  rhythm01 = 0.5 + 0.5 * Math.sin(rhythmPhase);
  updateForceUi();
}

function buzz(outcome: ChopOutcome): void {
  try {
    if (!navigator.vibrate) return;
    if (outcome === 'too_light') navigator.vibrate(18);
    else if (outcome === 'sweet') navigator.vibrate([12, 40, 18]);
    else navigator.vibrate([30, 20, 40]);
  } catch {
    /* ignore */
  }
}

function flash(outcome: ChopOutcome): void {
  flashEl.className = `flash is-on ${outcome}`;
  const ms = outcome === 'sweet' ? 140 : outcome === 'too_heavy' ? 180 : 100;
  window.setTimeout(() => {
    flashEl.className = 'flash';
  }, ms);
}

function aimAt(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, logScene.camera);
  const hits = raycaster.intersectObjects(logScene.getRaycastTargets(), false);
  const hit = hits[0];
  if (!hit) return false;

  const obj = hit.object as DestructibleMesh;
  aimPoint = hit.point.clone();
  aimTarget = obj;
  const frag = logScene.findFragment(obj);
  aimGeneration = frag?.generation ?? (obj.userData.generation as number) ?? 0;

  const normal =
    hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ??
    new THREE.Vector3(0, 1, 0);
  logScene.placeMarker(hit.point, normal);
  platform.audio.play('aim', { volume: 0.25 });
  setPhase('power');
  return true;
}

function doChop(): void {
  if (phase !== 'power' || !aimPoint || !aimTarget || chopping) return;
  chopping = true;
  lockedSlider01 = rhythm01;
  const sp = currentSpecies();
  const axe = currentAxe();
  const outcome = resolveChop({ slider01: lockedSlider01, species: sp, axe });
  lastOutcome = outcome;
  resultEl.textContent = labels[outcome];
  resultEl.className = `result ${outcome}`;
  tintLog(aimTarget, outcome);
  flash(outcome);
  buzz(outcome);
  logScene.playAxeSwing(aimPoint);
  logScene.punchScale(outcome === 'too_heavy' ? 0.16 : outcome === 'sweet' ? 0.1 : 0.04);
  logScene.setShake(outcome === 'too_heavy' ? 0.2 : outcome === 'too_light' ? 0.05 : 0.12);
  platform.audio.play(`chop:${outcome}`, { volume: 0.55 });
  platform.storage.setItem('firewood.h5.lastOutcome', outcome);

  const plan = planFracture({
    outcome,
    weakDevice,
    axe: { weight: axe.weight, edge: axe.edge },
    generation: aimGeneration,
  });

  if (plan.nickOnly) {
    logScene.playNick(aimPoint);
    logScene.clearMarker();
  } else {
    logScene.fractureAt(aimTarget, aimPoint, plan, aimGeneration);
  }

  aimPoint = null;
  aimTarget = null;
  setPhase('result');
  window.setTimeout(() => {
    chopping = false;
    if (phase === 'result') setPhase('aim');
  }, 700);
}

function resetRound(): void {
  aimPoint = null;
  aimTarget = null;
  aimGeneration = 0;
  lastOutcome = null;
  logScene.resetLog();
  void logScene.setSpecies(currentSpecies());
  setPhase('aim');
}

speciesSelect.addEventListener('change', () => {
  if (speciesBusy) return;
  speciesBusy = true;
  const sp = currentSpecies();
  platform.storage.setItem('firewood.h5.species', sp.id);
  refreshMeta();
  void logScene
    .setSpecies(sp)
    .catch((err) => console.error(err))
    .finally(() => {
      speciesBusy = false;
    });
});

axeSelect.addEventListener('change', () => {
  const axe = currentAxe();
  platform.storage.setItem('firewood.h5.axe', axe.id);
  logScene.setAxeVisual(preloaded.axes.get(axe.id) ?? null);
  refreshMeta();
});

// Sample force on pointerdown (not release) — rhythm timing lock.
chopBtn.addEventListener('pointerdown', (e) => {
  if (phase !== 'power') return;
  e.preventDefault();
  doChop();
});
chopBtn.addEventListener('click', (e) => {
  // Prevent synthetic click after pointerdown from double-firing on some browsers.
  e.preventDefault();
});
resetAimBtn.addEventListener('click', () => {
  aimPoint = null;
  aimTarget = null;
  logScene.clearMarker();
  setPhase('aim');
});
againBtn.addEventListener('click', () => resetRound());

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
    if (dragging) logScene.setOrbit(orbitYaw - dx * 0.005, orbitPitch + dy * 0.004);
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
let prev = performance.now();
document.addEventListener('visibilitychange', () => {
  tabHidden = document.hidden;
  if (!tabHidden) prev = performance.now();
});
updateForceUi();
setPhase('aim');
refreshMeta();

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (tabHidden) {
    prev = now;
    return;
  }
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  tickRhythm(dt);
  logScene.update(dt);
  logScene.renderer.render(logScene.scene, logScene.camera);
}
requestAnimationFrame(frame);
}

function currentSpecies(): Species {
  return species.find((s) => s.id === speciesSelect.value) ?? species[0]!;
}

function currentAxe(): Axe {
  return axes.find((a) => a.id === axeSelect.value) ?? axes[0]!;
}

void boot().catch((err) => {
  console.error(err);
  loaderLabel.textContent = `加载失败：${err instanceof Error ? err.message : String(err)}`;
});
