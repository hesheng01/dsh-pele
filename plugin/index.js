/**
 * dsh-pele — 用 pele（obsidianmd/pele，Mermaid → SVG 渲染器）在 DSH 会话中绘图。
 *
 * Host 半身职责：
 *   1. 注册模型工具 `pele_draw(diagram, title?)`：
 *      - 在 Host 进程内用 pele 把 Mermaid 源码渲染成 SVG（同步、纯 JS、无 DOM 依赖）；
 *      - 解析失败时抛出带行号/列号/snippet 的错误，让模型能自行修正语法；
 *      - 通过 `output.presentationMeta` 把 SVG 交给 Web 客户端（不进入模型上下文），
 *        由客户端插件 dsh-pele/client.js 在会话卡片里内联显示；
 *      - 不落盘：卡片右上角提供「下载 SVG / 下载 PNG」，由浏览器端按需导出。
 *   2. 把可调参数放进插件 Config（web profile 的 cordis.patch.yml 按 id `pele` 覆盖）。
 *
 * 为什么 SVG 走 presentationMeta 而不是工具结果文本：
 *   SVG 通常几 KB 到几十 KB，直接进模型上下文既浪费 token 又干扰推理；
 *   `meta` 字段只持久化在 tool/result 事件上供 Client 渲染器读取，模型看不到。
 *   因此 canonical 输出里的 `svg` 只被 render()/presentationMeta() 使用，
 *   模型看到的是 render() 生成的摘要文本。
 *
 * 主题：pele 生成的 SVG 用 CSS 变量取色（--pele-*，带默认回退），
 *   客户端卡片把 DSH 主题 token 映射到这些变量，因此同一份 SVG 在明/暗主题下都正确。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { humanBytes, renderDiagram } from './render.js';

/** 插件名（与 cordis.patch.yml 里的行 id 一致）。 */
export const name = 'pele';

/** 依赖的 Host 服务：工具注册表。 */
export const inject = ['tools'];

/** 模型可见的工具名（客户端 tool.call.toolview 用同一个 key 注册卡片）。 */
export const TOOL_NAME = 'pele_draw';

/** 默认配置；cordis.patch.yml 的 config 会按键覆盖。 */
const DEFAULT_CONFIG = {
	/** 单次 Mermaid 源码字节上限。 */
	maxSourceBytes: 200_000,
	/** 单次 SVG 输出字节上限（超过则拒绝，防止超大图拖垮会话日志）。 */
	maxSvgBytes: 1_500_000,
	/** 传给客户端的内联 SVG 上限；超过时卡片提示图表过大（不落盘、不可下载）。 */
	maxInlineSvgBytes: 512_000,
	/** 工具调用整体超时（毫秒；pele 渲染是同步的，这里约束一次调用的总时长）。 */
	timeoutMs: 20_000,
	/** 是否向 Agent 系统提示注入一段「何时/如何调用 pele_draw」的说明（建议开启）。 */
	prompt: true,
};

/**
 * 校验并归一化配置；错误直接抛出，让组合层在启动时就暴露问题。
 * @param raw - cordis.patch.yml 里的 config 对象。
 */
function normalizeConfig(raw) {
	const cfg = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
	if (typeof cfg.prompt !== 'boolean') throw new Error('pele: config.prompt 必须是布尔值');
	for (const key of ['maxSourceBytes', 'maxSvgBytes', 'maxInlineSvgBytes', 'timeoutMs']) {
		if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) {
			throw new Error(`pele: config.${key} 必须是正数`);
		}
	}
	return cfg;
}

/**
 * 注入系统提示的说明文本：只在工具对该 Agent 可见时出现（text 里做可见性判断）。
 * 内容保持稳定，避免破坏请求前缀的 KV 缓存；写入的是「何时用、怎么避坑」而不是使用细节。
 */
