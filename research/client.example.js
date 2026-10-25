/**
 * dsh-pele —— Web 客户端半身（纯 JS，无构建步骤；可直接被宿主当作经典脚本下发）。
 *
 * 目标：为 wire tool 名 `pele_draw` 注册 `tool.call.toolview` 卡片：
 *   - preparing 阶段：占位卡（流式参数里能读到的 title 先显示出来）；
 *   - start     阶段：占位卡（"正在渲染图表…"）；
 *   - result    阶段：把 Host 通过 `output.presentationMeta` 塞进 `tool/result.meta.svg`
 *                  的 SVG 内联渲染成自适应宽度的卡片；错误/超限时显示降级卡片。
 *
 * 契约要点（证据见 research/client-contract.md）：
 *   1. 整个文件只有一条顶层语句 `window.__ModuleLoader__.load({...})`。
 *      宿主会把多个插件的 client.js 用 `;\n` 拼进同一个经典 <script>，顶层再声明
 *      const/let 会与其他插件撞名 -> 整段脚本 SyntaxError。所有代码必须在 factory 闭包里。
 *   2. `id` 必须严格等于包名（= 宿主 Loader entry 名 = __DSH_BOOT__ 的 row id）。
 *   3. factory 是惰性 CJS 工厂：脚本执行时只注册，首次 materialize 才执行闭包；
 *      返回的 exports 就是 Cordis 插件对象（`{ apply, inject }`）。
 *   4. 只 require 平台种子表里的模块：react / react/jsx-runtime / react-dom /
 *      react-dom/client / @deepseek-ai/cordis / zod / @tanstack/react-virtual /
 *      @deepseek-ai/dsh-client-store / @deepseek-ai/dsh-client-ui-slots /
 *      @deepseek-ai/dsh-client-ui-primitives / @deepseek-ai/dsh-client-ui-dockkit。
 *      其它包必须先写进 package.json 的 dsh.client.external 且确实是 boot graph 里的一行。
 *   5. 不要用 JSX / ESM import/export / top-level await：这是经典脚本 + CJS 工厂。
 *   6. CSS 只能在 factory（materialize）内注入：module system 在 materialize 前后抓
 *      untagged <style> 并打上 data-plugin 归属，宿主/ HMR 卸载时按这个归属清理。
 *
 * 依赖的 Cordis 服务：slots（由 @deepseek-ai/dsh-client-ui-renderer 提供）。
 * slot `tool.call.toolview` 由 @deepseek-ai/dsh-client-ui-tool 注册 conversation.chat.node
 * 时作为 children 声明；所以必须用 slots.inject(...) 等声明出现后再 register。
 */
