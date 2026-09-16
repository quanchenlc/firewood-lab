# @firewood/wechat-game

微信小游戏（**不是**普通微信小程序）运行时占位包。

## 状态

尚未实现。当前里程碑只提供目录与说明，方便后续接入微信小游戏 WebGL 运行时。

## 计划

- 复用 `@firewood/game-core`（纯逻辑，无 DOM）
- 复用 `@firewood/content`（树种 / 斧头数据）
- 在 `@firewood/platform` 中实现 WeChat 版 `IAudio` / `IStorage` / `IAssetLoader` / `IInput`
- 使用微信小游戏 WebGL 渲染（与 H5 Three.js 壳并行，而非替换）

## 本地开发

请先使用 H5 预览：

```bash
pnpm install
pnpm --filter @firewood/h5 dev
```