const PROMPT_TEXT = [
	'## 图表（pele_draw）',
	'需要给用户展示流程图、架构图、时序图、状态图、类图、ER 图、甘特图、饼图、柱状/折线图、思维导图等可视化时，调用 pele_draw 传入 Mermaid 12.1 源码；不要用 ASCII/文字画图。',
	'- 首行必须是图表类型关键字（如 flowchart LR、sequenceDiagram、mindmap、xychart-beta）。',
	'- 一张图一次调用；多张图分开调用，各自出现在消息流里。',
	'- mindmap 的节点文本不要以 "mindmap" 开头（大小写都算，会被当作关键字而解析失败）；改写为「思维导图 mindmap」、加引号 "mindmap"，或用 id[label] 形式如 mm[mindmap]。',
	'- 语法错误会返回行号/列号与片段：按提示修正后重试；不要重复提交已经成功的同一张图。',
	'- 图表已在会话中显示；回复里不要再粘贴 SVG 或整段 Mermaid（用户明确要求时除外）。',
	'- 不需要把图保存成文件：卡片右上角提供「下载 SVG / 下载 PNG」，由用户自行导出。',
].join('\n');

/**
 * 插件入口。
 * @param ctx - Host 插件上下文。
 * @param rawConfig - cordis.patch.yml 中该行的 config。
 */
