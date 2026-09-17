import './style.css';
import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import {
  cleaveNormalXZ,
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
platform.storage.setItem('firewood.h5.loop', 'rhythm-click-v2');

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const flashEl = document.querySelector<HTMLDivElement>('#flash')!;
const loaderEl = document.querySelector<HTMLDivElement>('#loader')!;
const loaderFill = document.querySelector<HTMLDivElement>('#loader-fill')!;
const loaderLabel = document.querySelector<HTMLParagraphElement>('#loader-label')!;
const phaseHint = document.querySelector<HTMLParagraphElement>('#phase-hint')!;
const speciesSelect = document.querySelector<HTMLSelectElement>('#species')!;
const axeSelect = document.querySelector<HTMLSelectElement>('#axe')!;
const speciesChip = document.querySelector<HTMLDivElement>('#species-chip')!;
const axeChip = document.querySelector<HTMLDivElement>('#axe-chip')!;
const speciesChipBtn = document.querySelector<HTMLButtonElement>('#species-chip-btn')!;
const axeChipBtn = document.querySelector<HTMLButtonElement>('#axe-chip-btn')!;
const speciesPanel = document.querySelector<HTMLDivElement>('#species-panel')!;
const axePanel = document.querySelector<HTMLDivElement>('#axe-panel')!;
const speciesChipLabel = document.querySelector<HTMLSpanElement>('#species-chip-label')!;
const axeChipLabel = document.querySelector<HTMLSpanElement>('#axe-chip-label')!;
const powerPanel = document.querySelector<HTMLDivElement>('#power-panel')!;
const rhythmKnob = document.querySelector<HTMLDivElement>('#rhythm-knob')!;
const sweetZone = document.querySelector<HTMLDivElement>('#sweet-zone')!;
const forcePreview = document.querySelector<HTMLParagraphElement>('#force-preview')!;
const againBtn = document.querySelector<HTMLButtonElement>('#again-btn')!;
const resultEl = document.querySelector<HTMLParagraphElement>('#result')!;

const labels: Record<ChopOutcome, string> = {
  too_light: '力道不足 · 回弹',
  sweet: '恰到好处',
  too_heavy: '力道过猛',
};

const previewLabels: Record<ChopOutcome, string> = {
  too_light: '偏轻',
  sweet: '合适',
  too_heavy: '偏重',
};

const weakDevice = detectWeakDevice();
/** Axe impact delay — fracture / nick fires when the blade arrives. */
const IMPACT_DELAY_MS = 200;

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

function setChipOpen(chip: HTMLElement, panel: HTMLElement, btn: HTMLButtonElement, open: boolean): void {
  chip.dataset.open = open ? 'true' : 'false';
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

function closeChips(): void {
  setChipOpen(speciesChip, speciesPanel, speciesChipBtn, false);
  setChipOpen(axeChip, axePanel, axeChipBtn, false);
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
  /** After first contact, subsequent taps reuse this vertical cleave direction. */
  let lockedCleaveNormal: THREE.Vector3 | null = null;
  let lastOutcome: ChopOutcome | null = null;
  let speciesBusy = false;
  let tabHidden = typeof document !== 'undefined' && document.hidden;
  let lockedSlider01 = 0.5;
  let rhythm01 = 0.5;
  let rhythmPhase = 0;
  let chopping = false;
  let impactTimer: number | null = null;
  let phaseTimer: number | null = null;
  let resultFadeTimer: number | null = null;
  let hudLean = false;

  function clearChopTimers(): void {
    if (impactTimer !== null) {
      window.clearTimeout(impactTimer);
      impactTimer = null;
    }
    if (phaseTimer !== null) {
      window.clearTimeout(phaseTimer);
      phaseTimer = null;
    }
    if (resultFadeTimer !== null) {
      window.clearTimeout(resultFadeTimer);
      resultFadeTimer = null;
    }
  }

  function refreshChipLabels(): void {
    speciesChipLabel.textContent = currentSpecies().name;
    axeChipLabel.textContent = currentAxe().name;
  }

  function setPhase(next: Phase): void {
    phase = next;
    const showPower = next === 'power';
    powerPanel.classList.toggle('is-hidden', !showPower);
    powerPanel.setAttribute('aria-hidden', String(!showPower));
    againBtn.classList.toggle(
      'is-hidden',
      next === 'aim' && logScene.fracture.fragments.length === 0 && !lastOutcome,
    );

    // After the first chop cycle, fade instructional chrome (screen.toys lean HUD).
    if (hudLean) {
      phaseHint.classList.add('is-gone');
      phaseHint.textContent = '';
    } else if (next === 'aim') {
      phaseHint.classList.remove('is-gone');
      phaseHint.classList.add('is-soft');
      phaseHint.textContent = logScene.fracture.fragments.some((f) => f.splittable)
        ? lockedCleaveNormal
          ? '再点继续劈'
          : '点剩余木块继续'
        : '拖动旋转 · 点木头开始';
      if (!lastOutcome) {
        resultEl.textContent = '';
        resultEl.className = 'result is-soft';
      }
    } else if (next === 'power') {
      phaseHint.classList.remove('is-gone', 'is-soft');
      phaseHint.textContent = lockedCleaveNormal ? '再点一下劈下' : '再点一下劈下';
    } else {
      phaseHint.classList.add('is-gone');
      phaseHint.textContent = '';
    }
    updateForceUi();
  }

  function rhythmHz(): number {
    const sp = currentSpecies();
    const axe = currentAxe();
    return 0.42 + sp.hardness * 0.38 + (1 - axe.sharpness) * 0.28;
  }

  function updateSweetZone(): void {
    const { lo, hi } = getSweetSliderRange(currentSpecies(), currentAxe());
    sweetZone.style.left = `${lo * 100}%`;
    sweetZone.style.width = `${Math.max(2, (hi - lo) * 100)}%`;
  }

  function updateForcePreview(): void {
    // Kept for a11y only — visually hidden to match lean reference HUD.
    if (phase !== 'power') {
      forcePreview.textContent = '再点一下劈下';
      forcePreview.className = 'force-preview is-idle sr-only';
      return;
    }
    const outcome = resolveChop({
      slider01: rhythm01,
      species: currentSpecies(),
      axe: currentAxe(),
    });
    forcePreview.textContent = previewLabels[outcome];
    forcePreview.className = `force-preview sr-only ${outcome}`;
  }

  function updateForceUi(): void {
    updateSweetZone();
    updateForcePreview();
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

  function armLockedTarget(): boolean {
    const next = logScene.pickNextChopTarget();
    if (!next) {
      aimPoint = null;
      aimTarget = null;
      aimGeneration = 0;
      return false;
    }
    aimPoint = next.point.clone();
    aimTarget = next.mesh;
    aimGeneration = next.generation;
    logScene.clearMarker();
    return true;
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

    // First contact locks the vertical cleave family from aim vs piece center.
    if (!lockedCleaveNormal) {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const [nx, nz] = cleaveNormalXZ(hit.point.x, hit.point.z, center.x, center.z);
      lockedCleaveNormal = new THREE.Vector3(nx, 0, nz);
    }

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
    hudLean = true;
    resultEl.textContent = labels[outcome];
    resultEl.className = `result ${outcome}`;
    if (resultFadeTimer !== null) window.clearTimeout(resultFadeTimer);
    resultFadeTimer = window.setTimeout(() => {
      resultFadeTimer = null;
      resultEl.classList.add('is-fading');
    }, 1100);
    const target = aimTarget;
    const point = aimPoint.clone();
    const generation = aimGeneration;
    const rebound = outcome === 'too_light';
    const planeNormal = lockedCleaveNormal?.clone() ?? null;

    // Always swing top→down in the vertical plane; rebound when force is too light.
    logScene.playAxeSwing(point, { rebound });
    tintLog(target, outcome);
    flash(outcome);
    buzz(outcome);
    logScene.punchScale(outcome === 'too_heavy' ? 0.08 : outcome === 'sweet' ? 0.04 : 0.02);
    logScene.setShake(outcome === 'too_heavy' ? 0.1 : outcome === 'too_light' ? 0.04 : 0.06);
    platform.audio.play(`chop:${outcome}`, { volume: 0.55 });
    platform.storage.setItem('firewood.h5.lastOutcome', outcome);

    const plan = planFracture({
      outcome,
      weakDevice,
      axe: { weight: axe.weight, edge: axe.edge },
      generation,
    });

    // Resolve crack / nick at blade impact so the stump stays unchanged on rebound.
    impactTimer = window.setTimeout(() => {
      impactTimer = null;
      if (plan.nickOnly) {
        logScene.playNick(point);
        logScene.clearMarker();
      } else if (target.parent || target.visible) {
        logScene.fractureAt(
          target,
          point,
          plan,
          generation,
          planeNormal ? { planeNormal } : undefined,
        );
      } else {
        logScene.fractureAt(
          target,
          point,
          plan,
          generation,
          planeNormal ? { planeNormal } : undefined,
        );
      }
    }, IMPACT_DELAY_MS);

    setPhase('result');
    phaseTimer = window.setTimeout(() => {
      phaseTimer = null;
      chopping = false;
      if (phase !== 'result') return;

      if (rebound && lockedCleaveNormal) {
        // Weak force: keep locked direction + same aim; rhythm bar continues.
        if (!aimPoint || !aimTarget) armLockedTarget();
        setPhase('power');
        return;
      }

      // Successful (or heavy) chop: auto-arm next parallel slice — no re-aim.
      if (lockedCleaveNormal && armLockedTarget()) {
        setPhase('power');
      } else {
        aimPoint = null;
        aimTarget = null;
        setPhase('aim');
      }
    }, 720);
  }

  function resetRound(): void {
    clearChopTimers();
    chopping = false;
    aimPoint = null;
    aimTarget = null;
    aimGeneration = 0;
    lockedCleaveNormal = null;
    lastOutcome = null;
    hudLean = false;
    phaseHint.classList.remove('is-gone');
    logScene.resetLog();
    void logScene.setSpecies(currentSpecies());
    setPhase('aim');
  }

  speciesChipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = speciesChip.dataset.open !== 'true';
    setChipOpen(axeChip, axePanel, axeChipBtn, false);
    setChipOpen(speciesChip, speciesPanel, speciesChipBtn, open);
  });
  axeChipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = axeChip.dataset.open !== 'true';
    setChipOpen(speciesChip, speciesPanel, speciesChipBtn, false);
    setChipOpen(axeChip, axePanel, axeChipBtn, open);
  });
  speciesPanel.addEventListener('click', (e) => e.stopPropagation());
  axePanel.addEventListener('click', (e) => e.stopPropagation());

  speciesSelect.addEventListener('change', () => {
    if (speciesBusy) return;
    speciesBusy = true;
    const sp = currentSpecies();
    platform.storage.setItem('firewood.h5.species', sp.id);
    refreshChipLabels();
    updateForceUi();
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
    refreshChipLabels();
    updateForceUi();
  });

  // Second click: confirm chop from the rhythm dock (or anywhere else in power).
  powerPanel.addEventListener('pointerdown', (e) => {
    if (phase !== 'power') return;
    e.preventDefault();
    e.stopPropagation();
    doChop();
  });

  againBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetRound();
  });

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
      if (!dragging && sample.phase === 'up') {
        closeChips();
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + sample.x;
        const cy = rect.top + sample.y;
        if (phase === 'power' && !chopping) {
          // Confirm swing — first chop or locked multi-chop (no re-aim).
          doChop();
        } else if (phase === 'aim' && !chopping) {
          if (lockedCleaveNormal && armLockedTarget()) {
            // Subsequent taps: skip raycast aim, go straight into rhythm→chop.
            setPhase('power');
            doChop();
          } else {
            aimAt(cx, cy);
          }
        }
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
  refreshChipLabels();
  updateForceUi();
  setPhase('aim');

  // Test hook for automated feel verification (dev / local only).
  (window as unknown as { __fwTest?: object }).__fwTest = {
    getPhase: () => phase,
    getRhythm: () => rhythm01,
    setRhythm: (v: number) => {
      rhythm01 = Math.min(1, Math.max(0, v));
      rhythmPhase = Math.asin(Math.max(-1, Math.min(1, (rhythm01 - 0.5) * 2)));
      updateForceUi();
    },
    doChop: () => doChop(),
    reset: () => resetRound(),
    aimAt: (x: number, y: number) => aimAt(x, y),
    getLockedCleave: () =>
      lockedCleaveNormal
        ? { x: lockedCleaveNormal.x, z: lockedCleaveNormal.z }
        : null,
    armLocked: () => armLockedTarget(),
    fragmentCount: () => logScene.fracture.fragments.length,
    splittableCount: () => logScene.fracture.fragments.filter((f) => f.splittable).length,
    /** Stump-piece horizontal centers + pairwise gap (for bounce/offset checks). */
    stumpGap: () => {
      const stump = logScene.fracture.fragments.filter((f) => f.onStump && f.mesh.visible);
      const boxes = stump.map((f) => {
        const box = new THREE.Box3().setFromObject(f.mesh);
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        return {
          x: c.x,
          y: c.y,
          z: c.z,
          bouncing: !!f.bounce,
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
          sizeX: s.x,
          sizeZ: s.z,
        };
      });
      let maxGap = 0;
      let faceGap = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d > maxGap) maxGap = d;
          const sepX = a.maxX < b.minX ? b.minX - a.maxX : b.maxX < a.minX ? a.minX - b.maxX : 0;
          const sepZ = a.maxZ < b.minZ ? b.minZ - a.maxZ : b.maxZ < a.minZ ? a.minZ - b.maxZ : 0;
          const faces = Math.max(sepX, sepZ);
          if (faces > faceGap) faceGap = faces;
        }
      }
      const debug = logScene.fracture.lastCleaveDebug;
      const approxDiameter = debug?.diameter ?? 0.8;
      return {
        count: stump.length,
        centers: boxes,
        maxGap,
        faceGap,
        approxDiameter,
        faceGapFrac: approxDiameter > 1e-6 ? faceGap / approxDiameter : 0,
        sideOffset: debug?.sideOffset ?? null,
        gapFracPlan: debug?.gapFrac ?? null,
        cleaveDebug: debug,
      };
    },
    /** Freeze axe at vertical impact pose over the log (for screenshot tests). */
    freezeAxeImpact: () => logScene.debugFreezeAxeImpact(),
    getAxePose: () => logScene.debugAxePose(),
    outcomePreview: () =>
      resolveChop({ slider01: rhythm01, species: currentSpecies(), axe: currentAxe() }),
  };

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
