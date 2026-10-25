# DSH 0.2.1-rc.2 — 客户端插件契约 / `tool.call.toolview` 最小可用实现

> 角色：client-contract-researcher（task-2）
> 目标：为插件 `dsh-pele` 的浏览器半身给出可落地的精确契约，为 wire tool 名 `pele_draw`
> 注册 `tool.call.toolview`，渲染图卡；纯 JS、无构建步骤。
> 写入范围：仅 `research/`。没有安装/修改任何 DSH 包、没有动 profile、没有调用 plugin_manager、没有重启服务。

---

## 0. 结论摘要（TL;DR）

1. **加载链**：宿主 `dsh-client-modules` 扫描已启用的 Loader entry → 读该包 `package.json` 的
   `dsh.client` + `exports['./client']` → 把 `client.js` 原样作为**经典脚本**（`<script src>`，非 ESM）
   经 `/plugins` 路由下发 → 浏览器执行 `window.__ModuleLoader__.load({ id: '<包名>', factory })`
   只登记惰性 CJS factory → Cordis Loader `import('<包名>')` 时 materialize（执行 factory）→
   `ctx.plugin(exports)`，`exports = { apply, inject }`。
   **不需要打包/压缩/tsdown，纯 JS 直接可跑**；源映射可选；`id` 必须逐字等于包名。
2. **注册**：`apply(ctx)` 里 `ctx.slots.inject('tool.call.toolview', () =>
   ctx.slots.register({ name: 'tool.call.toolview', key: 'pele_draw' }, PeleCard))`。
   slot 由 `@deepseek-ai/dsh-client-ui-tool` 注册 `conversation.chat.node` 时通过 `children`
   声明；必须先 `inject` 等声明出现，直接 `register` 会抛
   `slot "tool.call.toolview" is not declared`。
   **`key` 就是 wire tool 名**（`pele_draw`），拼错不会报错、只会永远走通用 Tool 行。
3. **三阶段 props**：`phase: 'preparing' | 'start' | 'result'` + `block`：
   - `preparing`：`PreparingToolCall`，**没有 `argsRaw`**，只有流式惰性 `block.args`（`PartialArguments`）；
   - `start`：`StartedToolCall`，`block.argsRaw` 是**完整**参数 JSON，`block.args` 已 settle；
   - `result`：`ToolResultNode`，`block.content`（`ContentBlock[]`）、`isError`、`error?`、
     `block.call?.argsRaw`（call 在窗口外时为 `null`）、**`block.meta`**（Host
     `output.presentationMeta` 的落点）、`subCalls`。
4. **取参**：`start/result` 直接 `JSON.parse(block.argsRaw ?? block.call.argsRaw)`；
   `preparing` 用惰性视图 `args.complete(key)` / `args.text(key)` / `args.value(key)` / `args.closed()`。
   完整代码见 §3.3（research/client.example.js 可直接抄）。
5. **取结果**：`pele_draw` 的 SVG 走 Host `output.presentationMeta` →
   `tool/result.data.meta` → `block.meta.svg`（不进模型上下文）。渲染用
   `dangerouslySetInnerHTML={{ __html: sanitizedSvg }}`；app 文档**没有 CSP**，可行。
6. **宽度/折叠**：会话内容列 `max-width: var(--dsh-chat-content-width)`（约 680–920px，可拖拽），
   卡片自己 `width:100%; box-sizing:border-box; min-width:0` 即可；pele SVG 根元素自带
   `style="max-width:100%;height:auto;..."`，会自动缩放。**Turn 落定后 tool 行会被折进
   Turn-process 分组**（compact/standard/detailed 都折，verbose 不折），这是全局策略而非插件问题。
7. **最大风险**：`client.js` 是**整页启动的一部分**。语法错误 / `id` 不匹配 / factory 不返回 exports
   → 该 Loader entry 无法激活 → shell 的启动审计抛 `web boot: N entries did not activate` →
   **整个 Web UI 变成 “Failed to load plugins”**（不是只坏一张卡）。改 `client.js` 后可用
   client-HMR 的热替换（无重启），但**首次引入插件仍要重启 Host**（新 Loader entry 需要 host 重新扫描）。

最小实现文件（均已就绪、可直接取用）：

| 文件 | 用途 |
|---|---|
| [`research/client.example.js`](./client.example.js) | 纯 JS 客户端半身（preparing/start/result 三阶段卡片 + meta.svg 内联 + 清洗 + 降级 + 源码展开） |
| [`research/package.example.json`](./package.example.json) | 含 `dsh.client` / `dsh.bundle` / `exports['./client']` 的清单 |
| [`research/cordis.patch.example.yml`](./cordis.patch.example.yml) | 最小 bundle patch（`insert` 一行 Loader entry） |
| [`research/smoke-client.mjs`](./smoke-client.mjs) | 无浏览器冒烟测试（14 项全过，见 [`smoke-output.txt`](./smoke-output.txt)） |
| [`research/pele-sample.svg`](./pele-sample.svg) | pele 真实输出样本（证明 SVG 自带 `max-width:100%` 与 `--pele-*` 变量） |

---

## 1. 版本与证据源

- 运行时：DSH **0.2.1-rc.2**，profile `$DSH_HOME/profiles/web`（`nodeLinker: hoisted`，
  插件以 `link:` 挂到 profile 的 `node_modules`，见 profile `package.json` 与
  `node_modules/dsh-peak-shift -> ../../../../dsh-plugins/dsh-peak-shift`）。
- 客户端内核版本：`@deepseek-ai/dsh-web-frontend` 0.2.1-rc.2 的 `dist/assets/index-*.js`（shell），
  动态插件：`@deepseek-ai/dsh-client-*` 0.2.1-rc.2。
- 证据路径简写（下文都用包名 + 相对路径 + 行号，绝对包根见附录 A）：
  - `client-modules/lib/index.js` = `@deepseek-ai/dsh-client-modules/0.2.1-rc.2/lib/index.js`（Host 半身）
  - `client-modules/lib/client.js` = 同包浏览器半身
  - `ui-tool/lib/client.js` = `@deepseek-ai/dsh-client-ui-tool/0.2.1-rc.2/lib/client.js`
  - `ui-tool/.../slots.d.ts` = `lib/types/client/contract/slots.d.ts`
  - `ui-chat/lib/client.js`、`ui-conversation/lib/client.js`、`ui-renderer/lib/client.js` 同理
  - shell = `@deepseek-ai/dsh-web-frontend/0.2.1-rc.2/dist/assets/index-CN7NIWNw.js`（单行压缩包，
    用文中的 marker 字符串定位）
- 旧版本参照：`dsh-plugins/dsh-peak-shift/lib/client.js`（0.1.x 时代写的纯 JS 客户端插件，
  形态仍有效：`window.__ModuleLoader__.load` + `ctx.get('slots')` + `slots.inject/register`），
  但它 **没有** 用 `tool.call.toolview`，只注册 sidebar 徽章；本报告以 0.2.1-rc.2 的 shipped
  代码与 d.ts 为准。

---

## 2. 客户端半身如何被加载（完整链路）

### 2.1 `dsh.client` 清单字段（权威类型）

`@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:76-89`（`DshClientManifest`）：

| 字段 | 类型 | 语义 | 对本插件 |
|---|---|---|---|
| `platform` | `string`（**必填**） | 平台标识；Web 消费者只接受 `platform === 'web'`（`client-modules/lib/index.js:733`） | `"web"` |
| `inject` | `string[]?` | **纯信息性**：要在这个包之前到达 factory 的**包名行**，用于模块图排序/工厂到达；不是 Cordis 服务注入（`client-modules/lib/index.js:771-793`；未知包名被安静忽略） | 省略 |
| `immediately` | `boolean?` | 一阶段预取标记：模块面启动时就加载该 bundle 的脚本（`client-modules/lib/index.js:498-500`；`lib/client.js` 的 `prefetch`） | 省略（我们的卡片不必抢跑） |
| `external` | `string[]?` | 超出基线种子的**精确模块请求**，可写子路径（如 `<pkg>/client`）；`.d.ts` 注释明确"type-only import 被擦除，不产生请求" | 省略（只用 `react`） |

