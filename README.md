# Firewood Lab

firewood-lab — 写实劈柴、轻松解压的 WebGL 小游戏（轻教育向），灵感来自 [screen.toys/firewood](https://screen.toys/firewood/)。

## 快速开始

```bash
pnpm install
pnpm --filter @firewood/h5 dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。页面包含简易 Three.js 场景，以及 `resolveChop` 力道演示（`too_light` / `sweet` / `too_heavy`）。

其他常用命令：

```bash
pnpm --filter @firewood/h5 build
pnpm typecheck
```

需要 Node.js ≥ 20，包管理器使用 pnpm（见根目录 `packageManager` 字段）。

## 架构

```
apps/h5/                 # Vite + Three.js H5 壳（优先）
apps/wechat-game/        # 微信小游戏占位（仅 README，稍后实现）
packages/game-core/      # 树种 / 斧头类型、resolveChop — 无 DOM / window / wx
packages/platform/       # IAudio / IStorage / IAssetLoader / IInput + H5 stub
packages/content/        # species.json、axes.json 内容桩
```

包作用域均为 `@firewood/*`。`game-core` 保持纯逻辑，便于日后复用到微信小游戏 WebGL 运行时。

## 平台路线

1. **H5 先行**（Vite + Three.js）— 手机浏览器预览
2. **微信小游戏稍后**（WebGL）— **不是**普通微信小程序；见 `apps/wechat-game/README.md`

本仓库当前里程碑只做 monorepo 脚手架与最小演示，**尚未**实现完整 Voronoi 劈裂或微信运行时。

## 许可

私有项目脚手架；内容与资源后续补充。