window.__ModuleLoader__.load({
	id: 'dsh-pele',
	factory: (require) => {
		const React = require('react');

		/** 与 Host 半身 lib/index.js 的 TOOL_NAME 必须逐字一致；拼错不会报错，只会一直走通用 Tool 行。 */
		const TOOL_NAME = 'pele_draw';
		/** Tool 层按 wire tool 名做 keyed 分发。 */
		const SLOT = 'tool.call.toolview';
		/** 客户端渲染 SVG 的自保上限：超过则只给文件路径/提示，不把巨型 SVG 塞进 DOM。 */
		const MAX_INLINE_SVG_CHARS = 600 * 1024;

		// ── 样式：materialize 时注入一次；data-plugin / data-plugin-css 是宿主 CSS 归属约定 ──
		const CSS = [
			'.dsh-pele-card{box-sizing:border-box;max-width:100%;min-width:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5',
			/* 把 DSH 主题 token 映射成 pele SVG 内部的 --pele-* 变量（SVG 里用 var(--pele-bg,#fff) 这种带回退的写法）。 */
			'--pele-bg:var(--dsw-alias-bg-base);--pele-fg:var(--dsw-alias-label-primary);--pele-muted:var(--dsw-alias-label-tertiary);--pele-line:var(--dsw-alias-border-l2);--pele-surface:var(--dsw-alias-bg-layer-1);--pele-surface-alt:var(--dsw-alias-bg-layer-2);--pele-border:var(--dsw-alias-border-l3);--pele-accent:var(--dsw-alias-brand-primary);--pele-error:var(--dsw-alias-state-error-primary);--pele-critical:var(--dsw-alias-state-error-primary);--pele-font:var(--dsh-font-family-text,sans-serif);--pele-font-mono:var(--dsh-font-family-code,monospace);--pele-radius:var(--dsw-radius-md,12px)}',
			'.dsh-pele-head{display:flex;align-items:center;gap:8px;min-width:0}',
			'.dsh-pele-dot{flex:none;width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-state-success-primary,#57ab5a)}',
			'.dsh-pele-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
			'.dsh-pele-meta{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
			'.dsh-pele-body{min-width:0;max-width:100%;overflow-x:auto}',
			'.dsh-pele-body svg{display:block;max-width:100%;height:auto;margin:0 auto}',
			'.dsh-pele-placeholder{display:flex;align-items:center;gap:8px;padding:12px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-pele-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto}',
			'.dsh-pele-foot{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}',
			'.dsh-pele-link{cursor:pointer;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary)}',
			'.dsh-pele-link:hover{color:var(--dsw-alias-label-primary)}',
			'.dsh-pele-pre{margin:0;padding:8px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-markdown-code-block,#0000000d);font:12px/1.5 var(--dsh-font-family-code,monospace);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto}',
		].join('\n');

		(function injectCss() {
			if (typeof document === 'undefined') return;
			const tagId = 'dsh-pele/PeleCard.css';
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-pele';
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		})();

		// ── 参数 / 结果读取 ───────────────────────────────────────────────────────

		/**
		 * 取参数：start/result 用完整 JSON 文本（argsRaw），preparing 用惰性 PartialArguments 视图。
		 * PartialArguments 的读取方法（0.2.1）：has/complete/text/textPrefix/stringLength/value/keys/closed/isSealed。
		 * 每个 reader 都是 total 的：字段缺失或类型不符返回 undefined/false，不抛异常。
		 * @param {object|undefined} block - PreparingToolCall | StartedToolCall | ToolResultNode
		 * @returns {Record<string, unknown>} 已能读到的顶层参数（永远返回对象）
		 */
		function readArgs(block) {
			if (block === undefined || block === null || typeof block !== 'object') return {};
			/** @type {string|null} */
			let raw = null;
			if (typeof block.argsRaw === 'string') {
				raw = block.argsRaw; // start 阶段：派发时的完整参数 JSON
			} else if (block.call !== null && block.call !== undefined && typeof block.call.argsRaw === 'string') {
				raw = block.call.argsRaw; // result 阶段：配对的 call head（call 落在窗口外时为 null）
			}
			if (raw !== null) {
				try {
					const value = JSON.parse(raw);
					if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
				} catch {
					/* 不完整/损坏的 JSON 当作没有参数 */
				}
				return {};
			}
			const args = block.args;
			if (args === undefined || args === null || typeof args !== 'object') return {};
			const out = {};
			// 只读我们卡片关心的字段；complete(key) 表示该字段的闭合定界符已到，值才可信。
			for (const key of ['title', 'save', 'path', 'diagram']) {
				if (typeof args.complete === 'function' && args.complete(key) !== true) continue;
				if (key === 'save') {
					if (typeof args.value === 'function') {
						const value = args.value(key);
						if (value !== undefined) out[key] = value;
					}
					continue;
				}
				if (typeof args.text === 'function') {
					const text = args.text(key);
					if (text !== undefined) out[key] = text;
				}
			}
			return out;
		}

		/** 参数是否已经完整可解析：只读 argsRaw 判定，preparing 阶段永远视为不完整。 */
		function argsComplete(block) {
			if (block === undefined || block === null || typeof block !== 'object') return false;
			if (typeof block.argsRaw === 'string') {
				try {
					JSON.parse(block.argsRaw);
					return true;
				} catch {
					return false;
				}
			}
			if (block.call !== null && block.call !== undefined && typeof block.call.argsRaw === 'string') {
				try {
					JSON.parse(block.call.argsRaw);
					return true;
				} catch {
					return false;
				}
			}
			// preparing：args.closed() 为 true 表示外层对象已闭合；isSealed 表示已 settle。
			const args = block.args;
			if (args === undefined || args === null || typeof args !== 'object') return false;
			if (typeof args.closed === 'function' && args.closed() === true) return true;
			return args.isSealed === true;
		}

		/** 结果展示文本：text block 原样拼接，其它 block（图片等）忽略；空内容时退回结构化错误。 */
		function resultText(block) {
			const parts = [];
			const content = block !== null && block !== undefined && Array.isArray(block.content) ? block.content : [];
			for (const item of content) {
				if (item !== null && item !== undefined && item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
			}
			if (parts.length === 0 && block !== null && block !== undefined && block.error !== undefined && block.error !== null) {
				const name = typeof block.error.name === 'string' ? block.error.name : 'Error';
				const code = typeof block.error.code === 'string' ? block.error.code : '';
				parts.push(code === '' ? name : name + ': ' + code);
			}
			return parts.join('\n');
		}

		/** 读取 Host `output.presentationMeta` 投递到 tool/result.meta 的展示元数据（JSON 对象）。 */
		function readMeta(block) {
			const meta = block !== null && block !== undefined ? block.meta : undefined;
			if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) return null;
			return meta;
		}

		/**
		 * 防御性清理：pele 自身已转义文本并过滤链接/样式，这里再剥掉脚本、foreignObject、
		 * 内联事件与 javascript: URL，避免历史版本或异常输入带来注入面。
		 * 注意：只有以 <svg 开头的内容才交给 dangerouslySetInnerHTML。
		 */
		function sanitizeSvg(svg) {
			const text = String(svg).trim();
			if (!/^<svg[\s>]/i.test(text)) return null;
			return text
				.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
				.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
				.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
				.replace(/\s(?:xlink:href|href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
		}

		function humanBytes(bytes) {
			if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
			if (bytes < 1024) return String(bytes) + ' B';
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
			return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
		}

		/** 把绝对路径缩写为工作区相对路径（仅用于展示）。 */
		function displayPath(path, cwd) {
			if (typeof path !== 'string' || path === '') return '';
			if (typeof cwd === 'string' && cwd !== '' && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1);
			return path;
		}

		// ── 组件 ─────────────────────────────────────────────────────────────────

		function Placeholder(props) {
			return React.createElement(
				'div',
				{ className: 'dsh-pele-placeholder', title: props.title },
				React.createElement('span', { className: 'dsh-pele-dot', 'aria-hidden': 'true' }),
				React.createElement('span', null, props.label),
			);
		}

		/** 已落定结果的主体：SVG 卡片 / 降级提示 / 错误。 */
		function ResultBody(props) {
			const { block, meta } = props;
			if (block.isError === true) {
				return React.createElement(
					'div',
					{ className: 'dsh-pele-error', role: 'alert' },
					resultText(block) || 'pele_draw 执行失败',
				);
			}
			const svg = meta !== null && typeof meta.svg === 'string' ? sanitizeSvg(meta.svg) : null;
			if (svg !== null && svg.length <= MAX_INLINE_SVG_CHARS) {
				// 唯一允许 innerHTML 的位置：内容是 Host sanitizeSvg 后的 pele SVG，且以 <svg 开头。
				return React.createElement('div', {
					className: 'dsh-pele-body',
					dangerouslySetInnerHTML: { __html: svg },
				});
			}
			const reason = meta !== null && typeof meta.svgOmittedReason === 'string'
				? meta.svgOmittedReason
				: svg === null
					? '本次结果没有可内联的 SVG（可能来自旧会话或超出内联上限）。'
					: 'SVG 过大，避免阻塞页面渲染，未在会话内内联。';
			const saved = meta !== null && typeof meta.saved === 'string' ? meta.saved : '';
			return React.createElement(
				'div',
				{ className: 'dsh-pele-placeholder', title: reason },
				React.createElement('span', null, reason),
				saved === '' ? null : React.createElement('span', null, ' · ' + displayPath(saved, props.cwd)),
			);
		}

		/** 卡片脚注：展开源码/详情、打开已保存文件、查看轨迹。 */
		function CardFoot(props) {
			const { disclosure, source, saved, inspect, openFile, cwd } = props;
			return React.createElement(
				'div',
				{ className: 'dsh-pele-foot' },
				source === '' ? null : React.createElement(
					'button',
					{ type: 'button', className: 'dsh-pele-link', onClick: disclosure.toggle },
					disclosure.expanded ? '收起 Mermaid 源码' : '查看 Mermaid 源码',
				),
				saved === '' ? null : React.createElement(
					'button',
					{
						type: 'button',
						className: 'dsh-pele-link',
						title: saved,
						onClick: () => { openFile(saved); },
					},
					'打开 ' + displayPath(saved, cwd),
				),
				typeof inspect === 'function' ? React.createElement(
					'button',
					{ type: 'button', className: 'dsh-pele-link', onClick: inspect },
					'轨迹',
				) : null,
			);
		}

		/**
		 * `tool.call.toolview` 的 keyed Tool 视图。
		 *
		 * props 由 framework 组装（owner props 优先）：
		 *   phase: 'preparing' | 'start' | 'result'
		 *   block: PreparingToolCall | StartedToolCall | ToolResultNode
		 *   callId / toolName / cwd / home / openFile / loadImage / useDisclosure / inspect
		 *   + session 标准位（sessionId / useSession / useProjection / useAccess / ...）
		 * 未声明 locale，因此没有 t；文案直接写中文。
		 */
		function PeleCard(props) {
			// 无条件调用（hook 顺序约束）：useDisclosure 是 framework 传入的 per-call hook。
			const disclosure = typeof props.useDisclosure === 'function'
				? props.useDisclosure()
				: { expanded: false, setExpanded: function () {}, toggle: function () {} };

			const block = props.block;
			const phase = typeof props.phase === 'string'
				? props.phase
				: block !== null && block !== undefined && block.kind === 'tool-result'
					? 'result'
					: block !== null && block !== undefined && block.phase === 'start'
						? 'start'
						: 'preparing';
			const args = readArgs(block);
			const meta = phase === 'result' ? readMeta(block) : null;
			const title = typeof args.title === 'string' && args.title !== ''
				? args.title
				: meta !== null && typeof meta.title === 'string' && meta.title !== ''
					? meta.title
					: 'Mermaid 图表';
			const source = typeof args.diagram === 'string' ? args.diagram : '';
			const saved = meta !== null && typeof meta.saved === 'string' ? meta.saved : '';
			const metaBits = [];
			if (meta !== null) {
				if (typeof meta.width === 'number' && typeof meta.height === 'number') metaBits.push(String(meta.width) + '×' + String(meta.height));
				if (typeof meta.bytes === 'number') metaBits.push(humanBytes(meta.bytes));
			}
			const status = phase === 'preparing' ? '准备中…' : phase === 'start' ? '绘制中…' : block !== null && block !== undefined && block.isError === true ? '失败' : '完成';

			const body = phase === 'result'
				? React.createElement(ResultBody, { block: block, meta: meta, cwd: props.cwd })
				: React.createElement(Placeholder, {
					label: phase === 'preparing' ? '正在准备图表参数…' : '正在渲染 Mermaid 图表…',
					title: title,
				});

			const foot = phase === 'result' || source !== ''
				? React.createElement(CardFoot, {
					disclosure: disclosure,
					source: source,
					saved: saved,
					inspect: props.inspect,
					openFile: typeof props.openFile === 'function' ? props.openFile : function () {},
					cwd: props.cwd,
				})
				: null;

			const sourceBlock = disclosure.expanded && source !== ''
				? React.createElement('pre', { className: 'dsh-pele-pre' }, source)
				: null;

			return React.createElement(
				'div',
				{ className: 'dsh-pele-card', 'data-pele-card': '', 'data-pele-phase': phase },
				React.createElement(
					'div',
					{ className: 'dsh-pele-head' },
					React.createElement('span', { className: 'dsh-pele-dot', 'aria-hidden': 'true' }),
					React.createElement('span', { className: 'dsh-pele-title', title: title }, '绘制图表 · ' + title),
					React.createElement('span', { className: 'dsh-pele-meta' }, [status].concat(metaBits).join(' · ')),
				),
				body,
				sourceBlock,
				foot,
			);
		}

		// ── 注册 ─────────────────────────────────────────────────────────────────

		/**
		 * 注册 keyed Tool 视图。key 必须等于 wire tool 名（`pele_draw`）。
		 * 用 slots.inject 等待 ui-tool 声明 `tool.call.toolview`（它把该 slot 声明为自己
		 * 注册 conversation.chat.node 的 children）；声明未出现时直接 register 会抛
		 * `slot "tool.call.toolview" is not declared`，并让整个 Web 启动审计失败。
		 */
		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined || slots === null) return;
			slots.inject(SLOT, () => slots.register({ name: SLOT, key: TOOL_NAME }, PeleCard));
		}

		/** Cordis 服务依赖：slots 由 @deepseek-ai/dsh-client-ui-renderer 提供。 */
		const inject = ['slots'];

		return { apply, inject };
	},
});
