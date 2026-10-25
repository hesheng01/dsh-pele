# pele 1.9.0 API 与行为研究

> 目标插件：`dsh-pele`（把 Mermaid 文本渲染成主题化 SVG 的 DSH 插件）。
> 研究对象：npm 包 `pele@1.9.0`（obsidianmd/pele，MIT，作者 kepano，<https://pele.run>）。
> 解包位置：`.probe/package/`；本文所有结论都有可复跑的探针脚本或真实渲染样本支撑。

---

## 0. 结论速览（TL;DR）

1. **Node 侧可以完整使用 `render()`**（无 DOM 依赖、无运行时依赖、ESM、Node ≥ 20）。`mount()` / `enableZoom()` 只能在浏览器用。
2. **主入口 `import { render } from 'pele'` 注册全部 33 种图表类型**；`pele/core` 什么都不注册（省体积），用 `register()` + `pele/diagrams/*` 按需加载；`pele/lazy` 提供 `renderAsync` 动态加载。
3. **`render()` 是同步的，返回 `{ svg, width, height, links, type, mermaidType }`；出错抛 `PeleError`**（`code ∈ {unsupported-diagram, syntax, semantic, limit}`），不是返回 error 对象。
4. **颜色/字体全部通过 CSS 变量引用**（`fill="var(--_s)"`、`font-family:var(--pele-font,…)`），所以宿主 Node 渲染出的 SVG 在客户端注入后，**改祖先上的 `--pele-*` 变量即可换主题，无需重新渲染**。这是「Host 渲染 + Client 注入」方案成立的关键。
5. **Node 与浏览器的排版几乎一致但不保证逐像素一致**：33 个真实样本中 30 个宽高完全相同，3 个差 1px；字体族选项在 Node 不影响排版（无 canvas，用内置字宽表），浏览器用 canvas `measureText`。
6. **必须在宿主侧处理的风险**：`idPrefix` 冲突（默认都是 `pele`）、gantt 的 `today` 标记用宿主时钟、字体栈不同可能导致文字溢出（同一份 SVG 在 `--pele-font: monospace` 下文本最宽 +36%）、`A@{ img: ... }` 在 Node 中固定 80×80、错误必须由宿主捕获。
7. **尺寸/体积**：`dist/pele.js` 702 KB（gzip 262 KB）、`dist/pele.global.js` 706 KB（gzip 263 KB）；渲染一个典型流程图 SVG 约 2–6 KB。
8. **安全默认值**：源码上限 50 000 字符、SVG 输出上限 4 000 000 字符、flowchart 边数上限 5 000；文本转义、URL scheme 白名单、style 属性白名单；`icons`/`math` 回调的输出是**原样注入**（只可传可信内容）。

---

## 1. 验证方法与证据

| 证据 | 位置 | 说明 |
|---|---|---|
| Node 探针（可复跑） | [`research/pele-node-probe.mjs`](./pele-node-probe.mjs) | 每次运行会打印本文所有 `[probe]` 结论，并重写 `research/samples/` |
| 真实渲染样本（33 个） | [`research/samples/`](./samples/) + [`manifest.json`](./samples/manifest.json) | 每个类型的真实 SVG、宽高、字节数 |
| 浏览器探针（可复跑） | [`research/browser-probe.html`](./browser-probe.html) | 在真实 Chromium 中验证全局构建、`mount()`、主题变量、错误 UI、注入缩放、字体风险；结果写入 `window.__BROWSER_RESULTS__` |
| 记录值 | 本文表格 | Node v26.12.1；浏览器 HeadlessChrome 156（Playwright，Linux） |

复跑命令：

```sh
# Node 探针（会写 research/samples/，加 --no-write 只打印不落盘）
node research/pele-node-probe.mjs

# 浏览器探针：从仓库根起一个静态服务器，再打开页面
python3 -m http.server 8000
# http://127.0.0.1:8000/research/browser-probe.html
```

文中 `[probe: xxx]` 表示该结论由探针中同名小节打印。

---

## 2. 包结构与体积

`package.json` 关键字段：

```json
{
  "name": "pele", "version": "1.9.0", "license": "MIT", "type": "module",
  "main": "./dist/pele.js", "types": "./dist/index.d.ts",
  "engines": { "node": ">=20" },
  "dependencies": {}          // 无运行时依赖（devDependencies 才有构建工具）
}
```

`exports` 映射：

| 子路径 | 实际文件 | 用途 |
|---|---|---|
| `pele`（`.`） | `dist/pele.js`（ESM）+ `dist/index.d.ts` | 主入口，**注册全部 33 种类型** |
| `pele/core` | `dist/esm/core.js` | 只有通用 API，**不注册任何图表类型** |
| `pele/lazy` | `dist/esm/lazy.js` | 额外提供 `renderAsync` / `mountAsync` / `load`，按需动态 import |
| `pele/diagrams/*` | `dist/esm/diagrams/*.js`（默认导出 `Diagram`） | 33 个图表实现，交给 `register()` |
| `pele/global` | `dist/pele.global.js` | 浏览器 IIFE：`var pele = (() => {…})()` → `window.pele` |
| `pele/package.json` | — | 元数据 |

体积（构建目录 `.probe/package/dist/`）：

| 文件 | 原始 | gzip -9 | 备注 |
|---|---:|---:|---|
| `pele.js`（ESM 主入口） | 701 816 B | 261 880 B | 含全部 33 种图表 |
| `pele.global.js`（IIFE） | 706 153 B | 262 733 B | 首行 banner `/*! Pele 1.9.0 | MIT License */` |
| `esm/core.js` | 347 B | 240 B | 只是 re-export 聚合 |
| `esm/lazy.js` | 3 011 B | 1 106 B | 动态 import 分块 |
| `esm/` 全部 chunk | 725 314 B | — | 89 个内部 chunk，实现细节，不建议深依赖 |

> **对插件的含义**：如果采用「Host 渲染」，客户端**不需要**安装/打包 pele（省 ~262 KB gzip）；只有宿主 Node 侧需要这个包。若想在客户端做 `mount()` 自适应重排版，才需要把 pele 带进客户端 bundle。

---

## 3. 公共 API 参考

### 3.1 顶层导出（`import * as pele from 'pele'`）

```ts
// 运行时导出（[probe: exports]，主入口/global/core 完全一致）
export function render(source: string | DiagramModel, options?: RenderOptions): RenderResult;
export function parse(text: string, options?: ParseOptions): ParsedDiagramModel;
export function mount(element: HTMLElement, text: string, options?: MountOptions): Mounted;
export function register(...list: Diagram<any>[]): void;
export function registered(type: DiagramType): boolean;
export function detectType(text: string): DiagramType | null;
export function supports(text: string): boolean;
export function forgetTextWidths(): void;
export function enableZoom(element: HTMLElement, options?: ZoomOptions): Zoom;
export class PeleError extends Error { code; type; mermaidType; line; column; snippet }
// 类型导出（仅类型，编译期）：DiagramType, MermaidType, TextMeasurer, IconResolver,
// LinkInfo, MathMarkup, MathResolver, RenderOptions, RenderResult, Diagram,
// MountOptions, Mounted, Zoom, ZoomOptions, DiagramModel?, PeleErrorCode
```

注意：

- 顶层**没有** `createDiagram`、没有 DOM shim、没有 CSS 文件；一切样式都写进 SVG 的 `style`/`fill`/`stroke` 属性里。
- `pele/global` 暴露同样的 10 个运行时成员（[probe: entries] / [browser-probe]）。
- `parse()` 返回的 model 是普通对象（可 `JSON.stringify`），但**不能**跨库实例/跨进程还原：`render(model)` 依赖内部 `WeakMap`，只能把 `parse()` 的返回值在同一库实例里传回 `render()`；传其它对象会抛 `TypeError: render() takes diagram text or a model that parse() returned.`

### 3.2 核心类型