> 注意：`dsh.client.inject` ≠ Cordis `inject`。Cordis 服务依赖写在**客户端模块导出的插件对象**上
> （`exports.inject = ['slots']`），由 Loader 在 `ctx.plugin()` 时解析（cordis `plugin.inject`）。

### 2.2 Host 如何发现并解析一个客户端半身

`client-modules/lib/index.js`：

1. `processOne(entryName)`（:852-856）只处理 `entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled`
   的 Loader entry → **没有 Host 半身 / Host 半身加载失败 / 行被 disabled，就不会有客户端 bundle**。
2. `resolveMeta()`（:720-760）：
   - 用 Loader 的 `resolveSync` 解析 entry 的模块位置，向上找到 `package.json`；
   - `parseDshClient(pkg.dsh.client)` 校验字段（`manifest.ts` 里 `parseDshClient` / `optionalStringArray`，
     `lib/index.js:62-70`）；
   - `decl.platform !== 'web'` → 视作无客户端半身（:733）；
   - `exports["./client"]` 解析成相对路径（`clientExportOf`，:172-181；字符串或 `{ default: string }`）；
     缺失即抛 `declares dsh.client but exports no "./client" bundle`（:737-738）；
   - 记录 `clientPath`、`inject`、`external`、`immediately`。
3. `reconcilePackage()`（:890-910）快照 bundle 字节 → 版本 `rev = sha1(mtimeMs, ctimeMs, size)`（:194-200）；
   首次快照会 `readFileSync` 整个 client.js（`initialBundleSnapshot` :830-842，调用处 :900）：
   **文件必须存在**（缺失抛 `MissingClientBundleError`）。

### 2.3 Host 如何下发（URL 形式 / 是否要打包）

- `compose()`（:667-700）把所有行按模块图排序，切成 bootstrap / application 两类 **combo** 脚本；
  每行还有自己的单资源 URL 作为兜底（HMR / 批量失败时用）。
- URL 形如 `/plugins/??<pkg>/client.js&rev=<rev>`，浏览器侧是文档相对形式
  `plugins/??...`（`comboUrl` :208-215；`graphRow` :402-420）。
- 每个 bundle **原样**参与拼接：`prepareSource`（:255-266）只做两件事——
  去掉 `//# sourceMapURL` / `//# sourceURL` 尾部注释、确保以 `\n` 结尾；
  `buildComboScript`（:337-341）把各 bundle 用 **`${source};\n`** 拼接。⇒
  - 不需要 tsdown/vite/压缩；**手写 JS 可以**；
  - 拼接意味着多个插件的顶层代码在同一个 `<script>` 里：**顶层只能有一条语句**，
    否则重复的顶层 `const`/`let` 会让整段脚本 SyntaxError（shipped bundle 全部遵循这一条，
    文件第一行就是 `window.__ModuleLoader__.load({`，`ui-tool/lib/client.js:1`）；
  - `${source};\n` 自动补分号，文件末尾不需要自己包 IIFE（但非要在顶层写 IIFE 也可以）。
- 源映射：`readSourceMap`（:270-284）读 `${clientPath}.map`，**ENOENT 直接返回 undefined**
  → combo map 用 identity section，不影响运行。⇒ 纯 JS 不产 map 完全没问题。
- 传输：`web/app` patch 里 webserver `compression: gzip`（`@deepseek-ai/dsh-web-app/cordis.patch.yml:179-188`），
  大文件会 gzip 传输。

### 2.4 浏览器如何执行与物化

shell（`dsh-web-frontend/dist/assets/index-*.js`，marker `function SZ(){return{react:sC`）：

- `TZ.run()`：`window.__ModuleLoader__.create({ boot: __DSH_BOOT__, staticModules: SZ(), [loadBundle] })`
  → `dsh-client-modules/client` 的 `createClientModuleSystem` 构建模块表；
- `kZ()`（marker `async function kZ`）：`loader.internal = modules`，`modules.entries.start(loader, manifest)`：
  对每行 `prefetch` → `import` → `loader.create({ name: id })`（`client-modules/lib/client.js:383-395, 483-509`），
  即创建 Cordis entry（entry 名 = 包名），`import('<包名>')` 走 `stripClientSuffix` 归一到 graph row；
- 最后 `bZ()` 审计：任何 entry 没到 `active` 就抛 `web boot: N entries did not activate`，
  页面显示 **“Failed to load plugins”**（`CZ` 组件）。
- 默认 bundle 加载方式：`defaultLoadBundle`（`client-modules/lib/client.js:581-600`）创建一个
  `document.createElement("script")`、`el.async = true`、`el.src = url`，**没有 `type=module`**
  ⇒ client.js 必须是**经典脚本**（无 ESM、无 top-level await）。
- 执行后：`window.__ModuleLoader__.load(registration)`（queue 模式先入队，`create()` 后切 live）。
  `register()`（:702-716）只存 `{ factory, rev }`，**重复登记同一 id 直接抛**
  `duplicate factory registration ... (bundle executed twice without invalidate?)`。
- 物化：`materialize()`（:806-830）执行 `factory(this.makeRequire(ownerId, edges))`，缓存 exports；
  期间新增的 **未打标 `<style>`** 会被 `claimStyles`（:618-630）打上 `data-plugin = id`，
  供 HMR/卸载清理（:824-826 失败路径也会清理）。
- Cordis：`ctx.plugin(exports)` —— `isApplicable()` 判定 `typeof exports.apply === 'function'`
  （`@deepseek-ai/cordis/lib/index.js:1447`），`exports.inject` 作为服务依赖数组
  （`plugin.inject`，同文件 :1621-1637）。所以 `return { apply, inject }` 就是完整插件。

### 2.5 失败/回退语义（重要）

`client-modules/lib/client.js:743-800`（`arrive`）：

- combo 脚本**传输失败**（`<script>` error）→ 同 URL 重试一次；
- combo **加载了但没登记本行的 factory**（parse error 什么都没登记，或运行时抛错在登记前中断）
  → 不再重放该 combo（避免 duplicate registration），该行改走**单资源 URL**；
- 两条路都失败 → 该 row 记录 import error → 启动审计失败（整页 Failed to load plugins）。

> 结论：**一个坏 client.js 会拖垮整页启动**，但同一个 combo 里其它插件的 factory 只要已登记就不受影响。
> HMR 路径的失败策略更温和：下载失败保留旧插件；旧 fiber 拆掉后激活失败**不会**回滚到旧 bundle，
> 只在 Settings → Plugins 里显示同步错误并可重试（`@deepseek-ai/dsh-client-hmr/README.md`）。

### 2.6 能否在 client.js 里内联 700KB 的 pele 全局库？

**机制上可以**：文件被 `readFileSync` 整读、作为一个经典脚本下发，没有单文件体积上限；
URL 长度上限只约束路由（3 KiB，`MAX_COMBO_URL_BYTES`），与 body 无关；gzip 默认开启。
但**本插件不需要**：Host 半身已经用 pele 渲染出 SVG 并通过 `presentationMeta` 送到
`block.meta.svg`（§3.4），客户端只做 `<svg>` 内联。把 700KB 再塞进浏览器 bundle 只会让每个
页面启动多下载一份（application combo 是 `<link rel=preload as=script>`，页面加载即预取；
且它和所有其它插件的 client.js 拼在同一 response 里）。若将来确实要在浏览器里从 Mermaid
源码重绘，正确做法是：把 `pele.global.js` 放在 factory 闭包内（脚本执行只登记、不执行），
并在 `package.json` 里声明 `dsh.client.immediately: false`（默认）。

