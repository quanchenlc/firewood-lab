#!/usr/bin/env node
/**
 * Pull CC0 Poly Haven assets into apps/h5/public/assets.
 * Usage: pnpm assets:pull
 *
 * Requires network. Respects Poly Haven API User-Agent guidance.
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCanvas } from './endgrain-canvas.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'apps/h5/public/assets');
const UA = 'FirewoodLab/0.1 (github.com/quanchenlc/firewood-lab; assets:pull)';
const API = 'https://api.polyhaven.com';

const BARK = [
  { id: 'pine_bark', dir: 'bark/pinus' },
  { id: 'jolcham_oak_bark_01', dir: 'bark/quercus-serrata' },
  { id: 'japanese_cedar_bark', dir: 'bark/cryptomeria' },
  { id: 'bark_platanus', dir: 'bark/platanus' },
  { id: 'bark_bluegum', dir: 'bark/eucalyptus-globulus' },
  { id: 'chinese_cedar_bark', dir: 'bark/toona' },
];

const MODELS = [
  { id: 'hatchet', dir: 'models/axes/hand-axe' },
  { id: 'wooden_axe', dir: 'models/axes/nordic-splitting-axe' },
  { id: 'wooden_axe_03', dir: 'models/axes/camp-axe' },
  { id: 'sledgehammer_01', dir: 'models/axes/maul' },
];

const GROUND = [{ id: 'forest_ground_04', dir: 'ground/forest_ground_04' }];

/** Daytime pure-sky HDRIs (1K Radiance) — mobile-friendly equirect backgrounds. */
const SKIES = [
  { id: 'kloofendal_48d_partly_cloudy_puresky', dir: 'sky/kloofendal_48d_partly_cloudy_puresky', file: 'sky_1k.hdr' },
];

/**
 * Photographic longitudinal side-grain for cut faces (not procedural sin stripes).
 * kitchen_wood already has strong vertical fibers (V = log height) — no rotate.
 * Replaces ash_veneer (fine veneer + blur + ×1.18 wash → flat peach at game scale).
 */
const SIDEGRAIN = {
  id: 'kitchen_wood',
  diffName: 'sidegrain_diff.jpg',
  norName: 'sidegrain_nor.jpg',
  /** Source grain already runs along V; set true only if a future source is horizontal. */
  rotate90ccw: false,
};

const ENDGRAIN_TINTS = {
  pinus: [210, 180, 120],
  'quercus-serrata': [180, 140, 90],
  cryptomeria: [200, 160, 110],
  platanus: [190, 165, 125],
  'eucalyptus-globulus': [175, 155, 115],
  toona: [185, 110, 75],
};

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    console.log('  skip', dest);
    return;
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log('  got ', dest);
}

function pickJpg(mapBlock, res = '1k') {
  const block = mapBlock?.[res];
  if (!block) return null;
  if (block.jpg) return block.jpg;
  if (block.png) return block.png;
  return null;
}

async function pullBark() {
  for (const item of BARK) {
    console.log('bark', item.id);
    const files = await api(`/files/${item.id}`);
    const maps = [
      ['Diffuse', 'diff.jpg'],
      ['nor_gl', 'nor.jpg'],
      ['Rough', 'rough.jpg'],
    ];
    for (const [key, filename] of maps) {
      const file = pickJpg(files[key], '1k');
      if (!file) throw new Error(`Missing ${item.id} ${key}`);
      await download(file.url, join(OUT, item.dir, filename));
    }
  }
}

async function pullGround() {
  for (const item of GROUND) {
    console.log('ground', item.id);
    const files = await api(`/files/${item.id}`);
    const maps = [
      ['Diffuse', 'diff.jpg'],
      ['nor_gl', 'nor.jpg'],
    ];
    for (const [key, filename] of maps) {
      const file = pickJpg(files[key], '1k');
      if (!file) throw new Error(`Missing ${item.id} ${key}`);
      await download(file.url, join(OUT, item.dir, filename));
    }
  }
}

async function pullSkies() {
  for (const item of SKIES) {
    console.log('sky', item.id);
    const files = await api(`/files/${item.id}`);
    const hdr = files.hdri?.['1k']?.hdr;
    if (!hdr?.url) throw new Error(`No hdri/1k/hdr for ${item.id}`);
    await download(hdr.url, join(OUT, item.dir, item.file));
    // Tonemapped JPG → mobile equirect background (resize externally if needed).
    const tm = files.tonemapped;
    if (tm?.url) {
      await download(tm.url, join(OUT, item.dir, 'sky_tonemapped_full.jpg'));
    }
  }
}

async function pullModel(id, dir) {
  console.log('model', id);
  const files = await api(`/files/${id}`);
  const entry = files.gltf?.['1k']?.gltf;
  if (!entry) throw new Error(`No gltf/1k for ${id}`);
  const base = join(OUT, dir);
  const gltfName = `${id}_1k.gltf`;
  await download(entry.url, join(base, gltfName));
  for (const [rel, meta] of Object.entries(entry.include || {})) {
    await download(meta.url, join(base, rel));
  }
  return gltfName;
}