```ts
interface RenderResult {
  type: DiagramType;        // 'flowchart' | 'sequence' | ... 33 种
  mermaidType: MermaidType; // 'flowchart-v2' | 'sequence' | ... 检测命中项
  svg: string;              // 完整 <svg …>…</svg> 字符串
  width: number;            // 与 svg 的 width 属性一致（整数 px）
  height: number;
  links: LinkInfo[];        // 图内可点击链接
}

interface LinkInfo {
  id: string;               // 触发链接的节点/任务 id
  href: string;             // 已通过 scheme 过滤、实体解码后的 URL
  internal: boolean;        // true = 来自 :::internal-link（笔记内链，如 Obsidian）
}
```

```ts
interface RenderOptions {
  measurer?: TextMeasurer;      // 自定义文本测量
  fontFamily?: string;          // 默认 'sans-serif'
  fontFamilyMono?: string;      // 默认 'monospace'
  fontSize?: number;            // 默认 16
  idPrefix?: string;            // 默认 'pele'；用于 <title id> / <desc id>
  responsive?: boolean;         // 默认 true（config 里 useMaxWidth:false 时默认变 false）
  maxWidth?: number;            // 宽度提示，见 §4.2
  autoDirection?: boolean;      // 默认 true
  directionBreakpoint?: number; // 默认 640
  padding?: number;             // 默认 8
  limit?: number;               // 源码字符上限，默认 50000
  outputLimit?: number;         // 输出 SVG 字符上限，默认 4000000
  maxEdges?: number;            // 边数上限，默认 5000（仅 flowchart 解析器强制）
  linkSchemes?: string[];       // 默认 ['http','https','mailto','tel']
  imageSchemes?: string[];      // 默认 ['http','https']
  links?: boolean;              // 默认 true；false 时完全不生成 <a>
  images?: boolean;             // 默认 true
  linkRel?: string;             // 默认 'noopener'；'' = 不输出 rel
  icons?: IconResolver;         // (name) => string|null|undefined，原样注入
  math?: MathResolver;          // (tex, size) => {svg|html,width,height}|null|undefined
  config?: Config;              // Mermaid 风格配置对象（按图表 section 读取）
  now?: number | Date;          // 仅 gantt 的 today 标记使用
}
```

```ts
interface MountOptions extends RenderOptions {
  onRender?: (result: RenderResult) => void;
  onError?: (error: unknown) => void;
  sanitize?: (svg: string) => Node;   // 返回 DOM Node，mount 用 replaceChildren 放入
  zoom?: boolean | 'auto' | ZoomOptions;  // 默认 'auto'
}
interface Mounted {
  readonly result: RenderResult | undefined;
  readonly source: string;
  readonly error: unknown;
  readonly zoom: Zoom | undefined;
  update(text: string, options?: MountOptions): void;
  refresh(): void;
  destroy(): void;
}
interface ZoomOptions { always?: boolean; maxScale?: number; controls?: boolean;
  labels?: { zoomIn?: string; zoomOut?: string; reset?: string } }
interface Zoom { readonly scale: number; readonly fit: number;
  zoomBy(factor: number): void; zoomTo(scale: number): void; reset(): void;
  refresh(): void; destroy(): void }
```

```ts
interface TextMeasurer { width(text: string, size: number, style: number): number }
// style 位标志（d.ts 的 const enum Style，运行时是数字）：
// Bold=1, Italic=2, Mono=4, Sub=8, Sup=16, Underline=32

type IconResolver = (name: string) => string | null | undefined;
type MathResolver = (tex: string, size: number) =>
  | { svg: string; width: number; height: number }
  | { html: string; width: number; height: number }
  | null | undefined;

interface Diagram<Model> {
  type: DiagramType;
  section?: string;       // config 中对应的 key（如 xychart → 'xyChart'）
  keepComments?: boolean;
  math?: boolean;
  parse(source: string, config: Config, title: string | undefined,
        lineOffset: number, limits: { maxEdges: number }): Model;
  render(model: Model, config: Config, options: RenderOptions): Rendered;
}
```

### 3.3 各函数语义

| 函数 | 语义与注意点 |
|---|---|
| `render(source, options)` | 完整流程：预处理（去注释/解析 front matter/编码实体）→ 检测类型 → 查注册表 → parse → layout/render → 检查 `outputLimit` → 实体解码链接 id。**同步、纯（无 DOM）**。`source` 也可以是 `parse()` 的返回值（此时 `limit`/`config` 用 parse 时的，render 选项仍生效）。`[probe: render options: defaults]` |
| `parse(text, options?)` | 只做 parse，返回 model，并在 model 上附加可枚举的 `mermaidType` 属性；`options = {limit,maxEdges,config}`。`[probe: misc]` |
| `detectType(text)` | 只看首行（预处理后）返回 `DiagramType \| null`，不校验语法。37 个检测模式 → 33 个类型（`flowchart-elk`/`railroad-*` 归并）。`[probe: detectType / supports]` |
| `supports(text)` | `detectType(text) !== null && registered(type)`，**不保证能 parse**（语法错误也返回 true）。空串返回 false。`[probe: misc]` |
| `register(...diagrams)` | 把 `Diagram` 实现写入注册表，同 `type` 后者覆盖前者（可用于替换实现）。custom `type` 无法被 `detectType` 命中，所以自定义类型实际不可路由。`[probe: misc]` |
| `registered(type)` | 注册表查询，仅此。 |
| `forgetTextWidths()` | 清空浏览器 canvas 文本测量缓存（字体变化后调用）；Node 下是空操作。 |
| `mount(element, text, options)` | 浏览器 DOM API，见 §6。Node 下抛 `TypeError`。 |
| `enableZoom(element, options)` | 给已含 `<svg>` 子元素的容器加缩放控件，见 §6.3。 |

### 3.4 子路径入口

```ts
// 1) 全量（推荐宿主 Node 用，简单）
import { render } from 'pele';

// 2) core + 手动注册（减小 bundle；宿主/客户端都可用）
import { register, render, ... } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';
import sequence from 'pele/diagrams/sequence';
register(flowchart, sequence);
// 未注册就 render → PeleError code='unsupported-diagram',
// message: `Diagram type "flowchart" is not supported yet.`

// 3) lazy：按需动态 import 图表实现（异步）
import { renderAsync, load } from 'pele/lazy';
const { svg } = await renderAsync(text);
// load(type: DiagramType|null) => Promise<boolean>，在 renderAsync 内部使用

// 4) 浏览器全局
<script src="https://cdn.jsdelivr.net/npm/pele@1/dist/pele.global.js"></script>
<script>const { svg } = pele.render(text);</script>
```

`pele/diagrams/*` 可用名（33 个，默认导出）：`agentflow, architecture, block, c4, class, cynefin, er, eventmodeling, flowchart, gantt, gitGraph, info, ishikawa, journey, kanban, mindmap, packet, pie, quadrantChart, radar, railroad, requirement, sankey, sequence, state, swimlane, timeline, treemap, treeView, usecase, venn, wardley, xychart`。
`[probe: entries]` 验证了 core 注册前后行为、lazy 的 `renderAsync` 在 Node 中可用（内部动态 import 分块正常）。

---

## 4. `render()` options 逐字段行为

### 4.1 `padding` / `fontSize` / `fontFamily` / `fontFamilyMono` / `measurer`