### 2.7 HMR：改 client.js 不用重启；首次接入要重启

- `@deepseek-ai/dsh-client-hmr/lib/index.js:46-56,96-108`：Host 半身对每个已组合的 graph row
  `artifactBaseline(id)` **stat 轮询**（默认 500ms），元数据变了就 `clientModules.rebuilt(id)`
  → SSE `/plugins/events` 推 `rebuilt` frame → 浏览器 invalidate + 重新 prefetch/import + remount。
  ⇒ 已接入的插件，**只改 `lib/client.js`（或其被 `exports['./client']` 指向的文件）会在 1s 内热替换**，
  页面不刷新、Host 不重启。
- `dsh-client-hmr` 本身由 web 组合挂载（`@deepseek-ai/dsh-web-app/cordis.patch.yml:218-219`），
  所以“已接入的 client.js 改动”一定有热替换通道。
- **新增插件**有两条路：(a) 改 profile 的 `dsh.profile.bundles` / `cordis.patch.yml` → Host 重启后生效；
  (b) 包已安装、Loader 在运行时动态启用（Settings → Plugins / plugin_manager 的 enable 路径）→
  `internal/plugin` 事件触发 client-modules 增量重组，已打开页面会收到 graph frame（client-modules
  README “Live plugin composition” 段），无需重启。本任务不替 Lead 做这个选择。
- 注意 client-HMR 按 **包级 artifact** 失效（整个 client.js）；React 内部状态会丢，Session/Workspace 状态保留。
- 当前 profile 的 `id: hmr` 的 `root: [$DSH_HOME/dsh-plugins]` 只影响 **Host 半身**
  （node 模块热加载），不覆盖 `<repo>/...`；客户端半身的热替换不吃这个配置。

---

## 3. `tool.call.toolview` 精确契约

### 3.1 slot 的声明与注册

- **声明者**：`ui-tool` 的 `apply()` 注册 `conversation.chat.node` 时把
  `tool.call.toolview` 作为 **children** 声明（`ui-tool/lib/client.js:4599-4618`）：

  ```js
  const inject = ["slots", "remote"];
  function apply(ctx) {
    ...
    ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
      name: "conversation.chat.node",
      key: "tool-call",
      locale: CONVERSATION_NS,
      children: { "tool.call.toolview": { kind: "keyed", scope: "session" } },
      inject: toolInject,
    }, ToolCallTree));
    ...
  }
  ```

- **调度者**：`ToolCallTree` 对每个 call 调
  `renderSlot("tool.call.toolview", owner, { entryKey: toolName, fallback: <GenericToolCard .../> })`
  （`ui-tool/lib/client.js:1965-1972`），`owner` 由 `:1936-1952` 组装。
- **契约类型**：`ui-tool/lib/types/client/contract/slots.d.ts:19-35`：

  ```ts
  'tool.call.toolview': {
      kind: 'keyed';
      scope: 'session';
      owner: ToolCallOwnerProps;
  };
  ```

  注释原文：“Keyed Tool call view dispatched by wire Tool name. Any name is allowed, including
  tools registered by your package. Register with `key: '<tool name>'`; a typo never renders.
  Registering an occupied key replaces its view; unclaimed keys use the generic row.”
- **注册 API**：`slots` 服务由 `@deepseek-ai/dsh-client-ui-renderer` 的 `SlotRegistry` 提供
  （`ui-renderer/lib/types/client/index.d.ts:22-31`：`Context.slots: SlotRegistry`），方法：
  - `register(options, component): () => void`（`ui-renderer/lib/types/client/registry.d.ts:85, 111`，
    options 语义见 `@deepseek-ai/dsh-client-ui-slots` 的 `BaseOptions`）；
  - `inject(key, callback)`（`registry.d.ts:111`）：等 slot 声明出现；回调返回值当作 effect
    （一个 disposer 或其 iterable），归**调用方 fiber** 所有。ui-tool 自己的内置视图就用
    `ctx.slots.inject(...)` + `yield ctx.slots.register(...)`（`ui-tool/lib/client.js:2967-2980, 4095-4155`）。
  - 注意：`register` 是原型方法，Cordis 服务代理会在调用时把 `this.ctx` 绑到**调用方** ctx——
    所以必须在自己的 `apply` 里同步调用，才能把 disposer 挂到自己的 fiber（unload 时自动摘除）。

**最简注册代码**（完整版见 `client.example.js` 的 `apply`）：

```js
function apply(ctx) {
  const slots = ctx.slots;                       // 已声明 inject: ['slots']
  if (slots === undefined || slots === null) return;
  slots.inject('tool.call.toolview', () =>      // 等 ui-tool 声明该 slot
    slots.register({ name: 'tool.call.toolview', key: 'pele_draw' }, PeleCard));
}
const inject = ['slots'];
return { apply, inject };
```

**注册选项**：`{ name, key, locale?, children?, inject?, store?, priority?, registrant? }`。
我们只用 `name` + `key`。`priority` 默认 0；同一 key 同 priority 第二次注册会抛
`keyed slot "tool.call.toolview" already has an entry for key "pele_draw"`（shell 内 SlotCore 校验，
marker `requires options.key`）。不同 priority 可“影子化”已有视图（低者渲染）。

### 3.2 三阶段 props 结构（权威）

类型链：`ToolCallOwnerProps = ToolCallCommonProps & ToolCallPhaseProps`
（`ui-tool/.../slots.d.ts:54-86`）：

```ts
export interface ToolCallCommonProps {
    useDisclosure: UseDisclosure;   // 每个 call 独立的展开状态 hook（必须无条件调用）
    callId: string;                 // 三阶段稳定
    toolName: string;               // wire tool 名，也是 keyed 分发键
    cwd?: string;                   // 会话 workspace 根
    home?: string;                  // Host home（POSIX 路径可显示 ~）
    openFile: (path: string, options?: { line?: number }) => void;
    loadImage: MessageImageLoader;  // 会话授权的图片 URL loader
    inspect?: (() => void) | undefined;  // 轨迹视图可用时注入
}
export type ToolCallPhaseProps =
  | { readonly phase: 'preparing'; readonly block: PreparingToolCall }
  | { readonly phase: 'start';     readonly block: StartedToolCall }
  | { readonly phase: 'result';    readonly block: ToolResultNode };
```

block 字段（`@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/records.d.ts`）：

| 字段 | preparing（`:284`） | start（`:288`） | result（`:157-201`） |
|---|---|---|---|
| `phase` / `kind` | `phase:'preparing'` | `phase:'start'` | `kind:'tool-result'` |
| `callId` | ✓ | ✓ | ✓ |
| `parentCallId?` | ✓（PTC 子调用时） | ✓ | ✓ |
| `name` | ✓ | ✓ | ✓（call 出窗口时为空串） |
| `turn` / `step` / `time` | ✓ | ✓ | `seq` / `time`（无 turn/step） |
| `subCalls` | ✓（空） | ✓（空） | ✓ |
| `args` | `PartialArguments`（**流式、可增长**） | `PartialArguments`（settled） | `ToolArgs`（= `PartialArguments`；call 出窗口时是 `EMPTY`） |
| `argsRaw` | **无** | **完整 JSON 字符串** | 无（用 `call.argsRaw`） |
| `call` | — | — | `{ name, argsRaw } \| null`（窗口截断时 `null`） |
| `callTime` | — | — | `number \| null` |
| `content` | — | — | `readonly ContentBlock[]`（模型可见结果；文本 `{type:'text',text}`） |
| `isError` | — | — | `boolean` |
| `error?` | — | — | `{ name, code, reason? }` |
| `meta?` | — | — | `unknown`（**`presentationMeta` 的落点**） |

