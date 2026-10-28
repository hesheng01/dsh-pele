# Changelog

本项目的版本号由维护者统一控制，当前为 **0.1.2**。

## 0.1.2 — 2026-10-28

查看器交互改为「点击激活」、放大保持矢量清晰，并升级 vendored pele 至 1.12.0。

### 变更

- 查看器默认未激活：鼠标停在图表上时滚轮照常滚动页面，不再缩放图表（消除 scroll hijacking）。
- 点击图表进入交互态：滚轮缩放、右键拖动、左键框选、中键复位、双击复位恢复为原有行为；点击卡片外或按 `Esc` 退出交互，滚轮重新交还页面。
- 激活态视觉反馈：查看器显示内描边，底部提示在「点击图表开始交互」与手势提示之间切换。
- 键盘可访问性：查看器 `tabindex=0` 可聚焦，聚焦即激活（无需鼠标点击），`Esc` 退出。
- 全屏层仍为激活态（由显式点击进入），交互行为不变。

### 修复

- 放大图表后发糊：查看器改为按缩放后的布局尺寸让 SVG **原生矢量重绘**（`width/height` 按 scale 放大），不再用 CSS `transform` 拉伸已被浏览器栅格化的合成层（高分屏/GPU 合成下会越放越糊，并移除了 `will-change: transform`）。
- PNG 导出同步修正：克隆 SVG 时把查看器加上的 `100%` 尺寸还原成自然尺寸，避免导出图按默认视口（300×150）栅格化而变糊。

### 依赖

- 升级 vendored **pele 1.10.0 → 1.12.0**（含 1.10.1 / 1.11.0 / 1.12.0）。主要收益：`classDef`/`style` 等自定义填充色上的标签与边自动选高对比色（新增 `--pele-fg-on-light` / `--pele-fg-on-dark`，明暗主题都可读）、`flowchart`/`agentflow` 子图方向按父级修正、以关键字开头的名字（`set-theory`、`titles` 等）不再误报语法错误、链接中的 `%20`/`%26` 转义保留、treemap / block / sequence 布局改进。
- 兼容性验证：33 类语料重新遍历，**33/33 图表的类型与尺寸与 1.10.0 完全一致**；错误路径（语法 / 未识别 / 上限 / mindmap 关键字坑）保持可用。Host 端的标签对比度兜底注入保留，用于旧版本输出。
- 重新生成 `research/samples/`、遍历报告与摘要（`build-traversal-report.mjs` 的版本号同步为 1.12.0）。

### 文档与工程

- 卡片 SSR 测试更新为 14 条（新增默认未激活、可聚焦、激活提示断言）；中英文 README 同步「点击激活」交互说明。

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