export function apply(ctx, rawConfig) {
	const cfg = normalizeConfig(rawConfig);
	const tools = ctx.get('tools');
	if (tools === undefined) return;

	const disposers = [];
	disposers.push(
		tools.register(
			defineTool({
				name: TOOL_NAME,
				timeoutMs: cfg.timeoutMs,
				description:
					'用 pele 把 Mermaid 源码渲染成 SVG 图表，并直接显示在当前会话的消息卡片里（卡片右上角可下载 SVG/PNG）。' +
					' 适合流程图、时序图、类图、状态图、ER 图、甘特图、饼图、柱状/折线图(xychart)、思维导图、时间线、架构图、看板等可视化。' +
					' 输出是矢量图：模型只需提供 Mermaid 源码，不要自己生成 SVG/ASCII 图。' +
					' 只支持 Mermaid 12.1 语法；语法错误会返回具体行号，修正后重试即可。' +
					' 注意：mindmap 的节点文本不要以 “mindmap” 开头（会被当成图表关键字而解析失败），可改写为「思维导图 mindmap」或 mm[mindmap]。' +
					' 同一张图不要重复调用：图形已在会话界面渲染，工具结果只返回类型、尺寸与字节数。',
				parameters: {
					diagram: {
						type: 'string',
						required: true,
						description:
							'Mermaid 图表源码。首行必须是图表类型关键字，例如：flowchart LR\\n  A[开始] --> B{判断}\\n  B -->|是| C[执行]。' +
							' 支持类型包括 flowchart、sequenceDiagram、classDiagram、stateDiagram-v2、erDiagram、gantt、pie、quadrantChart、xychart-beta、mindmap、timeline、journey、gitGraph，以及 sankey-beta、block-beta、kanban、architecture-beta、radar-beta、treemap-beta、C4、requirementDiagram、venn、wardley、cynefin、swimlane、ishikawa、eventmodeling、treeView、railroad、usecase、agentflow 等。',
					},
					title: {
						type: 'string',
						description: '图表标题（可选）：显示在卡片标题与下载文件名中，例如「鉴权流程」。',
					},
				},
				output: {
					// 注意：这里是 dsh-tools 的「值 schema DSL」（ValueSchemaSpec），不是原始 JSON Schema：
					// 必填标记写在每个属性上（required: true），没有顶层 required 数组。
					schema: {
						type: 'object',
						properties: {
							type: { type: 'string', required: true, description: 'pele 图表类型，如 flowchart。' },
							mermaidType: { type: 'string', required: true, description: 'Mermaid 语法族，如 flowchart-v2。' },
							width: { type: 'number', required: true },
							height: { type: 'number', required: true },
							bytes: { type: 'number', required: true, description: 'SVG 字节数。' },
							svg: { type: 'string', required: true, description: '渲染出的 SVG（canonical 值；供 Client 卡片内联显示，不进入模型上下文）。' },
						},
						additionalProperties: false,
					},
					render: (_args, value) => {
						return [{
							type: 'text',
							text: [
								`已用 pele 渲染 ${value.mermaidType} 图表（${value.width}×${value.height}，${humanBytes(value.bytes)}）。`,
								'图表已在会话界面中显示（卡片右上角可下载 SVG/PNG）；无需再把 Mermaid 源码或 SVG 粘贴进回复。',
							].join('\n'),
						}];
					},
					presentationMeta: (args, value) => {
						/** @type {Record<string, unknown>} */
						const meta = {
							version: 1,
							type: value.type,
							mermaidType: value.mermaidType,
							width: value.width,
							height: value.height,
							bytes: value.bytes,
							title: typeof args?.title === 'string' && args.title.trim() !== '' ? args.title.trim() : null,
						};
						const svg = typeof value.svg === 'string' ? value.svg : '';
						if (svg !== '' && Buffer.byteLength(svg, 'utf8') <= cfg.maxInlineSvgBytes) {
							meta.svg = svg;
						} else if (svg !== '') {
							meta.svgOmitted = true;
							meta.svgOmittedReason = `SVG 超过会话内联上限（${humanBytes(cfg.maxInlineSvgBytes)}），请精简图表`;
						}
						return meta;
					},
				},
				async execute(args, exec) {
					const source = typeof args.diagram === 'string' ? args.diagram : '';
					if (source.trim() === '') {
						throw new Error('pele_draw: diagram 不能为空，请提供 Mermaid 源码（首行为图表类型，例如 flowchart LR）。');
					}
					if (Buffer.byteLength(source, 'utf8') > cfg.maxSourceBytes) {
						throw new Error(
							`pele_draw: Mermaid 源码超过上限（${humanBytes(cfg.maxSourceBytes)}），请拆成多张图或精简内容。`,
						);
					}
					if (exec.signal.aborted) throw new Error('pele_draw: 调用已取消');

					const rendered = renderDiagram(source);
					if (rendered.bytes > cfg.maxSvgBytes) {
						throw new Error(
							`pele_draw: 生成的 SVG 过大（${humanBytes(rendered.bytes)}，上限 ${humanBytes(cfg.maxSvgBytes)}），请精简图表。`,
						);
					}

					return {
						type: rendered.type,
						mermaidType: rendered.mermaidType,
						width: rendered.width,
						height: rendered.height,
						bytes: rendered.bytes,
						// canonical 值：模型只看到 render() 生成的摘要；svg 仅进 presentationMeta 供 Web 卡片使用。
						svg: rendered.svg,
					};
				},
				presentCall(callArgs) {
					const title = typeof callArgs?.title === 'string' && callArgs.title.trim() !== ''
						? `绘制图表：${callArgs.title.trim()}`
						: '绘制图表';
					return { card: 'generic', title, kind: 'other' };
				},
			}),
		),
	);

	// 系统提示注入：text 里按 Agent 作用域判断工具是否可见，避免提示与工具表不一致。
	if (cfg.prompt) {
		const systemPrompt = ctx.get('systemPrompt');
		if (systemPrompt !== undefined) {
			disposers.push(
				systemPrompt.section({
					name: 'tool:pele-diagrams',
					// 2100=TOOL_WEB_FETCH、2200=TOOL_LSP 之间：紧邻其它"可视化/获取"类工具提示。
					order: 2150,
					text: ({ scope }) => (tools.get(TOOL_NAME, scope) === undefined ? '' : PROMPT_TEXT),
				}),
			);
		}
	}

	return () => {
		for (const dispose of disposers) dispose();
	};
}