| 选项 | 默认 | 实际行为（Node 实测） |
|---|---|---|
| `padding` | `8` | 画布四周内边距，`width += 2*padding` 量级。基准流程图：`padding=0 → 461×113`，`8 → 477×129`，`20 → 501×153`，`40 → 541×193`。`[probe]` |
| `fontSize` | `16` | 所有文字与节点尺寸按比例缩放，写入 SVG 的 `font:16px sans-serif`。基准：`8→351×82`，`16→477×129`，`32→708×211`。`[probe]` |
| `fontFamily` | `'sans-serif'` | **Node：不影响排版**（无 canvas，用内置字宽表；sans-serif/monospace/serif/任意字符串结果完全一致）。浏览器：作为 `var(--pele-font, <该值>)` 的 fallback，并且 `mount()` 优先读取元素 computed style 的 `--pele-font`。`[probe]` + [browser-probe] |
| `fontFamilyMono` | `'monospace'` | 同上，作为 `--pele-font-mono` fallback；影响 `` `code` `` 等 mono span 的字体与浏览器测量。 |
| `measurer` | 浏览器 canvas / Node 内置表 | 自定义 `width(text,size,style)` 会完全接管文本宽度（2× 测量 → 1018×257；0.5× → 501×138）。想精确控制 Node 排版时最可靠的钩子。`[probe]` |

> **Node 字体限制**：`fontFamily` 在 Node 下只写进 CSS fallback，**不改变布局**。如果宿主想按某个具体字体的宽度排版，只能传 `measurer`（例如接入 opentype/fontkit 的字宽表），否则接受内置近似。

### 4.2 `maxWidth` / `autoDirection` / `directionBreakpoint`（行为并不统一，务必读完）

`maxWidth` 是**排版提示**，不是硬性 CSS 上限，且不同图表实现方式不同：

- **flowchart 等图（`autoDirection` 生效）**：先按自然方向排版；若 `naturalWidth > maxWidth` 且 `maxWidth < directionBreakpoint`（默认 640），再尝试**另一方向**（LR↔TB）取更窄者；纯 flowchart 还会在 `maxWidth` 下用“紧凑排版/标签换行”再试一次。
- **图表类（xychart/quadrant/treemap 等）**：用 `maxWidth` 直接夹取画布宽度（`zr()`），更接近真实上限。
- **标签换行**：多数 LLM/流程图型图会把单个 label 的最大宽度限制为 `max(80, maxWidth - 2*padding)`；没有 `maxWidth` 时上限是 4000px。

实测（`WIDE = flowchart LR A→B→C→D→E→F`，自然尺寸 660×64）：

| maxWidth | 80 | 150 | 300 | 600 | 640 | 660 | 700 |
|---|---|---|---|---|---|---|---|
| 输出 | 94×544 | 94×544 | 94×544 | 600×64 | 600×64 | 660×64 | 660×64 |

- `maxWidth=300, autoDirection=false → 600×64`（不切方向，走紧凑排版，**仍然超过 300**）；
- `maxWidth=300, directionBreakpoint=2000 → 94×544`（强制切 TB，因为 300 < 2000）；
- 长标签图：`maxWidth=200~300` 时 label 换行、节点变高（485×82 → 229×196）。
- `[probe: render options: responsive / config / maxWidth / autoDirection]`

> **给插件的建议**：不要把 `maxWidth` 当作“保证 ≤ N px”；需要可靠上限时用 CSS（外层容器 `max-width` + SVG 自带 `max-width:100%;height:auto` 缩放），或接受它的近似行为。`mount()` 里 `maxWidth` 默认取容器可用宽度，也只是“如果更窄就重排”。

### 4.3 `responsive` / `config` / front matter

| 选项 | 行为 |
|---|---|
| `responsive` 默认 | `true`，除非 `config[diagram.section ?? type].useMaxWidth === false`。为 `true` 时 SVG 根节点 `style` 开头是 `max-width:100%;height:auto;`；为 `false` 时没有这两个声明。 |
| `config` | Mermaid 风格对象，按图表 section 读取；已确认的 key 例：flowchart 的 `wrappingWidth`/`nodeSpacing`/`rankSpacing`/`curve`/`useMaxWidth`/`inheritDir`；gantt 的 `barHeight`/`sectionFontSize`/`numberSectionStyles` 等；xychart 的 `width`/`height`/`chartOrientation`/`showDataLabel`/`showLegend`/`showTitle`/`xAxis`/`yAxis` 等。`config.theme` 被**忽略**（实测与不传时 SVG 完全相同）。 |
| front matter | `---\ntitle: …\nconfig:\n  flowchart:\n    useMaxWidth: false\n---` 会被预处理解析：`title` 进图标题、`config` 与 options.config 合并（options 优先）、`displayMode` 映射到 gantt。`[probe]` |

实测：`config.flowchart.nodeSpacing=100/rankSpacing=200` → 477×129 变 781×129；front matter 版本 `responsive` 默认变 `false` 且图内出现标题（高度 129→165）。

### 4.4 `idPrefix` 与无障碍 id

- SVG 里只有 `accTitle`/`accDescr` 会产生 id：`<title id="{idPrefix}-title">`、`<desc id="{idPrefix}-desc">`；无 acc 信息时没有 id。
- `idPrefix` 默认 **`"pele"`**，会被 XML 转义：`a<b&"c` → `id="a&lt;b&amp;&quot;c-title"`。`[probe]`
- `mount()` 每次自动生成唯一前缀 `pele-<随机5位>-<计数器>`，所以同一页多个 mount 不会撞 id；**但多次 `render()` 后自行注入会撞 id**（实测两个图都是 `pele-title`/`pele-desc`）→ 宿主渲染时应按图内容生成唯一 `idPrefix`（如 `pele-<sha1前8位>`）。

### 4.5 `now`（仅 gantt）

- gantt 的“今天”竖线位置由 `now` 决定（`number | Date`），不传则用 **`Date.now()`**（宿主时钟）。实测：`now=2024-01-10` 时 today 竖线 x≈208.82，`now=2024-01-20` 时 x≈388.98；任务区间覆盖当前日期时默认渲染也有 today 线。`[probe: render options: idPrefix / now]`
- `todayMarker` 是**源码指令**（`gantt` 块内写 `todayMarker off` 或 `todayMarker stroke:red`），`config.gantt.todayMarker` **不生效**。`[probe]`
- 对插件：要确定性输出/缓存时请显式传 `now`，或在源码里关掉 today 标记；否则同一份源码在不同时间/时区渲染结果会变。

### 4.6 `links` / `linkSchemes` / `linkRel` / `images` / `imageSchemes`

实测（flowchart 的 `click A "URL"`、`:::internal-link`、`A@{ img: "URL" }`）：`[probe: render options: links / images / security]`

| URL | 链接默认 | 图片默认 |
|---|---|---|
| `https://…` / `http://…` | ✅ | ✅ |
| `mailto:` / `tel:` | ✅ | ❌（图片只允许 http/https） |
| 相对路径 `relative/path` | ✅（无 scheme 视为相对） | ✅ |
| `javascript:` / `data:` / `vbscript:` / `file:` | ❌ 丢弃（无 `<a>`，`links` 为空） | ❌ |
| 协议相对 `//evil.example` | ❌ 丢弃 | ❌ |

- `links:false` → 完全不生成 `<a>`，`links` 数组为空；`linkSchemes:['https']` 会拒绝 http。
- `linkRel` 默认 `"noopener"`；传 `''` 则 `<a>` 上没有 `rel`。`_blank` 目标来自源码 `click A "url" _blank` → `<a target="_blank" rel="noopener">`。
- `:::internal-link` 语法：`A[Note]:::internal-link` → `links=[{id:'A',href:'Note',internal:true}]`，输出 `<a class="internal-link" href="Note" data-href="Note" rel="noopener">`（Obsidian 内链钩子；插件可据此拦截点击或设置 `links:false`）。
- `images:false` / `imageSchemes` 同理；`A@{ img: "https://…" }` 输出 `<image href="…" x="-40" y="-40" width="80" height="80" preserveAspectRatio="none"/>`（**固定 80×80**，Node 不探测图片真实尺寸）。
- 链接 id 在 render 结束前会被实体解码（`&amp;` → `&`），`links[]` 里的 href 已是可用 URL。

### 4.7 `icons` / `math`

