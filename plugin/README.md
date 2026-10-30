# dsh-pele（插件包）

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

DSH bundle：注册模型工具 **`pele_draw`**，用 [pele](https://github.com/obsidianmd/pele) 把 Mermaid 源码渲染成 SVG，并在 Web 会话中以内联卡片显示。

- Host 半身：`index.js` + `render.js`（工具注册、渲染、`presentationMeta`、错误诊断、系统提示）
- 浏览器半身：`client.js`（`tool.call.toolview`，key=`pele_draw`；含卡片右上角的 SVG/PNG 下载菜单；卡片内查看器为「点击激活」交互：点击后滚轮缩放、右键平移、左键框选、双击切换全屏、中键复位，工具栏另有「适应窗口 / 全屏」按钮）
- 依赖：无（`@deepseek-ai/dsh-tools` 等由 DSH 安装提供，声明为 peerDependencies；pele 已 vendored）
- 显示元数据：`locale/zh.json`、`locale/en.json`；图标 `icon.svg`

## 安装

```bash
# DSH 会话内：
# plugin_manager action=install_bundle, target=<repo>/plugin
# 或旧版命令行：
dsh plugin --profile web add <repo>/plugin
```

首次安装需要重启 Host；修改 `client.js` 后浏览器端由 client-modules 的 HMR 触发热替换。

## 配置（profile 的 cordis.patch.yml，按 id `pele`）

```yaml
- id: pele
  config:
    maxSourceBytes: 200000
    maxSvgBytes: 1500000
    maxInlineSvgBytes: 512000
    timeoutMs: 20000
    prompt: true                  # 是否向 Agent 系统提示注入图表使用说明
```

注入的说明覆盖：何时调用 `pele_draw`、首行必须是图表类型关键字、一张图一次调用、mindmap 节点文本不要以 `mindmap` 开头、按错误行号修正、不要在回复里重复粘贴 SVG、不需要落盘（卡片右上角可下载）。

## 工具参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `diagram` | string（必填） | Mermaid 源码，首行是图表类型关键字 |
| `title` | string | 卡片标题与下载文件名 |

工具结果只返回摘要（类型、尺寸、字节）；SVG 通过 `presentationMeta` 写入 `tool/result.meta`，供客户端卡片渲染，不进入模型上下文。插件不写工作区文件：用户需要文件时，点卡片右上角的下载按钮导出 **SVG**（主题中立的矢量图）或 **PNG**（跟随当前明/暗主题的位图，2x 栅格化）。

## 主题与安全

- SVG 的颜色使用 pele 的 `--pele-*` CSS 变量；卡片把 DSH 主题 token（`--dsw-alias-*`）映射过去，明暗主题自动跟随。
- Host 与 Client 都会清洗 SVG（移除脚本、`foreignObject`、内联事件、`javascript:` 链接）；Client 限制 SVG ≤600KB 且必须以 `<svg` 开头。
- 不落盘：所有 HTML/文件操作只在浏览器端发生，导出由用户点击触发。

## License

MIT。vendored `pele` 1.12.0 同样为 MIT（版权 kepano），见 `vendor/pele.LICENSE`。
