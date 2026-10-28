<div align="right">

**简体中文** · [English](README.en.md)

</div>

# dsh-pele

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

用 [pele](https://github.com/obsidianmd/pele)（Mermaid → SVG 渲染器）在 **DeepSeek Harness（DSH）** 会话里绘图：模型调用工具 `pele_draw` 提交 Mermaid 源码，Host 端用 pele 把图渲染成 SVG（不占模型上下文），Web 会话里由客户端插件把该工具调用渲染成**内联图表卡片**；卡片右上角可把图下载为 **SVG** 或 **PNG**，不写工作区文件。

- 目标 profile：`web`（DSH 0.2.1-rc.2）
- 版本：**0.1.2**（开源版本；尚未发布到 npm，可用本地目录或 Git 仓库安装）
- 0.1.2 变更：查看器改为**点击激活**（未激活时悬停滚轮照常滚动页面）、放大按矢量重绘不再发糊、vendored pele 升级至 **1.12.0**（明细见 [CHANGELOG.md](CHANGELOG.md)）
- 仓库：<https://github.com/hesheng01/dsh-pele>
- 纯 JS、无构建步骤、无运行时 npm 依赖（pele 以 MIT 许可 vendored 在 `plugin/vendor/`）

## 效果

![pele_draw 内联图表卡片：思维导图、饼图、柱线图、桑基图](deliverables/effect-diagrams.png)

模型调用 `pele_draw` 后，图表以卡片形式直接出现在会话消息流里：标题、尺寸/体积徽章、SVG（上图为同一次会话里的思维导图、饼图、柱线图、桑基图）。系列色使用饱和调色板（蓝/绿/琥珀/红/紫/青/粉/青柠），不再跟随品牌黑白灰；文字、节点与连线都带蓝调，画面更干净。

卡片右上角的下载按钮提供两种导出：

![下载菜单：下载 SVG / 下载 PNG](deliverables/effect-download.png)

- **下载 SVG**：主题中立的矢量图（pele 的浅色回退配色），任何查看器都能看清；
- **下载 PNG**：跟随当前明/暗主题的位图，2x 栅格化，背景取卡片背景 —— 所见即所得。

复杂的图还能在卡片里直接查看（**点击图表后才进入交互**：未激活时鼠标停在卡片上也不会劫持滚轮，页面照常滚动；点击卡片外或按 **Esc** 退出交互）：

![卡片内交互查看器：右上角「适应窗口 / 全屏」，底部操作提示](deliverables/effect-viewer.png)

- **滚轮** 上/下：以光标为中心放大 / 缩小（仅交互状态下生效；放大时按矢量重绘，文字与线条保持清晰）；
- **右键拖动**：平移；
- **左键拖动**：框选一块区域，松开后把该区域铺满当前窗口；
- **中键单击 / 双击**：复位（适应窗口）；
- 右上角 **全屏按钮**：把图铺满当前 DSH 页面（Esc 或右上角 × 退出），全屏里同样支持以上操作（见 `deliverables/effect-fullscreen.png`）。

边标签背景修复对比（上：`--pele-bg: transparent`，连线穿过文字；下：卡片底色，标签正确遮挡连线）：

![边标签背景修复前后对比](deliverables/effect-label-background.png)

节点被 `classDef`/`style` 指定了固定填充色时，标签文字也会按填充色亮度自动选深/浅高对比色（夜间模式下浅色填充节点不再"浅字看不见"）：

![夜间模式固定填充色节点的文字对比度修复](deliverables/effect-dark-contrast.png)

更多演示：`deliverables/traversal-gallery.png`（33 种图表）、`deliverables/pele-vs-mermaid/`（与 mermaid.js 的对比、渲染过程 GIF）。

## 目录结构

```text
dsh-pele/
├── plugin/                     # 可安装的 DSH bundle（plugin_manager install_bundle 的目标）
│   ├── index.js                # Host 半身：pele_draw 工具（渲染/presentationMeta/系统提示/错误诊断）
│   ├── render.js               # 纯渲染层（vendored pele + 清洗 + 错误信息），可离线单测
│   ├── client.js               # 浏览器半身：tool.call.toolview（key=pele_draw）内联卡片 + 交互查看器 + SVG/PNG 下载菜单
│   ├── cordis.patch.yml        # bundle patch：插入 id=pele 的插件行 + 默认 config
│   ├── package.json            # dsh.bundle.patch + dsh.client(platform=web)
│   ├── locale/{zh,en}.json     # Plugin Manager 显示元数据
│   ├── icon.svg                # 插件图标（原创）
│   └── vendor/pele.js          # vendored pele 1.12.0 ESM 构建（MIT，见 pele.LICENSE）
├── scripts/
│   ├── selftest.mjs            # 离线渲染自检：23 种图表 + 错误路径（含 mindmap 关键字坑）
│   ├── card-ssr-test.mjs       # 卡片组件 SSR 测试：注册契约 + 三阶段渲染 + 清洗 + 下载入口 + 查看器控件
│   ├── build-gallery.mjs       # 把 33 种遍历结果生成为视觉索引页
│   └── build-render-demo.mjs   # 「pele vs mermaid.js / 渲染过程」演示页生成
├── research/                   # pele API/客户端契约调研、33 种图表语料与遍历报告
├── deliverables/               # 截图与演示产物（卡片效果、下载菜单、交互查看器、遍历画廊、对比图与 GIF）
├── docs/icon-180.png           # 市场卡片图标（180×180 PNG）
├── CHANGELOG.md
└── LICENSE                     # MIT
```

## 安装 / 卸载

```bash
# 1) 拿到仓库并进入目录（示例）
git clone https://github.com/hesheng01/dsh-pele.git dsh-pele
cd dsh-pele

# 2) 安装（plugin_manager 内部会调用 pnpm 完成 profile 依赖与 bundle 选择）
# 在 DSH 会话里调用 plugin_manager:
#   action=install_bundle, target=<绝对路径>/dsh-pele/plugin
#
# 命令行等价：
dsh plugin --profile web add <绝对路径>/dsh-pele/plugin
```

- 首次接入需要 Host 重启；之后修改 `plugin/*.js` 时，Plugin Manager 的 profile 重组（或 HMR 监听目录）会在下一次重组时替换宿主模块。
- 卸载：`plugin_manager action=remove_bundle, target=dsh-pele`（并移除 profile 依赖）。

## 用法

在会话里直接让模型画图，例如：

> 用 pele 画一张登录流程图，标题「登录流程」。

模型会调用：

```jsonc
pele_draw({
  "diagram": "flowchart LR\n  A[开始] --> B{已登录?}\n  B -->|是| C[进入首页]\n  B -->|否| D[登录页]",
  "title": "登录流程"    // 可选：卡片标题与下载文件名
})
```

工具结果只包含摘要（类型/尺寸/字节），**SVG 不进入模型上下文**：它通过 `output.presentationMeta` 持久化在 `tool/result` 的 `meta` 字段，由客户端卡片读取并内联渲染；需要文件时由用户点卡片右上角下载，插件本身不写工作区。

- 支持 pele 1.12.0 的全部 33 种 Mermaid 12.1 图表类型：flowchart、sequenceDiagram、classDiagram、stateDiagram-v2、erDiagram、gantt、pie、quadrantChart、xychart-beta、mindmap、timeline、journey、gitGraph、sankey-beta、block-beta、packet-beta、kanban、architecture-beta、radar-beta、treemap、info、agentflow、usecase、railroad、treeView、venn、cynefin、wardley、swimlane、ishikawa、eventmodeling、C4、requirementDiagram。
- 语法错误会返回 Mermaid 行号/列号与片段，模型可自行修正后重试。
- 卡片跟随 DSH 明/暗主题：pele 的 `--pele-*` 颜色变量映射到 `--dsw-alias-*` 主题 token，同一份 SVG 无需重渲染。
- 卡片显示：标题/类型、尺寸与体积徽章、可交互 SVG；右上角下载菜单提供「下载 SVG」（主题中立的矢量图）与「下载 PNG」（跟随当前明/暗主题、2x 栅格化、背景取卡片背景）；图表采用「点击激活」交互：点击后可用滚轮缩放、右键拖动、左键框选、中键复位与全屏查看，未激活时滚轮滚动页面。

## 系统提示（prompt）

插件会在 Agent 的系统提示里注入一段 `## 图表（pele_draw）` 说明（`config.prompt: true` 时），点明：何时该用 pele_draw、首行必须是图表类型关键字、一张图一次调用、mindmap 节点文本不要以 `mindmap` 开头、语法错误按行号修正、不要在回复里重复粘贴 SVG。文本是静态的（不破坏请求前缀的 KV 缓存），且工具对某 Agent 不可见时自动为空。

> 备注：mindmap 里「节点文本以 mindmap 开头」是 pele/Mermaid 词法器的已知坑（`Mindmap`/`MINDMAP` 同样中招），会被词法成 `MINDMAP` 关键字导致 `got 'MINDMAP'` 语法错误。可写成「思维导图 mindmap」、加引号 `"mindmap"`，或用 `mm[mindmap]` 形式。

## 配置（web profile 的 `cordis.patch.yml`，按行 id `pele` 覆盖）

```yaml
- id: pele
  config:
    maxSourceBytes: 200000           # Mermaid 源码上限
    maxSvgBytes: 1500000             # SVG 输出上限（超过拒绝）
    maxInlineSvgBytes: 512000        # 允许内联进会话卡片的 SVG 上限（超过时卡片提示图表过大）
    timeoutMs: 20000                 # 工具调用超时
    prompt: true                     # 是否注入「何时/如何调用 pele_draw」系统提示
```

## 验证

| 项目 | 结果 | 方式 |
| --- | --- | --- |
| 离线渲染自检 | 23/23 通过 + 4 类错误路径 + 对比度校正断言 | `node scripts/selftest.mjs` |
| 卡片组件 SSR 测试 | 14/14 通过（含默认未激活/查看器可聚焦/激活提示/下载入口/菜单默认关闭/无 SVG 不显示/配色断言） | `node scripts/card-ssr-test.mjs` |
| 33 类语料遍历 | 33/33 图表类型成功，0 失败 | `node scripts/build-traversal-report.mjs`（与 `pele_draw` 同一渲染链路），报告见 `research/traversal-report.json` |
| 渲染结果视觉核验 | 33 种图表全部正确渲染 | `deliverables/traversal-gallery.png`（由 33 个真实 SVG 内联生成） |
| 客户端注册 | `tool.call.toolview` 中 `pele_draw` 卡片 active | `cordis_inspect_query` 实时查询 |
| 下载功能（真实浏览器） | 菜单导出 SVG（5.4 KB）与 PNG（1546×312，2x）均成功 | 临时实例中点击卡片下载菜单，校验文件头/尺寸 |
| 交互查看器（真实浏览器） | 滚轮缩放 / 中键复位 / 右键平移 / 左键框选 / 全屏 + Esc 关闭全部通过 | 临时实例中驱动真实鼠标事件，读取查看器缩放/位置状态 |
| 渲染器版本与升级兼容性 | `info` 图输出 `Pele v1.12.0`；33/33 语料在 1.12.0 下尺寸与 1.10.0 完全一致 | 会话内渲染 `info` 图表并读 `tool/result.meta`；`node scripts/build-traversal-report.mjs` |

复跑：

```bash
npm test            # 离线渲染自检（= node scripts/selftest.mjs）
npm run test:ssr    # 卡片 SSR 测试（需要 .probe/ssr 下的 react/react-dom）
npm run gallery     # 由 research/traversal-report.json 生成视觉索引页
npm run demo        # 生成 pele vs mermaid.js 对比页与渲染过程页
```

## 实现要点

1. **为什么 SVG 走 `presentationMeta`**：SVG 通常几 KB～几十 KB，直接进模型上下文会浪费 token 且干扰推理；`meta` 只持久化在会话事件上供 Client 渲染器读取。`output.schema` 里保留 `svg` 字段作为 canonical 值的一部分，`render()` 只输出摘要。
2. **主题**：pele 的 SVG 全部用 `var(--_x)` → `var(--pele-x, 回退)` 取色；卡片在容器上覆盖 `--pele-*` 为 `--dsw-alias-*`，明暗主题自动跟随，无需重渲染。其中 `--pele-bg` 必须映射为**卡片底色**而不是 transparent：pele 给每个边标签画了 `fill=var(--_bg)` 的背景矩形，透明会让连线从标签文字中间穿过（对比见 `deliverables/effect-label-background.png`）。
3. **安全**：Host 与 Client 各做一次清洗（去除 `<script>`/`<foreignObject>`/内联事件/`javascript:` 链接）；Client 要求 SVG 以 `<svg` 开头且 ≤600KB；插件不写工作区文件，导出只在浏览器端由用户点击触发。
4. **下载**：SVG 直接导出 Host 渲染的原始 SVG；PNG 先在浏览器里克隆当前渲染的 `<svg>`，把继承来的主题 CSS 变量固化成内联值，再按 2x（超长边/超面积自动降级）画到 canvas，背景取卡片背景色。
5. **确定性**：每张图用源码 sha1 生成 `idPrefix`（注意：pele 渲染输出实际不使用它，同页多图内部 id 可能重复，见已知限制）。
6. **工具 schema**：`output.schema` 使用 dsh-tools 的「值 schema DSL」（必填标记写在属性上），不是原始 JSON Schema。
7. **固定填充色的文字对比度**：模型常用 `classDef` 给节点指定填充色（如 `fill:#fecaca`），而标签文字默认继承主题文字色——夜间模式下浅色填充 + 浅色文字几乎看不清。Host 渲染后按填充色的相对亮度自动给标签注入深/浅高对比文字色（作者显式写的 `color` 不覆盖），对比图见 `deliverables/effect-dark-contrast.png`。

## 已知限制

- Host 端 pele 布局使用内置近似字宽表（不依赖浏览器字体）；若同一 SVG 在客户端用差异很大的字体栈渲染，长标签可能轻微溢出——卡片已把 `--pele-font` 固定为与 Host 一致的字体栈。
- 超宽图在卡片中按 `max-width:100%` 等比缩小；图表较大时卡片主体可滚动。
- 下载的 SVG 使用 pele 的浅色回退配色（主题中立，任何查看器都能看清）；PNG 才渲染当前明/暗主题。
- 会话 Turn 落定后，DSH 会把较早的工具行折叠进 Turn-process 分组（宿主行为，非插件问题）。
- 同一页面同时出现多张 pele SVG 时，SVG 内部的元素 id（如 `U`/`A`/`D`）可能重复：pele 渲染器不使用我们传入的 `idPrefix` 作为元素 id（1.9–1.12 实测如此），目前不影响显示，属于记录在案的已知限制。
- 交互查看器以鼠标操作为主（滚轮缩放、右键拖动、左键框选）；触控板捏合与触屏手势未做专门适配。
- 文字对比度校正只处理「节点填充色 + 标签文字」这一组合；作者显式指定文字颜色时保持作者选择。

## 许可

- 本插件：MIT，见 [`LICENSE`](LICENSE)。
- vendored `pele` 1.12.0：MIT，版权 kepano / obsidianmd，见 [`plugin/vendor/pele.LICENSE`](plugin/vendor/pele.LICENSE)。