- `icons(name => markup | null)`：`name` 已经过实体解码；返回的字符串**原样**塞进 `<svg class="pele-icon" data-icon="…">…</svg>`。只传可信常量/模板，不要直接拼用户输入。`[probe: icons / math / measurer cache]`
- `math(tex, size)`：`$$…$$` 形式的公式（不是 `$…$`）才会调用；返回 `{svg,width,height}` 时直接内联，返回 `{html,width,height}` 时包进 `<foreignObject>`（**原样 HTML**，XSS 风险由调用方负责）。宽度/高度必须是有限正数，否则视为无效。实测 flowchart 标签、class 标签、sequence 消息都可触发；tex/size 正确传入（如 `data-tex="x^2" data-size="16"`）。
- 两者都与 `mount()` 的 `sanitize` 正交：`sanitize` 只处理最终 svg 字符串。

### 4.8 `limit` / `outputLimit` / `maxEdges`

| 选项 | 默认 | 触发点 | 错误 |
|---|---:|---|---|
| `limit` | 50 000 字符 | parse 前；front matter 也计入 | `PeleError code='limit'`，`"Diagram source is longer than the limit of N characters."` |
| `outputLimit` | 4 000 000 字符 | 渲染完成、检查 `svg.length` | `code='limit'`，`"Diagram output is longer than the limit of N characters."` |
| `maxEdges` | 5 000 | **仅 flowchart 解析器**（sequence/class 等忽略） | `code='limit'`，`"Edge limit exceeded. N edges found, but the limit is M."`（文案差 1：加上第 M+1 条边时报 “M edges found”） |
| 嵌套深度 | — | 递归解析抛 `RangeError` 时被捕获 | `code='limit'`，`"Diagram is nested too deeply."`（本次未能稳定复现，见 §13） |
| gantt 计算量 | 4×10⁸ | gantt 调度预算 | `code='limit'`，`"The gantt chart takes too much work to schedule."` |

边界实测：50 000 字符源码可渲染，50 001 被拒；`outputLimit:100` 抛错；`maxEdges:3` + 4 条边时报错。`[probe: errors]`

---

## 5. Node（无 DOM）渲染

**可以完整使用 `render()` / `parse()` / `register()` / `registered()` / `detectType()` / `supports()`**，无需任何 DOM shim（`pele` 无运行时依赖，内部也不 import `jsdom` 之类）。`mount()` / `enableZoom()` 需要真实 `HTMLElement` + `document`，Node 下抛 `TypeError`（`e.addEventListener is not a function` / `Cannot read properties of null`）。`[probe: mount / DOM-only API in Node]`

Node 下的差异/限制（对应「Host 渲染」方案）：

1. **文本测量**：没有 `document`/`OffscreenCanvas`，退化为**内置字宽表**（近似 sans-serif/Helvetica 的每字符宽度，CJK 按固定宽度估算）。
   - `fontFamily`/`fontFamilyMono` 不影响 Node 排版（只写进 SVG 的 CSS fallback）。
   - 想精确排版只能传自定义 `measurer`。
2. **与浏览器的尺寸差异**：33 个真实样本中 30 个宽高**完全一致**；`requirement 300→299`、`treeview 120→119`、`swimlane 313→312`（各差 1px，Chromium 156 + 系统字体）。压力测试（`iiii…`/`WWWW…`/中文/代码片段）差值也 ≤1px。`[browser-probe]`
3. **字体栈变化是更大的风险**：同一份 Node SVG 注入浏览器后，把 `--pele-font` 从 `sans-serif` 换成 `monospace`，相同文本的 `getBBox().width` 最多 **+36%**（70.36→96.02）——布局已按 sans-serif 烘焙，可能溢出节点框（本样本仍有 10px 余量，长标签更危险）。见 §12.3。
4. **图片节点**：固定 80×80（`preserveAspectRatio="none"`），宿主无法知道图片原始宽高；可用 `A@{ img: "…", w: 120, h: 80 }` 设置。
5. **gantt today 标记**：用宿主时钟/时区（除非传 `now`），缓存/重放时要注意。
6. **字体加载**：Node 没有 `document.fonts` 的加载事件；浏览器 `mount()` 会在字体 ready 后自动重排，宿主渲染没有这个环节。
7. **确定性**：同一输入 + 同一 options（含 `idPrefix`）渲染结果逐字节相同（`[probe: misc]`），适合做内容哈希缓存。

---

## 6. 浏览器：全局构建与 `mount()`

### 6.1 全局构建用法

```html
<script src="https://cdn.jsdelivr.net/npm/pele@1/dist/pele.global.js"></script>
<script>
  // window.pele 与 ESM 导出一致（10 个成员）
  const { svg } = pele.render('flowchart LR\n  A --> B');
  document.querySelector('#diagram').innerHTML = svg;
  // 或自动挂载
  for (const el of document.querySelectorAll('pre.mermaid')) pele.mount(el, el.textContent);
</script>
```

- 构建格式：`/*! Pele 1.9.0 … */ "use strict"; var pele=(()=>{…})();`，**不是 UMD**，在 Node 里可以用 `vm.runInContext` 拿到 `ctx.pele`（已实测可 render）。`[probe: entries]`
- 没有配套 CSS 文件；所有样式在 SVG 内联属性里。

### 6.2 `mount(element, text, options)`

`[browser-probe]` 实测（Chromium Headless 156）：

| 行为 | 细节 |
|---|---|
| 返回值 | 同步返回 `Mounted`；解析失败不抛（见错误 UI），除非已存在成功结果的重绘错误。 |
| 默认宽度 | `maxWidth = element.clientWidth - 左右 padding`。先按自然宽度渲染；若比容器宽且 `maxWidth` 会改变布局（内部用 `maxWidth:1` 试渲染判断），再用容器可用宽度重排。`result.width` = 重排后宽度。 |
| 显式 `maxWidth` | 传入后**不再**读取容器宽度（`options.maxWidth` 优先）；布局按该值走 `render()` 的“提示”语义，可能仍比容器宽，交给 SVG 自带 `max-width:100%` 缩放。 |
| `responsive` | 默认 true → SVG 根 `style="max-width:100%;height:auto;…"`，窄容器会等比缩小；`responsive:false` 只去掉这段 CSS，**仍会按容器重排**。 |
| 字体 | 从 `getComputedStyle(element)`（以及第一个子元素）读 `--pele-font` / `--pele-font-mono`，交给 canvas measurer；`document.fonts.ready` 后自动 refresh 重排。 |
| idPrefix | 每次 mount 自动生成唯一 `pele-<rand5>-<counter>`，可在 options 覆盖；`update()` 沿用同一前缀。 |
| 生命周期 | `ResizeObserver` 监听容器尺寸（rAF 节流）→ refresh；`update(text, options?)` 重新 parse+render；`refresh()` 重新测量/重排；`destroy()` 断开 observer/zoom、清 WeakMap，**但不会清空容器子节点**（需要调用方自己清理）。 |
| 未连接/零宽容器 | 初始渲染仍会执行一次（结果可用）；尺寸观察要等元素 connected 且 `clientWidth>0`，之后自动补渲染。实测 detached 容器 `children=1`、`result` 存在。 |
| 错误 UI | 捕获错误 → `Mounted.error` 赋值 → 在容器内插入 `div.pele-error`（内容为 `message` 的第一行+最后一行拼接，`title` 存完整 message，等宽字体、`var(--pele-error,#e45756)`）；已有 `<svg>` 时保留并设 `style.opacity="0.4"`；调用 `onError(error)`。恢复成功会移除错误 div、清 opacity。`[browser-probe]` |
| `sanitize(svg) => Node` | 若提供，`element.replaceChildren(sanitize(svg))`，否则 `element.innerHTML = svg`。实测回调被调用、返回值作为唯一子节点。用于宿主侧 DOMPurify 等策略。 |
| `onRender(result)` | 每次成功绘制后调用，参数即 `RenderResult`（含 `links`）。 |