function writeEndgrain() {
  for (const [species, rgb] of Object.entries(ENDGRAIN_TINTS)) {
    const dest = join(OUT, 'endgrain', `${species}.png`);
    mkdirSync(dirname(dest), { recursive: true });
    createCanvas(dest, rgb);
    console.log('  endgrain', dest);
  }
}

/**
 * Download kitchen_wood longitudinal grain (already V-aligned).
 * Overwrites facegrain/sidegrain_{diff,nor}.jpg. Retires procedural sin canvas.
 */
async function pullSidegrain() {
  console.log('sidegrain', SIDEGRAIN.id);
  const files = await api(`/files/${SIDEGRAIN.id}`);
  const diff = pickJpg(files.Diffuse, '1k');
  const nor = pickJpg(files.nor_gl, '1k');
  if (!diff) throw new Error(`Missing ${SIDEGRAIN.id} Diffuse`);
  const faceDir = join(OUT, 'facegrain');
  mkdirSync(faceDir, { recursive: true });
  const rawDiff = join(faceDir, `_raw_${SIDEGRAIN.id}_diff.jpg`);
  const rawNor = join(faceDir, `_raw_${SIDEGRAIN.id}_nor.jpg`);
  // Force re-download when regenerating oriented maps.
  for (const p of [rawDiff, rawNor, join(faceDir, SIDEGRAIN.diffName), join(faceDir, SIDEGRAIN.norName)]) {
    try {
      const { unlinkSync } = await import('node:fs');
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  await download(diff.url, rawDiff);
  if (nor) await download(nor.url, rawNor);

  const outDiff = join(faceDir, SIDEGRAIN.diffName);
  const outNor = join(faceDir, SIDEGRAIN.norName);
  const { copyFileSync, readdirSync, unlinkSync } = await import('node:fs');
  const place = (src, dest) => {
    if (SIDEGRAIN.rotate90ccw) {
      // transpose=2 = 90° CCW — horizontal source grain → vertical (V = height).
      const r = spawnSync('ffmpeg', ['-y', '-i', src, '-vf', 'transpose=2', dest], {
        encoding: 'utf8',
      });
      if (r.status !== 0) {
        throw new Error(`ffmpeg rotate failed: ${r.stderr || r.stdout}`);
      }
    } else {
      copyFileSync(src, dest);
    }
    console.log('  sidegrain', dest);
  };
  place(rawDiff, outDiff);
  if (existsSync(rawNor)) place(rawNor, outNor);

  // Drop temps + legacy procedural species facegrain PNGs.
  for (const name of [`_raw_${SIDEGRAIN.id}_diff.jpg`, `_raw_${SIDEGRAIN.id}_nor.jpg`]) {
    const p = join(faceDir, name);
    if (existsSync(p)) unlinkSync(p);
  }
  for (const name of readdirSync(faceDir)) {
    if (name.endsWith('.png')) {
      unlinkSync(join(faceDir, name));
      console.log('  removed procedural', name);
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await pullBark();
  await pullGround();
  await pullSkies();
  writeEndgrain();
  await pullSidegrain();
  // Bark-edge cut atlas (A|B|C) — CC0 composite; never screen.toys insidegrain.
  const atlas = spawnSync('python3', [join(ROOT, 'scripts/barkedge-atlas.py')], {
    encoding: 'utf8',
  });
  if (atlas.status !== 0) {
    throw new Error(`barkedge-atlas failed: ${atlas.stderr || atlas.stdout}`);
  }
  console.log(atlas.stdout.trim());
  const modelIndex = {};
  for (const m of MODELS) {
    const file = await pullModel(m.id, m.dir);
    modelIndex[m.id] = `${m.dir}/${file}`;
  }
  const textureIndex = {
    forest_ground_04: {
      diff: 'ground/forest_ground_04/diff.jpg',
      nor: 'ground/forest_ground_04/nor.jpg',
    },
    kloofendal_48d_partly_cloudy_puresky: {
      hdr: 'sky/kloofendal_48d_partly_cloudy_puresky/sky_1k.hdr',
      jpg: 'sky/kloofendal_48d_partly_cloudy_puresky/sky_2k.jpg',
    },
    kitchen_wood_sidegrain: {
      diff: 'facegrain/sidegrain_diff.jpg',
      nor: 'facegrain/sidegrain_nor.jpg',
    },
    barkedge_cutface: {
      diff: 'facegrain/barkedge_diff.jpg',
      nor: 'facegrain/barkedge_nor.jpg',
    },
    insidegrain_packs: {
      pinus: 'facegrain/pinus/insidegrain_diff.jpg',
      'quercus-serrata': 'facegrain/quercus-serrata/insidegrain_diff.jpg',
      cryptomeria: 'facegrain/cryptomeria/insidegrain_diff.jpg',
      platanus: 'facegrain/platanus/insidegrain_diff.jpg',
      'eucalyptus-globulus': 'facegrain/eucalyptus-globulus/insidegrain_diff.jpg',
      toona: 'facegrain/toona/insidegrain_diff.jpg',
    },
  };
  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify({ models: modelIndex, textures: textureIndex, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log('Done →', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
