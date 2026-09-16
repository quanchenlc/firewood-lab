# Firewood Lab

firewood-lab — 写实劈柴、轻松解压的 WebGL 小游戏（轻教育向），灵感来自 [screen.toys/firewood](https://screen.toys/firewood/)。

## 快速开始

```bash
pnpm install
pnpm assets:pull   # 可选：刷新 Poly Haven CC0 资源（已提交 1K 回退）
pnpm --filter @firewood/h5 dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

玩法循环：选树种/斧头 → **点击木头瞄准** → 调力道 → **劈下去** →

- 切换树种会更换树皮 / 断面贴图（Poly Haven CC0）
- `too_light`：浅痕，不碎裂
- `sweet` / `too_heavy`：**Voronoi 多碎片** + cannon-es 物理落下
- 可点击较大碎块继续劈，或「再来一斧」重置

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
| 断面年轮 | 仓库脚本生成 | 项目自有 |

**碎裂代理：** 真实 stump GLB 约 3 万顶点，不适合实时 Voronoi；场景用 **PBR 圆柱 proxy** 作为可劈裂木头，下方对齐展示 stump 模型。

## 碎裂方案（H5）

| 层 | 选择 |
|----|------|
| Voronoi | `@dgreenheck/three-pinata` |
| 物理 | `cannon-es`（AABB Box 近似） |
| 预算 | `planFracture()` |

## 平台路线

1. **H5 先行**（Vite + Three.js）
2. **微信小游戏稍后**（WebGL，不是小程序）

## 许可

私有项目脚手架；第三方资源见 ATTRIBUTION。