> 注意：`mount()` 内部走的是 `parse` + `render`，**不额外做 HTML 清洗**；输出本身是转义后的安全 SVG，但 `sanitize` 是给“额外策略”留的钩子。

### 6.3 `enableZoom` / `zoom`

- `enableZoom(element, options?)` 为一个**已经包含 `<svg>` 子元素**的容器加缩放控件；`mount({zoom: …})` 内部会调用它。
- `ZoomOptions`：`always`（默认 false，只有内容溢出才显示控件）、`maxScale`（默认 3）、`controls`（默认 true）、`labels:{zoomIn,zoomOut,reset}`。
- 控件结构：`div.pele-zoom` + 3 个 `button.pele-zoom-in/.pele-zoom-out/.pele-zoom-reset`（内联 SVG 图标，`aria-label`/`title`），位置由 `--pele-zoom-top/right/bottom/left`（默认 `8px/8px/auto/auto`）与 `--pele-zoom-cursor`（默认 `pointer`）控制；另有 wheel/pinch/拖拽平移。
- `Zoom` 对象：`scale`、`fit`、`zoomBy(factor)`、`zoomTo(scale)`、`reset()`、`refresh()`、`destroy()`。
- 默认 `zoom: 'auto'`：**即使不溢出也会创建 Zoom 对象**，只是不渲染控件；`zoom: true` = `always:true`（实测始终有 3 个按钮）。`[browser-probe]`

---

## 7. 主题：CSS 变量、默认值、类名

### 7.1 变量表（README 只列了一部分，下表来自实现反推 + 样本提取）

所有变量都只在**用到时**才写进 SVG 根 `style` 的 `var(--pele-x, 默认值)` fallback，因此“改了变量立刻生效、无需重渲染”只对已写进 SVG 的 var 引用成立；默认值只是 fallback。

| 变量 | 默认 | 作用（实现里的内部别名） |
|---|---|---|
| `--pele-bg` | `#fff` | canvas/边标签背景（`--_bg`） |
| `--pele-fg` | `#1f1f1f` | 根 `fill`、默认文字色（`--_fg`） |
| `--pele-muted` | `#6e6e6e` | 次要文字：cluster 标签、stereotype、done 状态、坐标轴标签等（`--_m`） |
| `--pele-line` | `#1f1f1f` | 连线/箭头/边（`--_l`） |
| `--pele-surface` | `#f3f3f3` | 节点/矩形/扇区等主填充（`--_s`） |
| `--pele-surface-alt` | `#e6e6e6` | 次级填充：gantt excluded/区域、note 等（`--_a`） |
| `--pele-border` | `#8a8a8a` | 节点/框线描边（`--_b`） |
| `--pele-accent` | `#5b7bd5` | 强调色：gantt today 线、活动高亮等（`--_c`） |
| `--pele-radius` | `4px` | 圆角，写作 `style="rx:var(--_r)"`（`--_r`） |
| `--pele-font` | `sans-serif` | 字体栈 fallback（`font-family:var(--pele-font,…)`） |
| `--pele-font-mono` | `monospace` | 等宽字体（`--_fm`） |
| `--pele-title-weight` | `bold` | 图标题字重（`--_tw`，用到标题时才写） |
| `--pele-heading-weight` | `bold` | 标题/层级文字字重（`--_hw`，class 成员等 markdown 标题时写） |
| `--pele-bold-weight` | `bold` | 粗体 span（`--_w`，`<b>bold</b>` 等时写） |
| `--pele-series-1` … `--pele-series-8` | `#4c78a8 #f58518 #54a24b #e45756 #72b7b2 #eeca3b #b279a2 #9d755d` | 图表系列色（pie/xychart/…，`var(--pele-series-N,#…)`） |
| `--pele-critical` | `#e45756` | 关键路径/风险：gantt `crit` 任务、requirement 高风险描边 |
| `--pele-error` | `#e45756` | `mount()` 错误 UI 文字色 |
| `--pele-zoom-top` / `-right` / `-bottom` / `-left` | `8px` / `8px` / `auto` / `auto` | 缩放控件定位 |
| `--pele-zoom-cursor` | `pointer` | 缩放按钮 cursor |

`[probe: theme variables]` + [browser-probe]（浏览器中实际计算的 `fill/stroke/rx/font-family` 均随变量变化）。

> **内部别名 `--_bg/--_fg/--_m/--_l/--_s/--_a/--_b/--_c/--_r/--_fm/--_tw/--_hw/--_w` 是实现细节**：元素属性里写的是它们，SVG 根 `style` 再把它们映射到 `--pele-*`。稳定 API 只有 `--pele-*`。

### 7.2 运行时换主题（不重渲染）

因为每个图形元素写的是 `fill="var(--_s)"` 这类**变量引用**，只要变量作用域覆盖 SVG（祖先元素或 `<svg>` 自身），改值即换色：

```css
.pele-scope {           /* 插件卡片外层容器即可 */
  --pele-bg: #fffcf0;
  --pele-fg: #100f0f;
  --pele-muted: #6f6e69;
  --pele-line: #100f0f;
  --pele-surface: #f2f0e5;
  --pele-surface-alt: #e6e4d9;
  --pele-border: #cecdc3;
  --pele-accent: #205ea6;
  --pele-radius: 4px;
  --pele-font: var(--dsh-font-sans, sans-serif);
  --pele-font-mono: var(--dsh-font-mono, monospace);
}
```

注意：`--pele-font` 改变的是**显示字体**；对 Node 预渲染的 SVG，布局宽度不会跟着变（见 §12.3）。

### 7.3 CSS 类名钩子（样本中出现的主要类）

根：`.pele.pele-<type>`（如 `pele-flowchart`）。

通用：`.pele-nodes` `.pele-node` `.pele-shape-<shape>` `.pele-edges` `.pele-edge` `.pele-edge-labels` `.pele-edge-label` `.pele-marker` `.pele-label` `.pele-title` `.pele-clusters` `.pele-cluster` `.pele-cluster-label` `.pele-icon` `.pele-error` `.pele-zoom(-in/-out/-reset)`。

图表专属（部分）：`.pele-sequence-number` `.pele-message` `.pele-actor` `.pele-class` `.pele-member` `.pele-divider` `.pele-state` `.pele-entity` `.pele-er-name` `.pele-er-type` `.pele-task` `.pele-section` `.pele-today` `.pele-slice` `.pele-legend-item` `.pele-series` `.pele-bars` `.pele-line` `.pele-axis` `.pele-grid` `.pele-plot` `.pele-point` `.pele-commit` `.pele-branch` `.pele-lane` `.pele-event` `.pele-quadrant` `.pele-message` `.pele-sankey-node` `.pele-wardley-*` `.pele-cynefin-*` `.pele-nonterminal` `.pele-tree-file` 等。

这些类名没有文档承诺，跨版本可能变；稳定的是 `--pele-*` 变量与 `.pele` 根类。用 `data-id` 属性可以定位到源节点 id（`data-id="A"`）。

---

## 8. 安全模型

pele 的定位是“可以渲染不可信 Mermaid 文本”，其防护点：

1. **规模限制**：源码 50 000 字符、输出 SVG 4 000 000 字符、flowchart 边数 5 000、gantt 调度预算；`RangeError` 统一转 `PeleError(code='limit')`。
2. **文本转义**：`& < > "` → `&amp; &lt; &gt; &quot;`，控制字符（NUL~C0 等）丢弃；源文本里的 HTML 标签会被标签解析器“消费掉”，不会原样输出（实测 `<script>alert(1)</script>` → 文本 `alert(1)`；`<b>bold</b>` → 粗体 span；`</text><script>x` → 转义为文本）。
3. **URL 过滤**：链接 scheme 白名单（默认 http/https/mailto/tel），图片（默认 http/https）；拒绝 `javascript:`/`data:`/`file:`/`vbscript:`/协议相对 `//`；相对 URL 放行；链接默认加 `rel="noopener"`。
4. **style 过滤**：`style`/`classDef` 等声明只允许白名单属性（形状：fill/fill-opacity/stroke/stroke-width/stroke-dasharray/stroke-dashoffset/stroke-linecap/stroke-linejoin/stroke-opacity/opacity/rx/ry；文本：color/font-size/font-family/font-weight/font-style/text-decoration/letter-spacing/word-spacing/opacity）；值里出现 `url(`、`expression(`、`javascript:`、`@import`、`image-set`、`<>{};\\` 或 `!important` 会被过滤。
5. **明确不设防的扩展点**：`icons` 返回值、`math` 的 `{html}` 返回值都是**原样注入**；`mount()` 的 `sanitize` 是使用方补充策略的钩子。任何来自用户/网络的内容都不应进入这两个 resolver。