框架额外注入（框架组装顺序：`kit` → 注册的 `inject` → slot `inject` → **ownerProps 覆盖**，
`ui-renderer/lib/client.js:792-809`）：

- `scope: 'session'` 的标配件：`sessionId`、`useSession`、`useProjection`、`useAccess`
  （`@deepseek-ai/dsh-client-ui-session` 的 `SessionStandardProps`），以及全局件
  `useSessions` / `useSessionStatus` / `useSessionRetainInfo` / `useSessionAccess`；
- `renderFactorySlot`；
- **没有 `t`**：`t` 只在注册时声明 `locale: '<namespace>'` 才注入
  （`ui-renderer/lib/client.js:743-747`；`ui-tool` 视图都声明 `locale: CONVERSATION_NS`）；
- **没有 `renderSlot`**：只有注册时声明了 `children` 才有（我们不需要、也不该声明——
  `tool.call.images` 已被 `read_image` 视图独占声明，重复声明会抛）。

### 3.3 如何拿参数（可直接抄的完整代码）

判定“参数是否完整可解析”的权威顺序：

1. `phase === 'start' | 'result'` ⇒ 已派发，参数**一定完整**（`StartedToolCall.argsRaw` 是完整 JSON）；
2. `phase === 'preparing'` ⇒ 参数仍在流式增长，只能读**惰性视图**：
   - `args.complete(key)`：该字段的闭合定界符已到（值内容仍可能未校验）；
   - `args.closed()`：外层对象已闭合，或索引失败/已 sealed；
   - `args.isSealed`：已被 settle（被完整文本替换）；
   - `args.text(key)` / `args.textPrefix(key,n)` / `args.stringLength(key)` / `args.value(key)` / `args.has(key)` / `args.keys()`。
3. 另需注意：`ToolArgs` 视图“在 preparing 期间**原地增长**”，读取会登记“观察到的答案”，
   Definition 在答案变化时重发布 block（`records.d.ts:273-282` 注释）。⇒ 只在渲染里读，
   不要把它拷进自己 state 做 key。

```js
/**
 * 取参数：start/result 用完整 JSON 文本（argsRaw），preparing 用惰性 PartialArguments 视图。
 * 返回对象；任何异常输入都返回 {}（不会抛）。
 */
function readArgs(block) {
  if (block === undefined || block === null || typeof block !== 'object') return {};
  let raw = null;
  if (typeof block.argsRaw === 'string') raw = block.argsRaw;                 // start
  else if (block.call && typeof block.call.argsRaw === 'string') raw = block.call.argsRaw; // result（call 在窗口内）
  if (raw !== null) {
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  const args = block.args;                                                    // preparing / 窗口外
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const key of ['title', 'save', 'path', 'diagram']) {
    if (typeof args.complete === 'function' && args.complete(key) !== true) continue;
    if (key === 'save') {
      if (typeof args.value === 'function') { const v = args.value(key); if (v !== undefined) out[key] = v; }
      continue;
    }
    if (typeof args.text === 'function') { const s = args.text(key); if (s !== undefined) out[key] = s; }
  }
  return out;
}

/** 参数是否已完整可解析（preparing 永远 false；start/result 以 JSON.parse 成功为准）。 */
function argsComplete(block) {
  if (!block || typeof block !== 'object') return false;
  const raw = typeof block.argsRaw === 'string' ? block.argsRaw
    : block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : null;
  if (raw !== null) { try { JSON.parse(raw); return true; } catch { return false; } }
  const args = block.args;
  if (!args || typeof args !== 'object') return false;
  if (typeof args.closed === 'function' && args.closed() === true) return true;
  return args.isSealed === true;
}
```

> 证据：`PartialArguments` 契约见 `@deepseek-ai/dsh-util-values/lib/types/partial-json.d.ts:24-160`
>（`closed()` :73、`has` :84、`complete` :90、`text` :110、`value` :123、`isSealed` :49、`invalid` :51）；
>“每个 reader 都是 total 的（返回 undefined/false，不 throw）”写在类注释里。
> ui-tool 自己在 0.2.1 的运行时代码也这样读：`argumentSummary` 用 `args.complete("file_path")` +
> `args.text("file_path")`（`ui-tool/lib/client.js:255-282`），`parsedToolCall` 用 `block.call?.argsRaw`
> / `block.argsRaw` 做 `JSON.parse`（:342-370），`resultText` 只取 `type === 'text'` 的 block（:193-204）。

### 3.4 如何拿结果：content / error / meta（含 pele SVG 路径）

`ToolResultNode`（上一节表）给了三种信息，按优先级：

1. **展示元数据 `block.meta`** —— Host 工具 `output.presentationMeta(args, value)` 的返回值：
   - Host 侧：`@deepseek-ai/dsh-tools/lib/index.js:3650-3657` 调用
     `output.presentationMeta(...)` → `snapshotProjection` → `result.meta`；
     随后写进 `tool/result` 事件 `data.meta`（同文件 :1409 / :3675 / :3690）；
   - 客户端侧：`ui-chat/lib/client.js:10180-10199`（`rootResult`）把 `match.event.data.meta`
     原样放进 `ToolResultNode.meta`；
   - `pele_draw` 的 Host 半身已经在 `presentationMeta` 里给了
     `{ version, type, mermaidType, width, height, bytes, title, saved, svg? , svgOmitted? , svgOmittedReason? }`
     （见 `plugin/index.js` 的 `presentationMeta`）——**客户端卡片直接读 `block.meta.svg`**，
     不需要从结果文本里解析，也不占模型上下文。
2. **模型可见结果文本 `block.content`**：文本块 `{ type: 'text', text }`；flat 文本可参考
   ui-tool 的 `resultText`（`ui-tool/lib/client.js:193-204`）。
3. **错误 `block.isError` / `block.error`**：空 content 的失败回退 `error.name: error.code`
   （同 `resultText` 的兜底）。

```js
function resultText(block) {
  const parts = [];
  for (const item of Array.isArray(block?.content) ? block.content : []) {
    if (item && item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
  }
  if (parts.length === 0 && block?.error) {
    parts.push(block.error.code ? `${block.error.name}: ${block.error.code}` : block.error.name);
  }
  return parts.join('\n');
}

function readMeta(block) {
  const meta = block?.meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
}
```

> SVG 在 Host 侧已由 `plugin/index.js` 的 `sanitizeSvg` 清洗；客户端仍应做二次清洗并限制大小
> （见 §4.1 与 `client.example.js` 的 `sanitizeSvg` / `MAX_INLINE_SVG_CHARS`）。
> `meta` 会持久化在会话日志（tool/result 事件）里并随回放重建，所以超大 SVG 会同时增大会话日志；
> Host 半身已有 `maxInlineSvgBytes` 阈值（默认 512 KB）控制。

### 3.5 `useDisclosure` / 展开语义

```ts
type UseDisclosure = () => {
  readonly expanded: boolean;
  readonly setExpanded: (open: boolean) => void;
  readonly toggle: () => void;
};
```

- 由 framework 为**每个 call**注入；每个 invocation 各自持有状态；
- 会**订阅外层 Turn 的 reset**：Turn 折叠/重置时展开状态复位（`ui-chat/.../slots.d.ts:119-130`）；
- 它本身是 hook：**必须无条件调用**（不能只在 result 分支调用），否则 hook 顺序错乱 → 组件崩溃。

---

## 4. 渲染约束

