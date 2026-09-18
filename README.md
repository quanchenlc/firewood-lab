# Firewood Lab

firewood-lab — 写实劈柴、轻松解压的 WebGL 小游戏（轻教育向），灵感来自 [screen.toys/firewood](https://screen.toys/firewood/)。

## 快速开始

```bash
pnpm install
pnpm assets:pull   # 可选：刷新 Poly Haven CC0 资源（已提交 1K 回退）
pnpm --filter @firewood/h5 dev
```

开发服务器会挂在 **`http://localhost:5173/firewood-lab/`**（Vite `base` 与 GitHub Pages 一致）。

### GitHub Pages 预览

线上地址：**https://quanchenlc.github.io/firewood-lab/**

首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（点一次即可）。之后推送到 `main` 或 `cursor/**` 分支会自动构建并部署 `apps/h5/dist`。

玩法循环（当前调试直砍 `DEBUG_DIRECT_CHOP`）：边缘轻触切换树种/斧头 → **拖动旋转视角（劈面=当前相机水平朝向）** → **点木头立即劈开**（无力道条 / 无二次确认）→

- 初始几乎无 HUD；树种/斧头收成左右边缘芯片，点开才展开
- **调试阶段：力道条关闭**（`forceBarEnabled: false`）；点中木头即挥砍，未点中木头则 miss
- 劈面每刀按**点击瞬间的相机朝向**重算（不锁定旧角度；暂不启用 4 刀转 90°）
- 劈点使用 raycast **精确命中点**
- `sweet`：沿相机朝向竖向劈面剖成**两半**，侧向错开约 **0.2×原木直径**，直立停在桩上
- **薪柴分类**（体积 in³ + 水平长宽比，对齐 screen.toys）：≤250 或（≤500 且 aspect≤3）→ 甩落柴堆；`(250,500]` 且 aspect>3 → 留桩可再劈；>500 → 留桩
- **同向过薄（option A）**（沿当前劈面法向厚度 < 5″）：再测水平垂直方向；若另一向也 < 5″ **或** 已达薪柴体积/长宽比门槛 → **成柴落地**（物理甩落）；否则仅相机方位角平滑转约 90°（`太薄 · 换角度`）
- 无可再劈碎块时：碎片**甩落地面**，再**收成场景周围环形柴堆**，并刷新新原木
- 可点右下角重置（清空柴堆）

> 恢复完整「点木 → 节奏条 → 再点确认 + 4 刀转 90°」：将 `apps/h5/src/debug-flags.ts` 中 `DEBUG_DIRECT_CHOP` 设为 `false`。

其他常用命令：

```bash
pnpm --filter @firewood/h5 build
pnpm typecheck
pnpm test
pnpm assets:pull
```

需要 Node.js ≥ 20，包管理器使用 pnpm。

## 架构

```
apps/h5/                 # Vite + Three.js H5 壳（public/assets 静态资源）
apps/wechat-game/        # 微信小游戏占位（仅 README）
packages/game-core/      # resolveChop、planFracture — 无 DOM
packages/platform/       # 平台接口 + H5 stub
packages/content/        # species.json / axes.json（含 maps、model、attribution）
scripts/pull-assets.mjs  # 从 Poly Haven API 拉取 1K 贴图与 GLTF
```

## 资源与许可

详见 `apps/h5/public/assets/ATTRIBUTION.md`。

### 音频（本次）

- **户外环境 BGM**（循环、音量约 0.4）：BigSoundBank *Forest*（Joseph Sardin，CC0）
- **劈柴 SFX**：BigSoundBank *Ax on Wood* 截取多段命中（CC0）；过轻 nick / 过薄 nudge 用 OpenGameArt rubberduck 木击包（CC0）
- **未使用** screen.toys / shapiro500 的任何音频文件；仅对照其触发时机（落斧瞬间 / 劈开时）与大致混音

左下角 **音 / 静** 可静音；偏好写入 `localStorage`（`firewood.h5.muted`）。首次点击/触摸会解锁 `AudioContext` 并启动 BGM（符合浏览器自动播放策略）。

| 用途 | 来源 | 许可 |
|------|------|------|
| 6 种树皮 PBR（diff/nor/rough 1K） | Poly Haven bark packs | CC0 |
| 树桩 GLTF `tree_stump_02` | Poly Haven | CC0 |
| 斧头 GLTF（hatchet / wooden_axe / wooden_axe_03 / sledgehammer_01） | Poly Haven | CC0 |
| 地面 `forest_ground_04` | Poly Haven | CC0 |
| 天空 HDRI `kloofendal_48d_partly_cloudy_puresky`（1K HDR + 2K JPG） | Poly Haven | CC0 |
| 断面年轮（端盖） | 仓库脚本生成 | 项目自有 |
| 劈面纵纹（切面） | 仓库脚本生成 | 项目自有 |

**碎裂代理：** 真实 stump GLB 约 3 万顶点，不适合实时 Voronoi；场景用 **PBR 圆柱 proxy** 作为可劈裂木头，下方对齐展示 stump 模型。

## 碎裂方案（H5）

| 层 | 选择 |
|----|------|
| 主路径 | `DestructibleMesh.sliceWorld` — 过瞄准点的竖向劈面（grain / up） |
| 过猛 | 同劈面递归二次剖分，碎块仍沿 ±法向侧向冲量 |
| 回退 | 2.5D Voronoi（沿 Y 挤出）+ 劈面两侧种子点 |
| 物理 | `cannon-es`（AABB）+ **scripted slide**（面缝 ≈0.2×直径；主半块 STATIC 直立） |
| 预算 | `planFracture()` → `splitStyle` + `wedgeGap`（面缝/直径分数）+ `popHeight` |

## 平台路线

1. **H5 先行**（Vite + Three.js）
2. **微信小游戏稍后**（WebGL，不是小程序）

## 许可

私有项目脚手架；第三方资源见 ATTRIBUTION。