**建议**：对不可信输入用 `render(text)` + 默认选项即可；要更严格时：`images:false`、`links:false`（或用 `links` 数组决定是否保留 `<a>`）、不需要图标/公式就不传 resolver；客户端注入时再叠一层 sanitizer（剥 `<script>`/`<foreignObject>`/`on*=`/`javascript:`）。

---

## 9. 支持的图表类型（33 种，全部实测可渲染）

检测模式 37 条 → 33 个 `DiagramType`（`flowchart-elk` 归为 `flowchart`；`railroad-beta`/`railroad-ebnf-beta`/`railroad-abnf-beta`/`railroad-peg-beta` 归为 `railroad`，`mermaidType` 保留细分）。完整列表与探针中的检测头：`[probe: detectType / supports]`。

下表是对每个类型的**真实渲染样本**（`research/samples/*.svg`，Node v26.12.1；SVG 由探针以 `idPrefix=pele-<name>` 生成）：

| # | 文件 | `type` | `mermaidType` | 首行语法 | 宽×高 | 体积 |
|---|---|---|---|---|---|---:|
| 1 | [`flowchart.svg`](./samples/flowchart.svg) | flowchart | flowchart-v2 | `flowchart LR` | 635×152 | 3 359 B |
| 2 | [`sequence.svg`](./samples/sequence.svg) | sequence | sequence | `sequenceDiagram` | 416×321 | 5 111 B |
| 3 | [`class.svg`](./samples/class.svg) | class | classDiagram | `classDiagram` | 178×423 | 3 192 B |
| 4 | [`state.svg`](./samples/state.svg) | state | stateDiagram | `stateDiagram-v2` | 288×457 | 4 997 B |
| 5 | [`er.svg`](./samples/er.svg) | er | er | `erDiagram` | 333×446 | 5 078 B |
| 6 | [`gantt.svg`](./samples/gantt.svg) | gantt | gantt | `gantt` | 800×227 | 3 548 B |
| 7 | [`pie.svg`](./samples/pie.svg) | pie | pie | `pie showData` | 392×296 | 2 971 B |
| 8 | [`xychart.svg`](./samples/xychart.svg) | xychart | xychart | `xychart-beta` | 700×500 | 2 957 B |
| 9 | [`mindmap.svg`](./samples/mindmap.svg) | mindmap | mindmap | `mindmap` | 629×156 | 3 970 B |
| 10 | [`timeline.svg`](./samples/timeline.svg) | timeline | timeline | `timeline` | 800×221 | 4 639 B |
| 11 | [`journey.svg`](./samples/journey.svg) | journey | journey | `journey` | 808×327 | 5 891 B |
| 12 | [`gitgraph.svg`](./samples/gitgraph.svg) | gitGraph | gitGraph | `gitGraph` | 292×141 | 3 703 B |
| 13 | [`quadrant.svg`](./samples/quadrant.svg) | quadrantChart | quadrantChart | `quadrantChart` | 500×500 | 2 950 B |
| 14 | [`requirement.svg`](./samples/requirement.svg) | requirement | requirement | `requirementDiagram` | 300×378 | 3 759 B |
| 15 | [`c4.svg`](./samples/c4.svg) | c4 | c4 | `C4Context` | 904×144 | 3 338 B |
| 16 | [`sankey.svg`](./samples/sankey.svg) | sankey | sankey | `sankey-beta` | 616×416 | 3 538 B |
| 17 | [`block.svg`](./samples/block.svg) | block | block | `block-beta` | 426×124 | 2 105 B |
| 18 | [`packet.svg`](./samples/packet.svg) | packet | packet | `packet-beta` | 1 035×164 | 1 916 B |
| 19 | [`kanban.svg`](./samples/kanban.svg) | kanban | kanban | `kanban` | 640×105 | 2 472 B |
| 20 | [`architecture.svg`](./samples/architecture.svg) | architecture | architecture | `architecture-beta` | 302×148 | 3 363 B |
| 21 | [`radar.svg`](./samples/radar.svg) | radar | radar | `radar-beta` | 498×387 | 2 468 B |
| 22 | [`treemap.svg`](./samples/treemap.svg) | treemap | treemap | `treemap` | 656×416 | 2 348 B |
| 23 | [`info.svg`](./samples/info.svg) | info | info | `info` | 97×40 | 770 B |
| 24 | [`agentflow.svg`](./samples/agentflow.svg) | agentflow | agentflow | `agentflow-beta LR` | 784×64 | 2 638 B |
| 25 | [`usecase.svg`](./samples/usecase.svg) | usecase | usecase | `usecase-beta` | 280×255 | 2 853 B |
| 26 | [`railroad.svg`](./samples/railroad.svg) | railroad | railroadEbnf | `railroad-ebnf-beta` | 324×307 | 3 802 B |
| 27 | [`treeview.svg`](./samples/treeview.svg) | treeView | treeView | `treeView-beta` | 120×184 | 1 689 B |
| 28 | [`venn.svg`](./samples/venn.svg) | venn | venn | `venn-beta` | 504×351 | 1 710 B |
| 29 | [`cynefin.svg`](./samples/cynefin.svg) | cynefin | cynefin | `cynefin-beta` | 656×492 | 7 198 B |
| 30 | [`wardley.svg`](./samples/wardley.svg) | wardley | wardley | `wardley-beta` | 846×610 | 3 446 B |
| 31 | [`swimlane.svg`](./samples/swimlane.svg) | swimlane | swimlane | `swimlane-beta LR` | 313×208 | 2 304 B |
| 32 | [`ishikawa.svg`](./samples/ishikawa.svg) | ishikawa | ishikawa | `ishikawa-beta` | 630×236 | 3 163 B |
| 33 | [`eventmodeling.svg`](./samples/eventmodeling.svg) | eventmodeling | eventmodeling | `eventmodeling` | 454×227 | 4 200 B |

补充：

- **不是**所有 Mermaid 语法都支持；pele 以 Mermaid 12.1.0 语法为目标（README 自述），但布局/视觉是自研的，某些特性（如 `flowchart-elk` 的 elk 布局、部分主题配置）不会 1:1 复刻。
- 部分新类型（`usecase-beta`、`agentflow-beta`、`cynefin-beta`、`swimlane-beta`、`eventmodeling`、`railroad-*-beta`、`treeView-beta`、`venn-beta`、`wardley-beta` 等）是 pele 的扩展/试验语法，样本里的写法来自探针逆向验证；**它们的完整语法不在本文承诺范围**（见 §13）。
- 同一文本的 `type` 与 `mermaidType` 可能不同（如 `flowchart-elk LR` → `type='flowchart'`, `mermaidType='flowchart-elk'`）。

---

## 10. 错误处理

### 10.1 错误对象形状

`PeleError extends Error`：

```ts
class PeleError extends Error {
  name: 'PeleError';
  code: 'unsupported-diagram' | 'syntax' | 'semantic' | 'limit';
  type: string | null;        // DiagramType（可能为 null）
  mermaidType: string | null; // 细分语法（可能为 null）
  line: number;               // 1-based；无位置信息时为 0
  column: number;             // 1-based；无位置信息时为 0
  snippet: string;            // 多行：出错行 + 连字符 + `^`（语法错误时非空）
}
```

