# Changelog

本项目的版本号由维护者统一控制，当前为 **0.1.1**。

## 0.1.1 — 2026-10-25

交互查看器与明暗主题可读性修复。

### 新增

- 交互查看器：卡片内图表支持滚轮缩放（以光标为中心）、右键拖动平移、左键框选后铺满窗口、中键/双击复位；查看器右上角提供「适应窗口」与「全屏」按钮。
- 全屏查看：在 DSH 页面内铺满整个视口（Esc / 关闭按钮退出），全屏中同样支持缩放、拖动与框选。
- 查看器高度自适应：小图给足留白、大图封顶 560px，复杂图表不再挤在狭窄区域。

### 修复

- 夜间模式可读性：节点用 `classDef`/`style` 指定固定填充色时，标签文字会继承主题文字色导致低对比；Host 渲染后按填充色相对亮度自动选择深/浅高对比文字色（作者显式 `color` 不覆盖）。对比图见 `deliverables/effect-dark-contrast.png`。
- 边标签背景：`--pele-bg` 改为映射卡片底色（原先 `transparent` 让 pele 的标签背景矩形失效，连线会从标签文字中间穿过）。对比图见 `deliverables/effect-label-background.png`。
- GitHub 上的语言切换曾渲染为字面量：`<div align>` 块内改为空行分隔，恢复 Markdown 解析。

### 文档与工程

- 市场收录准备：新增 `docs/icon-180.png` 市场卡片图标；`plugin/package.json` 补 `repository.directory`；仓库 topics 已配置（不体现在仓库文件内）。
- 效果图：新增 `deliverables/effect-viewer.png`、`effect-fullscreen.png`、`effect-label-background.png`、`effect-dark-contrast.png`；中英文 README 同步交互操作与两处渲染修复的说明。
- 测试：离线自检新增节点文字对比度断言；卡片 SSR 测试 13 → 14 条（覆盖查看器控件与边标签背景）。

## 0.1.0 — 2026-10-25

首个开源版本，当前能力如下。

### 工具与渲染

- Host 工具 `pele_draw`：提交 Mermaid 12.1 源码，Host 端用 vendored pele 1.10.0 同步渲染 SVG；支持 33 种图表类型；结果只返回类型/尺寸/字节摘要。
- SVG 通过 `output.presentationMeta` 持久化到 `tool/result.meta`，不进入模型上下文。

### 卡片与下载

- 客户端 `tool.call.toolview`（key = `pele_draw`）三阶段卡片：准备中 → 渲染中 → 成图；显示标题、尺寸/体积徽章与内联 SVG。
- 卡片右上角下载按钮：**下载 SVG**（主题中立的矢量图）/ **下载 PNG**（跟随当前明暗主题、2x 栅格化、背景取卡片背景）；插件不写工作区文件。
- 配色：系列色使用饱和调色板（蓝/绿/琥珀/红/紫/青/粉/青柠），文字与节点/连线混入蓝调，明暗主题下都干净可读。

### 提示与错误

- 系统提示注入 `## 图表（pele_draw）`，并同步更新工具 description；工具对某 Agent 不可见时提示为空。
- 语法错误返回 Mermaid 行列号与片段；mindmap「节点文本以 `mindmap` 开头」的词法坑额外给出改写建议。

### 安全

- Host/Client 双重 SVG 清洗（脚本、`foreignObject`、内联事件、`javascript:` 链接）；源码/SVG/内联体积上限；Client 要求 SVG 以 `<svg` 开头。

### 测试

- 离线渲染自检（33 类语料 + 错误路径），卡片 SSR 测试 13/13；语料遍历可由 `scripts/build-traversal-report.mjs` 复现。
