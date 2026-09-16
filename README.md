# Firewood Lab

firewood-lab — 写实劈柴、轻松解压的 WebGL 小游戏（轻教育向），灵感来自 [screen.toys/firewood](https://screen.toys/firewood/)。

## 快速开始

```bash
pnpm install
pnpm --filter @firewood/h5 dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

玩法循环：选树种/斧头 → **点击木头瞄准** → 调力道 → **劈下去** →

- `too_light`：浅痕，不碎裂
- `sweet` / `too_heavy`：**Voronoi 多碎片** + cannon-es 物理落下（过猛时碎片更多、冲量更大）
- 可点击较大碎块继续劈，或「再来一斧」重置整根木头

其他常用命令：

```bash
pnpm --filter @firewood/h5 build
pnpm typecheck
pnpm test
```

需要 Node.js ≥ 20，包管理器使用 pnpm（见根目录 `packageManager` 字段）。

## 架构

```
apps/h5/                 # Vite + Three.js H5 壳（优先）
apps/wechat-game/        # 微信小游戏占位（仅 README，稍后实现）
packages/game-core/      # resolveChop、planFracture — 无 DOM / window / wx
packages/platform/       # IAudio / IStorage / IAssetLoader / IInput + H5 stub
packages/content/        # species.json、axes.json 内容桩
```

包作用域均为 `@firewood/*`。`game-core` 保持纯逻辑，便于日后复用到微信小游戏 WebGL 运行时。

## 碎裂方案（H5）

| 层 | 选择 | 说明 |
|----|------|------|
| Voronoi 网格碎裂 | [`@dgreenheck/three-pinata`](https://github.com/dgreenheck/three-pinata) | 维护中的 Three.js `DestructibleMesh`，支持 impact 点加密种子 |
| 刚体物理 | [`cannon-es`](https://github.com/pmndrs/cannon-es) | 轻量；碎片用 AABB Box 近似碰撞（MVP） |
| 预算规划 | `planFracture()` in `@firewood/game-core` | 按 outcome / 斧头 / 弱设备 / 代数限制 fragmentCount 与 impulse |

移动端：弱设备自动降低 `fragmentCount`（上限约 12），重置时 dispose geometry/materials。

### 后续（未做）

- ConvexHull / 真凸包碰撞（替代 Box 近似）
- 年轮纹理与内裂面 UV
- 与 screen.toys/firewood 完全同级的渐进碎裂手感
- 微信小游戏 runtime

## 平台路线

1. **H5 先行**（Vite + Three.js）— 手机浏览器预览
2. **微信小游戏稍后**（WebGL）— **不是**普通微信小程序；见 `apps/wechat-game/README.md`

## 许可

私有项目脚手架；内容与资源后续补充。