- 所有字段都是**自有可枚举属性**；`instanceof Error` 为 true。
- dist 构建里 `constructor.name` 是压缩后的 `Ke`（lazy 入口里是 `b`）——**不要用 `constructor.name` 判断类型**，用 `name === 'PeleError'` 或 `instanceof PeleError`（从同一入口导入）。
- **没有** `cause`；`message` 里已包含面向用户的解释（可多行）。

### 10.2 触发矩阵（`[probe: errors]`）

| 场景 | 错误 |
|---|---|
| 空输入 / 首行无法识别类型 | `code='unsupported-diagram'`, `"No diagram type detected for the given text."` |
| `pele/core` 未注册该类型 | `code='unsupported-diagram'`, `"Diagram type \"flowchart\" is not supported yet."`，并带 `type` |
| 语法错误 | `code='syntax'`，`message` 形如 `Parse error on line 2:\n  A --> --> B\n--------^\nExpecting 'NODE_STRING', got 'LINK'`，`line/column/snippet` 齐全 |
| 语义错误（pie 负值、未知 shape、未知引用…） | `code='semantic'`，`line/column` 通常为 0（部分带位置） |
| 源码超 `limit` | `code='limit'`, `type=null` |
| SVG 超 `outputLimit` | `code='limit'`, `type=<图表类型>` |
| flowchart 边数超 `maxEdges` | `code='limit'`, `type='flowchart'` |
| gantt 计算量超预算 | `code='limit'`, `type='gantt'` |
| 递归过深（RangeError） | `code='limit'`, `"Diagram is nested too deeply."`（未稳定复现，见 §13） |
| `render({})`（非 parse 产物） | **`TypeError`**（程序员错误，不是 `PeleError`） |

### 10.3 调用方建议

```ts
import { render, PeleError, detectType, supports } from 'pele';

try {
  const { svg, width, height, type, links } = render(text, { idPrefix: `pele-${hash(text)}` });
  return { svg, width, height, type, links };
} catch (e) {
  if (e instanceof PeleError) {
    switch (e.code) {
      case 'syntax':
      case 'semantic':
        // 用户输入问题：把 e.message / line / column / snippet 展示给用户（snippet 已带 ^ 定位）
        break;
      case 'unsupported-diagram':
        // 不是 Mermaid 图表：直接显示纯文本/代码块
        break;
      case 'limit':
        // 内容过大/过深：提示用户缩小图表，或按配置调大 limit/outputLimit
        break;
    }
  }
  throw e; // TypeError 等属于插件 bug
}
```

- 只想“是不是 Mermaid”时可先 `detectType(text)` / `supports(text)`；注意 `supports()` 只判断类型已注册，**不保证语法正确**。
- `mount()` 场景不要让错误冒泡：传 `onError` 并用 `Mounted.error` 判断，UI 已有内建错误条。
- 展示错误时建议只显示 `message`（含 `snippet` 时可读性好），不要 `eval` 或把源文本当 HTML 插入。

---

## 11. 体积与性能

- 包本身：主入口 702 KB 原始 / 262 KB gzip；全局构建 706 KB / 263 KB。33 种类型全量。
- 输出 SVG：本文 33 个样本 770 B–7 198 B（多数 2–5 KB），远小于源文本+主题 CSS 的组合，适合内联到消息/卡片。
- 渲染速度：pele 是同步手写解析器 + 自研布局（无 dagre/mermaid 运行时依赖）。本文**没有**做正式 benchmark（README 提到 `npm run bench:mermaid` 需要 Chrome，本环境未跑），因此不对性能数字下结论。
- 宿主 Node 每渲染一次的开销远小于一次工具调用的网络/模型开销；按“内容哈希 → SVG”缓存收益明显。

---

## 12. 「Host 侧 Node 渲染 SVG + 浏览器侧注入」方案注意事项（重点）

整体可行，且 pele 的设计（CSS 变量主题 + 自带 `max-width:100%`）正好契合。按重要度列出：

### 12.1 必须做

1. **每个图唯一 `idPrefix`**。`render()` 默认 `"pele"`；多个图注入同一页面会出现重复 `id="pele-title"`/`pele-desc`，破坏 `aria-labelledby`。用内容哈希/图 id 生成，如 `idPrefix: 'pele-' + sha1(text).slice(0,8)`。`[browser-probe: renderDuplicateIds]`
2. **在宿主捕获所有 `PeleError`**。宿主渲染失败时不要把半成品 SVG 发给客户端；把 `message/line/column/snippet` 作为错误卡片内容；`TypeError` 视为插件 bug 上报日志。
3. **主题用 CSS 变量传，不要烘焙颜色**。宿主 render 不传 `config.theme`（传了也被忽略）；客户端在卡片外层设置 `--pele-*`（可从 DSH/编辑器主题 token 映射）。SVG 内是 `var()` 引用，注入即生效，主题切换**不需要**重新调用宿主。
4. **保证注入的是 `<svg …>` 根节点**。pele 输出本身就是单根 `<svg>`；客户端用 `innerHTML`/`dangerouslySetInnerHTML` 注入。若走 React，注意 `dangerouslySetInnerHTML` 的元素不能同时有 children。
5. **客户端再叠一层 sanitize**（即使 pele 已转义）：剥离 `<script>`、`<foreignObject>`、`on*=` 属性、`javascript:` URL；要求字符串以 `<svg` 开头，否则降级为代码块。`[browser-probe: injection / theme]` 里已验证注入后主题变量与 `max-width:100%` 都生效。

### 12.2 宽度与响应式

- 宿主 render 默认 `responsive:true`，SVG 根 `style="max-width:100%;height:auto;…"`，**注入后会按容器等比缩放**：实测 547px 宽的 SVG 注入 200px 容器 → 渲染盒 200×56。`[browser-probe: injection]`
- SVG 的 `width`/`height` 属性仍是自然像素值。容器是 flex/grid 时建议外层加 `min-width:0; overflow:auto` 或 `max-width:100%`，避免 `width` 属性把布局撑开。
- 想换行/重排到窄栏：宿主传 `maxWidth`（注意它是提示，flowchart 在 `maxWidth<640` 时可能切 TB、也可能仍超出）；真正精确的自适应只有客户端 `mount()` 才有。
- 宿主若传了 `maxWidth` 且容器更窄，SVG 会再等比缩小，文字会变小——这是可接受的常见行为。

### 12.3 字体（最大的视觉风险）

- Node 排版用**内置字宽表**（近似 sans-serif），`fontFamily` 选项**不改变 Node 布局**；浏览器解析 `--pele-font` 显示真实字体。
- 同一份宿主 SVG 注入不同字体栈时文本宽度变化很大：本样本里 `sans-serif`→`monospace`，最宽的文本从 70.36px 变 96.02px（**+36%**），节点框（106.26px）余量从 35.9px 降到 10.2px；标签更长时会溢出边框。`[browser-probe: injection]`
- **建议**：
  - 客户端把 `--pele-font` 设为与 Node 排版假设接近的字体栈（如 `sans-serif`/系统 UI 字体），不要给 Mermaid 图设 monospace/宽字体；
  - 或宿主侧传 `fontFamily` 让 SVG 的 fallback 至少是该字体名（但注意它不改变 Node 布局，只影响浏览器显示）；
  - 需要**精确**排版时，只能改为客户端 `mount()`（pele 在浏览器里用 canvas 真实测量并自适应重排），代价是客户端 bundle +262 KB gzip。
- Node 与浏览器默认字体的正常差异很小：33 个样本 30 个尺寸完全一致，3 个差 1px；压力测试差值 ≤1px。

### 12.4 时间、gantt 与缓存