### 4.1 `dangerouslySetInnerHTML` / SVG / CSP

- **可行**：app 文档没有 CSP。`@deepseek-ai/dsh-host-webserver` 只做路由/压缩/索引注入，不设 CSP
  （`lib/index.js` 全文无 `Content-Security-Policy`）；唯一的 `sandbox; default-src 'none'`
  出现在 **附件/文件下载响应**上（`@deepseek-ai/dsh-api-session-controller/lib/index.js:2428`），
  与页面文档无关。
- React 18 的 `dangerouslySetInnerHTML` 要求元素**没有 children**；内容必须是单个根元素
  （SVG 根 `<svg ...>` 即可）。
- 安全边界：`innerHTML` 插入的 `<script>` **不会执行**，但**事件属性会**（`onload` 等），
  所以必须清洗：剥 `<script>`、`<foreignObject>`、`on*=` 属性、`javascript:` URL。
  `client.example.js` 的 `sanitizeSvg` 同时要求内容以 `<svg` 开头，否则拒绝注入走降级卡。
- pele 输出样本（`research/pele-sample.svg`）说明：根元素自带
  `style="max-width:100%;height:auto;--_bg:var(--pele-bg,#fff);…"`，**插进去就自适应宽度**，
  主题由祖先上的 `--pele-*` CSS 变量控制。

### 4.2 组件崩溃的后果

- renderer 用 `SlotErrorBoundary` 包住每个 slot entry
  （`ui-renderer/lib/client.js:625-645`，`data-slot-error` 崩面），
  捕获后 `host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== 'chain' })`（:1136-1142）：
  - console 里 `slot entry crashed in 'tool.call.toolview': …`；
  - keyed slot 的该 entry **从 cell 中退场（one-shot abdicate，直到注册生命周期结束）**；
  - 因为 `ToolCall` 给 `renderSlot` 传了 `fallback: GenericToolCard`，崩溃后会显示**通用工具行**，
    但你的自定义视图**在本次注册生命周期内再也不出现**（只能页面刷新/HMR 重载）。
- 崩溃不会拖垮整页（与 §2.5 的启动失败不同）；**但 apply 期间抛错会**：那会变成 entry 未激活 →
  “Failed to load plugins”。⇒ 把风险代码放进组件里（有边界），而不是 `apply` 顶层。

### 4.3 主题 token

主题包 `@deepseek-ai/dsh-client-ui-theme`（`lib/client.js` 的 token sheets）定义 `--dsw-*` 与
`--dsh-*`；卡片直接用这些 token，明/暗主题自动跟随。常用：

