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

玩法循环：边缘轻触切换树种/斧头 → **拖动旋转视角（劈面朝向=相机水平朝向）** → **点木头**（出节奏力道条，无瞄准标记）→ **再点劈下** →

- 初始几乎无 HUD；树种/斧头收成左右边缘芯片，点开才展开
- 力道条绿带由硬度 × 斧头属性决定；指针自动往返（「转转转」），第二次点击瞬间取样
- 第二次点击**总会**播放斧头自上而下挥砍（即使指针不在绿带）
- `too_light`：斧头回弹，木桩几何不变（仅浅痕）
- `sweet`：沿**相机朝向**竖向劈面剖成**两半**，侧向错开约 **0.2×原木直径**，直立停在桩上
- 同一劈向成功约 **4 刀**后，劈面自动 **旋转 90°** 继续
- 无可再劈碎块时：碎片**甩落地面**，再**收成场景周围环形柴堆**，并刷新新原木
- 可点右下角重置（清空柴堆）

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

| 用途 | 来源 | 许可 |
|------|------|------|
| 6 种树皮 PBR（diff/nor/rough 1K） | Poly Haven bark packs | CC0 |
| 树桩 GLTF `tree_stump_02` | Poly Haven | CC0 |
| 斧头 GLTF（hatchet / wooden_axe / wooden_axe_03 / sledgehammer_01） | Poly Haven | CC0 |
| 地面 `forest_ground_04` | Poly Haven | CC0 |
| 天空 HDRI `kloofendal_43d_clear_puresky`（1K） | Poly Haven | CC0 |
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