- gantt 的 today 标记用宿主 `Date.now()`（或传入的 `now`），**位置在渲染时烘焙**；宿主时区/时间不同、缓存复用时会显示“错误的今天”。
- 建议：缓存 key 里带日期（或每天失效），或传固定 `now`，或在检测到 gantt 时在源码里注入 `todayMarker off`（保持确定性）；客户端无法事后移动该标记。
- 其余图表是纯函数式渲染：同输入 + 同 options 字节级确定（`[probe: misc]`），适合内容哈希缓存。

### 12.5 链接与图片

- `render()` 返回的 `links[]`（`id/href/internal`）可用于客户端决策：是否保留 `<a>`、内部链接拦截成 DSH 内导航（`internal:true` 且 `<a data-href>`）、外链加 `target/rel` 等。
- 不想让 Mermaid 图带链接时：`render(text, { links: false })`；同理 `images:false` 可避免 SVG 里出现外部 `<image>`（隐私/CSP/离线场景）。
- 图片节点在 Node 里固定 80×80 且 `preserveAspectRatio="none"`，会拉伸；需要时用 `A@{ img: "…", w: 120, h: 80 }` 指定。
- `linkRel` 默认 `noopener`；注入页面后若需要 `noreferrer` 可改 options。

### 12.6 无障碍

- SVG 根自带 `role="graphics-document document"`、`aria-roledescription="<type>"`；`accTitle`/`accDescr` 生成 `<title>/<desc>`（id 用 `idPrefix`）。保留 `idPrefix` 唯一性，屏幕阅读器才能正确关联。

### 12.7 CSP / 样式

- pele 不加载外部样式、不执行脚本；样式是 SVG 元素上的 `style`/表现属性。若宿主页面有严格 CSP 禁 `style-src 'unsafe-inline'`，SVG 的 `style` 属性可能被拦（颜色/字体失效）——DSH Web 文档目前没有 CSP（见 `research/client-contract.md` §4.1），但换宿主环境时要验证。
- `icons` 返回的 `<path>` 等、`math` 的 `{html}`（`<foreignObject>`）都不受 pele 转义保护；不要对用户可控内容启用。

### 12.8 推荐的最小交互契约

宿主工具返回：

```ts
type RenderPayload = {
  ok: true;
  svg: string;          // 单根 <svg>，含 max-width:100% 与 var(--pele-*)
  width: number; height: number;
  type: string; mermaidType: string;
  links: { id: string; href: string; internal: boolean }[];
} | { ok: false; code: 'unsupported' | 'syntax' | 'semantic' | 'limit'; message: string;
     line?: number; column?: number; snippet?: string };
```

客户端：`sanitizeSvg(meta.svg)` → `dangerouslySetInnerHTML` 注入 → 外层容器设置 `--pele-*` → 可选处理 `<a class="internal-link">` 点击。宿主侧只依赖 `pele` 包，客户端零 pele 依赖。

> 客户端半身的具体实现约束（CSP、React、slot、启动失败风险）另有 `research/client-contract.md` 详述，本文只保证 pele 侧事实。

### 12.9 对当前 `dsh-pele` 实现的核对（研究时快照）

对照 `plugin/render.js` / `plugin/client.js` 的现状，以下 4 点与本研究的 pele 行为相关，建议复核：

1. **`fontFamily` 选项不会改变 Node 排版**：`RENDER_OPTIONS.fontFamily` 只是写进 SVG 的 CSS fallback；宿主布局始终用 pele 内置字宽表。客户端又用 `--pele-font: inherit` 覆盖了它，所以该选项实际只影响“客户端 CSS 也失效”时的兜底显示，不用于排版。
2. **`idPrefix` 未显式设置**：`renderDiagram()` 调用 `render(source, {...RENDER_OPTIONS})`，默认 `idPrefix='pele'`。同一会话页面上有多张图时会出现重复的 `pele-title`/`pele-desc` id（仅无障碍关联问题，不致命）。建议用内容哈希/图 id 生成唯一前缀（如 `idPrefix: 'pele-' + sha1(source).slice(0,8)`）。
3. **gantt today 标记**：如果 `presentationMeta.svg` 被会话持久化、隔天再渲染同一卡片，today 线是旧时间点。若在意，可在 source 里注入 `todayMarker off` 或把渲染日期纳入缓存失效条件（当前实现是每次调用重新 render，风险主要在“会话恢复后回放旧 SVG”）。
4. **`sanitizeSvg()` 会剥掉 `<foreignObject>`**：pele 默认（不传 `math` resolver）不会产生 foreignObject，因此无影响；但未来若启用 `math` 的 `{html}` 形式，需要注意客户端会把公式内容整体剥掉（此时应改用 `{svg}` 形式）。

---

## 13. 不确定项 / 已知未验证点

| # | 不确定点 | 现状 | 如何验证 |
|---|---|---|---|
| 1 | `maxWidth` 的精确语义是逐图表实现的（本文只对 flowchart/xychart/quadrant/treemap/mindmap 等做了采样） | 给的是“提示/换行/切方向/紧凑排版”的近似描述；没覆盖全部 33 类 | 对目标类型跑 `render(src, {maxWidth: 80,150,300,600,900})` 看 width 序列 |
| 2 | `"Diagram is nested too deeply."`（RangeError→limit） | 知道代码路径存在，但用 ≤50k 字符的输入未能稳定触发（先撞上源码上限） | 调大 `limit`（如 `limit: 2e6`）后用深层嵌套 subgraph/mindmap 触发；或直接构造会深递归的语法 |
| 3 | 扩展/试验图表的完整语法（`usecase-beta`/`agentflow-beta`/`cynefin-beta`/`swimlane-beta`/`eventmodeling`/`railroad-*`） | 样本语法是探针试出来的**可渲染最小写法**，不是完整语法规范 | 读 `dist/entries/<type>.d.ts` 与 `dist/diagrams/<type>/*` 的 parser 源码；或对照 pele.run 文档 |
| 4 | requirement 的 `risk: very high` | `risk: high` 可用，`very high` 词法报错（`LOW_RISK/MED_RISK/HIGH_RISK`） | 测 `risk: low/medium/high` 及 `verifymethod` 取值 |
| 5 | 具体的每图表 `config` key 全集 | 本文只列了实测生效的 key | 读 `dist/diagrams/<type>/*.d.ts` 或逐 key 试渲染 |
| 6 | 浏览器差异的普适性 | 仅 Chromium Headless 156 + 本机字体；Firefox/Safari/不同系统字体可能不同 | 用 `research/browser-probe.html` 在目标浏览器跑，对比 `manifest.json` |
| 7 | gantt `today` 的时区/日期解析细节 | 只验证了位置随 `now` 变化、默认用当前时间、`todayMarker` 是指令；未细究日期库时区语义 | 固定 TZ 跑 `gantt` + `now`，比较 x；或读 `dist/diagrams/gantt/dates.js` |
| 8 | 性能数字 | 本文没有 benchmark | `node -e` 循环 render 计时；或 `npm run bench`（需 Chrome） |

---

## 14. 复现清单

```sh
cd <repo>

# 1) Node 侧全部结论 + 重新生成 33 个样本与 manifest
node research/pele-node-probe.mjs

# 2) 浏览器侧结论（真实 Chromium）
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/research/browser-probe.html
# 页面会打印 JSON 到 <pre>，同时写入 window.__BROWSER_RESULTS__

# 3) 快速抽查单个图表
node --input-type=module -e "
import { render } from './.probe/package/dist/pele.js';
const r = render('flowchart LR\n  A[Hello] --> B[SVG]');
console.log(r.width, r.height, r.svg.slice(0, 120));
"
```

关键文件：

- [`research/pele-node-probe.mjs`](./pele-node-probe.mjs) — Node 探针
- [`research/browser-probe.html`](./browser-probe.html) — 浏览器探针
- [`research/samples/`](./samples/) — 33 个 SVG + [`manifest.json`](./samples/manifest.json) + [`sources.json`](./samples/sources.json)
- `research/pele-api.md` — 本文