| 用途 | token |
|---|---|
| 卡片底 / 分层底 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2/3` |
| 边框 | `--dsw-alias-border-l1`（0.5px 细边）、`l2`、`l3` |
| 文字 | `--dsw-alias-label-primary`、`-secondary`、`-tertiary`、`-caption` |
| 状态色 | `--dsw-alias-state-success-primary`、`-error-primary`、`-warn-label`、`--dsw-alias-brand-primary` |
| 圆角 | `--dsw-radius-xs/sm/md/lg/xl`（4/8/12/16/20px）、`--dsw-radius-panel`（28px） |
| 代码块底 | `--dsw-alias-markdown-code-block` |
| 正文字号 | `--dsh-content-font-size`、`--dsh-content-font-size-secondary`、`--dsh-content-font-delta` |
| 字体族 | `--dsh-font-family-text`、`--dsh-font-family-code` |

pele 主题桥接（`client.example.js` 的 `.dsh-pele-card` 规则）：

```css
.dsh-pele-card{
  --pele-bg: var(--dsw-alias-bg-base);
  --pele-fg: var(--dsw-alias-label-primary);
  --pele-muted: var(--dsw-alias-label-tertiary);
  --pele-line: var(--dsw-alias-border-l2);
  --pele-surface: var(--dsw-alias-bg-layer-1);
  --pele-surface-alt: var(--dsw-alias-bg-layer-2);
  --pele-border: var(--dsw-alias-border-l3);
  --pele-accent: var(--dsw-alias-brand-primary);
  --pele-error: var(--dsw-alias-state-error-primary);
  --pele-critical: var(--dsw-alias-state-error-primary);
  --pele-font: var(--dsh-font-family-text, sans-serif);
  --pele-font-mono: var(--dsh-font-family-code, monospace);
  --pele-radius: var(--dsw-radius-md, 12px);
}
```

> `--pele-*` 列表来自 `plugin/vendor/pele.js`（`--pele-bg/fg/muted/line/surface/surface-alt/
> border/accent/error/critical/font/font-mono/radius/series-*`），SVG 内的写法是
> `var(--pele-bg,#fff)` 带兜底，所以不设也可见，只是不跟随主题。

**CSS 注入约定**：只能 materialize 时注入 `<style>`。module system 在 factory 执行前后抓
**未打标** 的 `<style>` 并打上 `data-plugin=<包名>`（`client-modules/lib/client.js:618-630, 806-828`），
卸载/HMR 时按该标记清理。shipped 包的标准写法：

```js
const tagId = 'dsh-pele/PeleCard.css';
if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pele';        // 必须 = package name
  tag.dataset.pluginCss = tagId;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
```

### 4.4 卡片宽度约束（不会自动裁切/折叠）

- 会话流容器（`ui-chat/lib/client.js:2679` 的 ChatView CSS）：
  `.EvIC1a_column{max-width:var(--dsh-chat-content-width);width:100%;margin:0 auto;display:flex;flex-direction:column}`；
  `.EvIC1a_flowItem{min-width:0}`；tool 行本身只有 `.EvIC1a_callRow{border-radius:var(--dsw-radius-sm)}`。
- `--dsh-chat-content-width` 定义在 Conversation body（`ui-conversation/lib/client.js:17325` 的 CSS）：
  `var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px))`；
  用户拖动会话宽度手柄时用 localStorage 偏好覆盖 `--dsh-chat-user-width`（`resolveContentWidth`，
  同文件 :646900 附近）。⇒ 卡片实际宽度约 **680–920px**，随窗口/拖拽变化。
- **没有自动裁切/折叠**：`EvIC1a_scroll{overflow-y:auto}` 只纵向滚动，横向溢出会撑出滚动条。
  ⇒ 卡片自己写 `max-width:100%; min-width:0; box-sizing:border-box`，内容宽时用
  `overflow-x:auto`（`client.example.js` 的 `.dsh-pele-body`）。
- SVG 由 pele 自带 `max-width:100%;height:auto`，所以会等比缩到卡片宽度；超宽图会变小但仍完整显示。
- 若要让超宽图可放大查看：可在卡片里给 SVG 容器加 `overflow:auto` + 一个"原始宽度"开关，
  或调用 `props.openFile(saved)` 打开已保存的 `.svg`（0.2.1 的 document preview 能渲染 SVG）。

### 4.5 Turn 折叠：卡片什么时候可见

`ui-chat/lib/client.js` 的 presentation policy（`POLICIES` :12662-12692）：

| transcriptView | foldCompletedTurns | stepGrouping |
|---|---|---|
| compact | true | collapsed |
| standard | true | collapsed |
| **detailed（本 profile 配置值）** | **true** | history |
| verbose | false | none |

- 运行中的 Turn：`turnProcessAlwaysOpen`（:3644-3650）⇒ 始终展开，卡片可见；
- Turn 正常完成：`foldCompletedTurns` ⇒ tool 行（含我们的图卡）被折进 Turn-process 分组，
  用户点分组头展开；`collapseTiming` 决定折叠时机（`completion` 立即 / `next-input` 下一次输入；
  本 profile 配的是 `next-input`，见 profile `cordis.patch.yml` 的 `- id: ui-chat`）；
- aborted / interrupted / error 结束的 Turn 永远展开。
⇒ **“图卡过一会儿看不见了” 是 DSH 的统一折叠策略，不是插件 bug**；想常显只能切 verbose。

### 4.6 其他框架位

- `props.inspect`：轨迹视图可用时提供，点击可定位该 call；可做一个小按钮。
- `props.openFile(path, { line? })`：在侧边栏打开文件（`ui-chat/.../slots.d.ts:33-36`）。
- `callId`：稳定 identity；`data-chat-anchor-key="call:${callId}"` 之类锚点由 ToolCall 外层提供，
  卡片不必自己加。

---

## 5. 最小可用实现

（文件就是本目录下的三个 example；下面是“为什么这样写”的清单，代码本身见文件。）

### 5.1 客户端半身 `client.example.js`

结构（全部在 factory 闭包里）：

```
window.__ModuleLoader__.load({ id:'dsh-pele', factory:(require)=>{ … return {apply, inject}; } });
  ├─ const React = require('react')                 // 只用基线种子
  ├─ CSS + injectCss()（materialize 时注入一次，带 data-plugin 归属）
  ├─ readArgs / argsComplete / resultText / readMeta / sanitizeSvg / humanBytes / displayPath
  ├─ PeleCard(props)                                 // 三阶段；无条件调 useDisclosure
  │    ├─ preparing → Placeholder('正在准备图表参数…')（title 从流式 args 读）
  │    ├─ start     → Placeholder('正在渲染 Mermaid 图表…')（title 从 argsRaw 读）
  │    └─ result    → SvgBody(dangerouslySetInnerHTML=meta.svg) / 降级卡 / 错误卡
  │                   + 脚注（查看 Mermaid 源码 / 打开已保存 SVG / 轨迹）
  └─ apply(ctx): ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({name,key}, PeleCard))
```

冒烟测试（`node research/smoke-client.mjs`，输出见 `smoke-output.txt`）验证 14 项：
经典脚本单顶层语句、惰性登记、`inject:['slots']`、`slots.inject` 等声明、三阶段渲染、
preparing 惰性取参、result `meta.svg` 内联、`svgOmitted` 降级、错误卡、恶意 SVG 清洗、
非 SVG/超大 SVG 拒绝、异常输入不崩、`useDisclosure` 每次渲染恰好调用一次。

### 5.2 `package.example.json` 要点

| 字段 | 值 | 为什么 |
|---|---|---|
| `name` | `dsh-pele` | 必须 = `__ModuleLoader__.load` 的 `id` = Loader entry 名 = graph row id |
| `exports['./client']` | `./lib/client.js` | `client-modules/lib/index.js:171-181` 唯一接受的入口映射（字符串或 `{default:string}`） |
| `exports['.']` | `./lib/index.js` | Host 半身（Loader 行 `name: dsh-pele` 的 import 目标） |
| `dsh.bundle.patch` | `./cordis.patch.yml` | bundle 层入口 |
| `dsh.client.platform` | `"web"` | Web 消费者只认这个值（:733） |
| `dsh.client.immediately` | 省略 | 非启动关键路径，让浏览器按需/批量加载 |
| `dsh.client.external` | 省略 | 只 require `react`（基线种子） |
| `type` | `"module"` | **仅 Host 半身**用 ESM；`lib/client.js` 由宿主当经典脚本下发，`.js` 后缀 + 内容自行保证无 ESM 语法 |

### 5.3 `cordis.patch.example.yml` 要点

```yaml
- insert:
    - id: pele
      name: dsh-pele
```

- 必须 **enabled**（不要 `disabled: true`）：`processOne` 只扫有 fiber 且未 disabled 的 entry（:852-856）。
- `name` 必须是可解析的包名（profile `nodeLinker: hoisted`，用 `link:` 依赖时 pnpm 会在 profile
  `node_modules` 建 symlink；Host 半身 import 的 `@deepseek-ai/dsh-tools` 等 peer 也要能解析）。

### 5.4 安装/接入步骤（由 Lead 执行；本报告不代做）

1. 把 `research/client.example.js` 复制成插件包的 `lib/client.js`（或 `plugin/client.js`，
   与 package.json 的 `exports['./client']` 一致）。**不要改名 `id`/`key`。**
2. package.json 补齐 §5.2（注意实际目录布局：如果包根在 workspace 根，client 路径写成 `plugin/client.js`）。
3. profile 接入（二选一）：
   - **bundle 方式（推荐）**：profile `package.json` 的 `dependencies` 加
     `"dsh-pele": "link:<repo>"`，`dsh.profile.bundles` 加 `"dsh-pele"`；
     然后 `cd $DSH_HOME/profiles/web && pnpm install`（离线 store 已有 0.2.1-rc.2 依赖）。
   - **patch 方式**：依赖照加，把 `insert` 行写进 profile 的 `cordis.patch.yml`。
4. **让 Host 识别新 Loader entry**：改 profile bundle/patch 的方式需要重启 Host；运行时 enable 路径
   （Settings → Plugins）可让已开页面通过 client 模块图增量同步拿到新行。之后改 client.js
   由 client-HMR 自动热替换（§2.7）。
5. 验证：
   - Host 日志无 `ClientPackageCompositionError` / `declares dsh.client but exports no "./client"`；
   - 浏览器 DevTools：`window.__DSH_BOOT__.entries.find(e => e.id === 'dsh-pele')` 有行；
   - 发一次 `pele_draw` 调用：preparing 占位 → start 占位 → result 图卡；
   - 若整页变成 “Failed to load plugins”，看 console 的 `client-modules: could not load "dsh-pele"` /
     `web boot: … entries did not activate`（`id` 不匹配、syntax error、factory 没 return exports 是三大原因）。

---

## 6. 坑列表（按踩中概率排序）

1. **`id` 必须逐字等于包名**。`window.__ModuleLoader__.load({id})` 的 id ≠ 包名时，脚本加载成功但
   不会登记该 row → `loaded without registering "<pkg>"` → entry 不激活 → **整页 Failed to load plugins**
   （`client-modules/lib/client.js:743-800` 的 `arrive`；启动审计 shell marker `did not activate`）。
2. **`key` 必须逐字等于 wire tool 名**（`pele_draw`）。keyed 分发按 `entryKey: toolName` 精确匹配
   （`ui-tool/lib/client.js:1967`；slots.d.ts 注释 “a typo never renders”）。拼错没有日志，只会永远
   显示通用工具行。
3. **必须先 `slots.inject` 再 `register`**。slot 由 ui-tool 的 children 声明；声明未出现时直接 register 抛
   `slot "tool.call.toolview" is not declared (a parent entry's children table must declare it)`
   （shell SlotCore，marker `is not declared`）。这个异常发生在 `apply` 里 → entry 激活失败 → 整页挂。
4. **`client.js` 是经典脚本**：不能有 `import`/`export`/`import.meta`/top-level await；不能有 JSX
   （没有编译器）；用 `React.createElement`。`node --check research/client.example.js` 是低成本的预检。
5. **顶层只能有一条语句**（宿主把多个 bundle 用 `${source};\n` 拼成一个脚本，`:337-341`）。
   顶层 `const React = …` 会和别的插件撞名 → 整段 SyntaxError。全部塞进 factory 闭包
   （shipped bundle 的第一行就是 `window.__ModuleLoader__.load({`）。
6. **factory 必须 `return` 插件对象**（`{apply, inject}`；或 `module.exports` 后 `return module.exports`）。
   忘记 return → exports `undefined` → `invalid plugin, expect function or object with an "apply" method`
   → entry 不激活 → 整页挂。
7. **`require` 只能解析基线种子表**（shell `SZ()`）：`react`、`react/jsx-runtime`、`react-dom`、
   `react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、
   `@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
   `@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
   解析失败会抛 `cannot resolve "…" — not a seed word, not a materialized module, and not a row in the
   boot graph`（`client-modules/lib/client.js:880-890`）。要别的包：写 `dsh.client.external` 且它必须是
   boot graph 的行（否则也是错的）。
8. **`dsh.client.inject` 不是 Cordis 服务注入**。Cordis 依赖写在 `exports.inject` 里（如 `['slots']`）；
   `dsh.client.inject` 只影响**包 factory 到达顺序**（未知包名安静忽略）。
9. **重复登记 / 重复执行**：同一 id 第二次 `__ModuleLoader__.load` 抛
   `duplicate factory registration`（:702-712）。不要在自己的 client.js 里重复 load，
   也不要把 client.js `<script>` 引两次（宿主已经负责加载）。
10. **CSS 只能在 factory 内注入，且必须带 `data-plugin` 归属**。materialize 前后抓 untagged style
    （:618-630）；在脚本顶层注入的 style 会在 `before` 快照里、不会被 claim → 卸载/HMR 后样式泄漏。
11. **组件崩溃 = 该注册生命周期内永久退场**。slot 边界会 `abdicate` 并回退到 GenericToolCard，
    自定义视图直到页面刷新/HMR 才回来（`ui-renderer/lib/client.js:1136-1142`）。写防御性的读值代码。
12. **hook 规则**：`useDisclosure` 是 hook，必须无条件调用；不要把它放进 `phase === 'result'` 分支。
13. **`meta` 不是 `args`**：`ToolResultNode` 没有 `argsRaw`；result 阶段的参数在 `block.call?.argsRaw`，
    call 出窗口时是 `null`，`block.args` 是 `EMPTY`。别写 `block.argsRaw` 然后 `JSON.parse(undefined)`。
14. **SVG 安全**：innerHTML 里的 `<script>` 不执行但 `onload` 等事件属性会执行；必须清洗
    （Host 侧已有 `sanitizeSvg`，客户端再做一次，且限制大小）。不要把 SVG 直接塞进
    `document.write`/`new Function`。
15. **`--dsh-chat-content-width` 只有 680–920px**：图卡要 `width:100%;max-width:100%;min-width:0`，
    超宽内容给 `overflow-x:auto`；否则会撑出横向滚动。pele SVG 自带 `max-width:100%;height:auto`。
16. **Turn 折叠是正常的**：detailed 模式 `foldCompletedTurns: true` + `collapseTiming: next-input`
    ⇒ Turn 结束后下一次输入时 tool 行折进分组。别为此去改 renderer。
17. **`presentationMeta` 会持久化在会话日志**：每次回放都会重建 meta；超大 SVG 会让日志变大，
    Host 侧 `maxInlineSvgBytes`（默认 512 KB）是必要的。客户端再设 `MAX_INLINE_SVG_CHARS` 兜底。
18. **relaunch 才认新插件**：新增 Loader entry 必须重启 Host；只有“已接入的 client.js 改动”是 HMR。
19. **不要在 client.js 里访问 `ctx.get('...')` 之外的宿主能力**：客户端没有动态包的 host 桥；
    Host 数据要么随工具结果/meta 下发，要么走同源 HTTP 路由（peak-shift 的做法）。
20. **profile 的 `hmr.root` 不覆盖 workspace**：`$DSH_HOME/dsh-plugins` 之外的 Host 半身改动不会热加载
    （客户端半身不受影响，见 §2.7）。

---

## 7. 验证记录

```text
$ node --check research/client.example.js
CLASSIC-SCRIPT-PARSE: OK

$ node research/smoke-client.mjs
ok   顶层只有一条语句 window.__ModuleLoader__.load(...)
ok   不含 ESM import/export 与 JSX 用法
ok   脚本执行只注册 factory（惰性 CJS，无副作用）
ok   materialize 时注入一份带 data-plugin 归属的 CSS
ok   factory 返回 { apply, inject } 且只依赖基线模块 react
ok   apply 等待 tool.call.toolview 声明后再注册
ok   preparing：占位卡 + 流式 title（PartialArguments 惰性视图）
ok   start：占位卡 + argsRaw 完整参数
ok   result：meta.svg 内联渲染 + 尺寸/字节/文件脚注
ok   result：useDisclosure 展开后显示 Mermaid 源码
ok   result：meta.svgOmitted 降级卡（超内联上限）
ok   result：isError 显示错误文本（content 为空时退回结构化 error）
ok   result：恶意/异常 SVG 清洗与拒绝
ok   异常输入不崩：block 缺失 / args 视图不完整 / meta 非对象

14 passed, 0 failed
```

（完整输出：`research/smoke-output.txt`。）未做的验证：真实浏览器内联渲染、真实 Host 启动审计、
主题 token 的实际取色——这些需要把插件接进 profile 后验证，属于 Lead 的集成步骤。

---

## 8. 未决 / 建议 Lead 决策

1. **包根布局**：Lead 当前是 `plugin/index.js` + `plugin/vendor/pele.js`。若包根在 workspace 根，
   `exports['./client']` 要写 `./plugin/client.js`；若包根就是 `plugin/`，写 `./client.js`。
   本报告的 example 按 `lib/` 约定写，复制时按实际调整（唯一关键是 `exports['./client']` 可解析）。
2. **Host 半身 peer 依赖解析**：`@deepseek-ai/dsh-tools` 必须能从插件位置解析到（profile hoisted 或
   插件自己的 `dependencies`）。peak-shift 的做法是插件目录自带 `node_modules/@deepseek-ai/*` 软链，
   可参照；这条不影响客户端半身。
3. **i18n**：当前卡片硬编码中文。若要 i18n：注册时声明 `locale: '<namespace>'` 并在
   `client.js` 的 factory 里通过 locale 服务注册字典（`dsh-client-locale`），注册后 props 会有 `t`。
   最小实现不做，理由是纯 JS 无构建 + 单语言场景。
4. **是否需要在卡片里提供“强制展开/原始宽度”**：当前靠 Turn 折叠 + 浏览器缩放；若要产品级体验，
   可在卡片上增加 `overflow-x:auto` 包裹 + 原始尺寸开关（不需要改 framework）。
5. **首次接入必须重启 Host**（新增插件），与“不要动正在运行的 GUI 进程”的约束冲突——需要用户/Lead 拍板时机。

---

## 附录 A：证据包根路径

```text
PKG=~/.local/share/pnpm/store/v11/links/@deepseek-ai/<pkg>/0.2.1-rc.2/<hash>/node_modules/@deepseek-ai/<pkg>
```

本报告引用的包（hash 略；按版本目录 `0.2.1-rc.2` 定位即可）：

| 包 | 关键文件 |
|---|---|
| `@deepseek-ai/dsh-client-modules` | `lib/index.js`（Host 半身/扫描/combo/route）、`lib/client.js`（浏览器模块表）、`lib/types/client/manifest.d.ts`、`README.md` |
| `@deepseek-ai/dsh-client-ui-tool` | `lib/client.js`（ToolCallTree、内置 toolviews、`:4599` 声明 slot）、`lib/types/client/contract/slots.d.ts`、`README.md` |
| `@deepseek-ai/dsh-client-ui-chat` | `lib/client.js`（节点构建、presentation policy、ChatView CSS）、`lib/types/client/contract/{slots,records,snapshot}.d.ts` |
| `@deepseek-ai/dsh-client-ui-conversation` | `lib/types/client/contract/records.d.ts`（`ToolResultNode`/`PreparingToolCall`/`StartedToolCall`/`ToolArgs`）、`lib/client.js`（`--dsh-chat-content-width`） |
| `@deepseek-ai/dsh-client-ui-renderer` | `lib/client.js`（SlotErrorBoundary/standardKit/renderEntry）、`lib/types/client/{registry,index}.d.ts`、`README.md` |
| `@deepseek-ai/dsh-client-ui-slots` | 0.2.1 未随 profile 安装（被 shell 内联）；类型契约参考 `0.2.0-rc.2/lib/types/index.d.ts`（`SlotCore.register`/`PropsRuntime`/`SlotComponent`） |
| `@deepseek-ai/dsh-client-ui-session` | `lib/types/client/index.d.ts`（`SessionStandardProps`/`GlobalStandardProps`） |
| `@deepseek-ai/dsh-client-ui-theme` | `lib/client.js`（`--dsw-*` / `--dsh-*` token sheets）、`README.md` |
| `@deepseek-ai/dsh-util-values` | `lib/types/partial-json.d.ts`（`PartialArguments` 全部 reader） |
| `@deepseek-ai/dsh-tools` | `lib/index.js`（presentationMeta → `tool/result.meta`）、`lib/types/presentation.d.ts` |
| `@deepseek-ai/dsh-client-hmr` | `lib/index.js`（stat 轮询 + `rebuilt`）、`README.md` |
| `@deepseek-ai/dsh-web-frontend` | `dist/assets/index-CN7NIWNw.js`（shell：`SZ()` 基线模块表、boot audit、index.html 注入行） |
| `@deepseek-ai/dsh-host-webserver` | `lib/index.js`（无 CSP；gzip 配置） |
| `@deepseek-ai/dsh-package-manifest` | `lib/types/types.d.ts`（`DshClientManifest`） |
| `@deepseek-ai/cordis` | `lib/index.js`（`isApplicable`、`plugin.inject`） |

profile 证据：`$DSH_HOME/profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml,node_modules/*}`。

## 附录 B：与 `dsh-peak-shift` 参考实现的差异

| 维度 | dsh-peak-shift（0.1.x 写法，仍可跑） | 本报告（0.2.1-rc.2 契约） |
|---|---|---|
| 注册目标 | `sidebar.footer.action`（list slot，`id`/`order`） | `tool.call.toolview`（**keyed** slot，`key`=wire tool 名） |
| 等服务方式 | `ctx.get('slots')` + `if undefined return` | `inject: ['slots']` + `ctx.slots`；`slots.inject` 等声明 |
| 组件 props | 自造，无框架 props | framework 组装：owner props + session 标准件 + `useDisclosure` 等 |
| 数据来源 | 同源 HTTP 路由轮询 | Host 工具 `output.presentationMeta` → `block.meta`（推荐） |
| bundle 导出 | `module.exports` 包装 + `exports.apply/inject` | 直接 `return { apply, inject }`（等价，更短） |
| 样式 | 全 inline style | 注入 `style[data-plugin]` + 主题 token（可 inline 也可两者混用） |
| 风险面 | 只影响一个徽章 | **apply 抛错会整页启动失败**（见 §2.5/§6.1） |

---

## 9. 对 Lead 现有 `plugin/client.js` 的契约复核（只读，写于 2026-10-25 00:20）

复核对象：`<repo>/plugin/{package.json,client.js,cordis.patch.yml}`（未修改）。
结论：**契约层面合规，可直接接入**；只有 3 条非阻塞建议。

**已核对通过的硬条件**

| 检查 | 结论 |
|---|---|
| 顶层单语句 `window.__ModuleLoader__.load({...})` | ✅（391 行，仅一条顶层语句 + 注释） |
| `id` === 包名 | ✅ `id: 'dsh-pele'`，`plugin/package.json.name = "dsh-pele"` |
| 经典脚本（无 ESM/JSX/top-level await） | ✅ |
| factory 惰性 + 返回插件对象 | ✅ `return { inject: ['slots','locale'], apply }` |
| `exports['./client']` 映射 | ✅ `"client": "./client.js"` |
| `dsh.client.platform = 'web'` | ✅ |
| 注册 key = wire tool 名 | ✅ `slots.register({ name:'tool.call.toolview', key:'pele_draw', locale:'pele' }, PeleCard)` |
| 先 `slots.inject` 再 register | ✅ |
| 只 require 基线模块 | ✅ 仅 `react` |
| 结果从 `block.meta` 取 SVG | ✅ 与 Host `presentationMeta` 字段一致（`svg/svgOmitted/svgOmittedReason/title/width/height/bytes/saved`） |
| `dangerouslySetInnerHTML` | ✅ app 无 CSP；body 元素无 children；`sanitizeSvg` 已剥脚本/事件 |
| 宽度 | ✅ 块级 div + 容器 `minWidth:0`；body `maxHeight:560; overflow:auto` |
| 无 CSS 注入 | ✅ 全 inline style，天然没有 `data-plugin` 清理问题 |

**`locale` 依赖核对**（这是最容易整页挂的一处，已确认安全）

- `inject: ['slots','locale']` 的 `locale` 服务名正确：`@deepseek-ai/dsh-client-locale`
  的 client 半身 `ctx.provide("locale", locale)`（`lib/client.js:1526`）并
  `ctx.slots.installLocale(locale)`（:1533）；该插件在 web 组合中挂载
  （`@deepseek-ai/dsh-web-app/cordis.patch.yml:257-258`）。
- `locale.register(NS, { zh, en })` 是**合法运行时形态**：`LocaleRuntime.register` 接受
  `Record<locale, dict>`（`lib/types/client/index.d.ts:188-199`），`LOCALE_IDS = ['zh','en']`
  （`lib/types/locale-settings.d.ts:10`）；重复 `(ns, locale)` 才会抛，正常 HMR 先拆旧 fiber 再 apply，
  不会重复。
- register 选项里的 `locale: 'pele'` 只是让框架注入 `t`；`LocaleNamespaceMap` 没有 `pele`
  也只影响 TS 类型，运行时 `face.bind(ns)` 对未知 ns 回退到 common → key（`lib/client.js:1398-1420`），
  不会抛。卡片里的 zh/en 兜底因此是冗余但安全的。

**非阻塞建议（按价值排序）**

1. **客户端加大 SVG 防御**：`sanitizeSvg` 目前不要求内容以 `<svg` 开头、也没有体积上限。
   建议在 `dangerouslySetInnerHTML` 前加 `if (!/^<svg[\s>]/i.test(text)) 走降级` 和
   `text.length <= 600 * 1024` 的判断（Host 已 sanitize + 512KB 上限，这里是第二道防线；
   也覆盖"会话回放里 meta 来自更早/异常版本"的情况）。
2. **`dsh.client.immediately: true` 可以去掉**：它让 shell 在模块面启动阶段就 prefetch 这个 bundle
   （`client-modules` 的 `prefetchImmediateTier`），但 tool 卡片不是启动关键路径，省略可少一次
   early request，不影响功能。
3. **错误卡语义提示**：`state` 里用 `block.error?.code === 'interrupted'` 判"已中止"与 ui-tool 一致
   （`ui-tool/lib/client.js:283` 同款写法）；抛错类工具错误的正文由 DSH 写进 content
   （`dsh-tools/lib/index.js:3710-3725` 的 `toolErrorResult` → `Error: <message>`），
   所以 `resultText(block)` 能显示 Mermaid 行号/列号诊断，无需额外读 `error.message`。✅
4. **（可选）展开/收起源码**：若后续想加"Mermaid 源码"折叠，用 props 里的 `useDisclosure`
   （必须无条件调用），现在没有 hook 所以也无 hook 顺序问题。

**未复核内容**：Host 半身 `plugin/index.js` 的工具注册/presentationMeta（属于 Lead 的 task）、
profile 安装与重启、真实浏览器渲染（需要集成后验证）。
