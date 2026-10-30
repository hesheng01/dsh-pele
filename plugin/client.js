/**
 * dsh-pele 浏览器半身：把 `pele_draw` 工具调用渲染成会话里的内联图表卡片。
 *
 * 数据来源：Host 工具把 pele 渲染出的 SVG 放进 tool result 的 `meta`
 * （presentationMeta），模型上下文里只有摘要文本。这里从 `block.meta` 取 SVG，
 * 用 dangerouslySetInnerHTML 注入；SVG 本身用 CSS 变量取色（--pele-*），
 * 所以把 DSH 主题 token 映射到这些变量后，同一份 SVG 在明/暗主题下都正确。
 *
 * 交互查看器：
 *   - 滚轮上/下 = 以光标为中心放大/缩小；
 *   - 右键拖动 = 平移；
 *   - 左键拖动 = 框选，松开后把框选区域铺满当前查看窗口；
 *   - 双击 = 进入 / 退出全屏（全屏层里再双击即退出）；
 *   - 中键单击 = 复位（适应窗口）；
 *   - 查看器右上角工具栏：适应窗口、全屏（全屏层里为退出全屏，Esc 也可退出）。
 *
 * 卡片右上角的下载按钮提供两种导出：
 *   - SVG：直接导出 Host 渲染的原始 SVG（主题中立，用 pele 的浅色回退变量，任何地方都可见）；
 *   - PNG：把当前页面上实际渲染的 SVG（含当前明/暗主题颜色）栅格化，背景取卡片背景，
 *     所见即所得。导出逻辑全部在浏览器端完成，不写工作区文件。
 *
 * 加载方式：profile 安装的 bundle 由 dsh-client-modules 以浏览器 bundle 的形式
 * 服务；本文件在加载时只注册一个 lazy factory（window.__ModuleLoader__.load），
 * 真正的注册逻辑在 factory 被 materialize 时执行（与 peak-shift 等纯 JS 插件一致）。
 */
window.__ModuleLoader__.load({
	id: 'dsh-pele',
	factory: (require) => {
		const React = require('react');
		const h = React.createElement;

		/** 字典命名空间（与 Host 半身无关，仅用于本卡片的界面文案）。 */
		const NS = 'pele';

		/** 简体中文字典。 */
		const zh = {
			'card.title': 'Pele 图表',
			'card.preparing': '准备绘制图表…',
			'card.running': '正在绘制图表…',
			'card.failed': '图表渲染失败',
			'card.stopped': '图表渲染已中止',
			'card.empty': '没有可显示的图表数据',
			'card.tooLarge': '图表过大，未能在会话内联显示；请精简图表后重试',
			'card.diagram': '图表',
			'download.button': '下载图表',
			'download.svg': '下载 SVG',
			'download.png': '下载 PNG',
			'download.svgHint': '矢量图（主题中立）',
			'download.pngHint': '位图（当前主题）',
			'download.failed': '导出失败，请重试',
			'viewer.hint': '滚轮缩放 · 右键拖动 · 左键框选 · 双击全屏 · 中键复位',
			'viewer.hintFullscreen': '滚轮缩放 · 右键拖动 · 左键框选 · 双击或 Esc 退出全屏 · 中键复位',
			'viewer.activate': '点击开始交互 · 双击全屏 · 未激活时滚轮滚动页面',
			'viewer.deactivate': 'Esc 退出交互',
			'viewer.fit': '适应窗口',
			'viewer.fullscreen': '全屏查看',
			'viewer.exit': '退出全屏',
		};

		/** English dictionary（键集合与 zh 一致）。 */
		const en = {
			'card.title': 'Pele diagram',
			'card.preparing': 'Preparing diagram…',
			'card.running': 'Rendering diagram…',
			'card.failed': 'Diagram rendering failed',
			'card.stopped': 'Diagram rendering stopped',
			'card.empty': 'No diagram data to show',
			'card.tooLarge': 'Diagram is too large for inline display; simplify it and retry',
			'card.diagram': 'Diagram',
			'download.button': 'Download diagram',
			'download.svg': 'Download SVG',
			'download.png': 'Download PNG',
			'download.svgHint': 'Vector, theme-neutral',
			'download.pngHint': 'Bitmap, current theme',
			'download.failed': 'Export failed, please retry',
			'viewer.hint': 'Wheel to zoom · right-drag to pan · left-drag to box-zoom · double-click for fullscreen · middle-click to reset',
			'viewer.hintFullscreen': 'Wheel to zoom · right-drag to pan · left-drag to box-zoom · double-click or Esc to exit fullscreen · middle-click to reset',
			'viewer.activate': 'Click to interact · double-click for fullscreen · wheel scrolls the page until then',
			'viewer.deactivate': 'Esc to exit interaction',
			'viewer.fit': 'Fit to window',
			'viewer.fullscreen': 'View fullscreen',
			'viewer.exit': 'Exit fullscreen',
		};

		/**
		 * pele 主题变量 → DSH 主题 token 的映射。
		 * pele 的 SVG 里所有颜色都写成 var(--_x)，而 --_x 又指向 var(--pele-x, 默认值)；
		 * 因此在容器上覆盖 --pele-* 就能让图表跟随 Harness 的明/暗主题。
		 */
		const THEME_VARS = {
			// 边标签背景：pele 给每个边标签画了一个 fill=var(--_bg) 的圆角矩形。
			// 若 --pele-bg 设成 transparent，这个遮罩就消失，连线会从标签文字中间穿过；
			// 设成卡片底色既与卡片背景一致，又能正确遮住标签下方的连线。
			'--pele-bg': 'var(--dsw-alias-bg-layer-1)',
			// 文字也混入蓝调（而不是纯黑/纯灰）：浅色主题下是深蓝，深色主题下是浅蓝，可读性不变。
			'--pele-fg': 'color-mix(in srgb, #3b82f6 42%, var(--dsw-alias-label-primary))',
			'--pele-muted': 'color-mix(in srgb, #3b82f6 38%, var(--dsw-alias-label-secondary))',
			// 结构与文字保持主题 token（保证可读性）；连线/节点带一点蓝调，避免整片黑白灰。
			'--pele-line': 'color-mix(in srgb, #3b82f6 42%, var(--dsw-alias-label-primary))',
			'--pele-surface': 'color-mix(in srgb, #3b82f6 12%, var(--dsw-alias-bg-layer-1))',
			'--pele-surface-alt': 'color-mix(in srgb, #3b82f6 18%, var(--dsw-alias-bg-layer-1))',
			'--pele-border': 'color-mix(in srgb, #3b82f6 34%, var(--dsw-alias-border-l1))',
			// 系列色：不再跟随品牌色（默认主题下品牌色接近纯黑，饼图/柱线/桑基会显得脏），
			// 改用一组饱和、明暗主题下都有足够对比度的调色板。
			'--pele-accent': '#3b82f6',
			'--pele-font':
				'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ' +
				'"Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
			'--pele-font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
			'--pele-radius': '6px',
			'--pele-series-1': '#3b82f6', // 蓝
			'--pele-series-2': '#22c55e', // 绿
			'--pele-series-3': '#f59e0b', // 琥珀
			'--pele-series-4': '#ef4444', // 红
			'--pele-series-5': '#8b5cf6', // 紫
			'--pele-series-6': '#06b6d4', // 青
			'--pele-series-7': '#ec4899', // 粉
			'--pele-series-8': '#84cc16', // 青柠
		};

		/** 卡片外壳样式。 */
		const CARD_STYLE = {
			border: '1px solid var(--dsw-alias-border-l1)',
			borderRadius: 10,
			background: 'var(--dsw-alias-bg-layer-1)',
			overflow: 'hidden',
			minWidth: 0,
		};

		/** 头部一行：图标 + 标题 + 摘要 + 尺寸/体积 + 下载。 */
		const HEADER_STYLE = {
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			padding: '7px 12px',
			minWidth: 0,
			fontSize: 12,
			lineHeight: '18px',
			color: 'var(--dsw-alias-label-secondary)',
		};

		/** 非图表状态的正文容器（错误/空数据等）。 */
		const BODY_STYLE = {
			padding: '12px 14px',
			borderTop: '1px solid var(--dsw-alias-border-l1)',
			maxHeight: 560,
			overflow: 'auto',
		};

		/** 交互查看器外框（图表主体）。 */
		const VIEWER_STYLE = {
			position: 'relative',
			borderTop: '1px solid var(--dsw-alias-border-l1)',
			overflow: 'hidden',
			background: 'var(--dsw-alias-bg-layer-1)',
			cursor: 'grab',
			userSelect: 'none',
		};

		/** 查看器浮层工具栏。 */
		const TOOLBAR_STYLE = {
			position: 'absolute',
			top: 8,
			right: 8,
			display: 'flex',
			gap: 6,
			padding: 4,
			borderRadius: 8,
			background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent)',
			border: '1px solid var(--dsw-alias-border-l1)',
			backdropFilter: 'blur(4px)',
		};

		/** 查看器底部操作提示。 */
		const HINT_STYLE = {
			position: 'absolute',
			left: 8,
			bottom: 6,
			fontSize: 10,
			lineHeight: '14px',
			color: 'var(--dsw-alias-label-secondary)',
			opacity: 0.72,
			pointerEvents: 'none',
			userSelect: 'none',
			maxWidth: '78%',
			overflow: 'hidden',
			whiteSpace: 'nowrap',
			textOverflow: 'ellipsis',
		};

		/** Pele 图标（与插件 icon.svg 同源的 16px 版本）。 */
		function PeleGlyph() {
			return h(
				'svg',
				{
					width: 16,
					height: 16,
					viewBox: '0 0 64 64',
					'aria-hidden': true,
					style: { flex: 'none', display: 'block' },
				},
				h('rect', { x: 6, y: 10, width: 22, height: 14, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 5 }),
				h('rect', { x: 36, y: 10, width: 22, height: 14, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 5 }),
				h('rect', { x: 6, y: 40, width: 22, height: 14, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 5 }),
				h('path', { d: 'M28 17h8M17 24v16', stroke: 'currentColor', strokeWidth: 5, strokeLinecap: 'round' }),
			);
		}

		/** 下载图标（16px 线性：托盘 + 向下箭头）。 */
		function DownloadGlyph() {
			return h(
				'svg',
				{
					width: 14,
					height: 14,
					viewBox: '0 0 16 16',
					'aria-hidden': true,
					style: { flex: 'none', display: 'block' },
				},
				h('path', {
					d: 'M8 2.5v7.2M8 9.7 5.2 6.9M8 9.7l2.8-2.8',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
				h('path', {
					d: 'M3 12.5h10',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
				}),
			);
		}

		/** 全屏图标（14px 线性四角）。 */
		function FullscreenGlyph() {
			return h(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				h('path', {
					d: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
			);
		}

		/** 适应窗口图标（14px 线性：外角 + 中间方框）。 */
		function FitGlyph() {
			return h(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				h('path', {
					d: 'M2.5 6.5V3h3.5M10 3h3.5v3.5M13.5 9.5V13H10M6 13H2.5V9.5',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.3,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
				h('rect', { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
			);
		}

		/** 关闭图标（14px 线性 X）。 */
		function CloseGlyph() {
			return h(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				h('path', { d: 'M4 4l8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
			);
		}

		/** 安全解析 argsRaw（准备阶段的参数可能不完整，解析失败返回 undefined）。 */
		function parseArgs(raw) {
			if (typeof raw !== 'string' || raw === '') return undefined;
			try {
				const value = JSON.parse(raw);
				return value !== null && typeof value === 'object' ? value : undefined;
			} catch {
				return undefined;
			}
		}

		/** 读取并校验 tool result 的 meta（Host presentationMeta 的产物）。 */
		function readMeta(block) {
			if (block === null || typeof block !== 'object') return undefined;
			const meta = block.meta;
			return meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined;
		}

		/** 从 tool result 的 content blocks 里拼出纯文本（错误/中止时展示）。 */
		function resultText(block) {
			if (block === null || typeof block !== 'object' || !Array.isArray(block.content)) return '';
			const parts = [];
			for (const item of block.content) {
				if (item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
					parts.push(item.text);
				}
			}
			return parts.join('\n').trim();
		}

		/** 客户端内联 SVG 的体积上限：覆盖旧会话/异常 meta，避免一帧注入超大字符串。 */
		const MAX_SVG_BYTES = 600 * 1024;

		/**
		 * 防御性清理：要求以 <svg 开头（拒绝任意 HTML 注入），移除脚本、foreignObject、
		 * 内联事件与 javascript: 链接，并限制体积。
		 * @param svg - Host presentationMeta 里的 SVG 字符串。
		 * @returns 可安全注入的 SVG；不可信时返回 undefined。
		 */
		function sanitizeSvg(svg) {
			if (typeof svg !== 'string') return undefined;
			if (svg.length > MAX_SVG_BYTES) return undefined;
			if (!/^\s*<svg[\s>]/i.test(svg)) return undefined;
			return svg
				.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
				.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
				.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
				.replace(/\s(?:xlink:href|href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
		}

		/**
		 * 查看器需要「按自然尺寸参与 transform」的 SVG：去掉根节点上的
		 * max-width:100% / height:auto，避免浏览器先把图缩到容器宽度。
		 */
		function stripSvgSizing(svg) {
			return svg.replace(/max-width:100%;?/gi, '').replace(/height:auto;?/gi, '');
		}

		/** 字节数格式化。 */
		function formatBytes(bytes) {
			if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
		}

		/** 导出文件名：保留字母/数字/CJK，其它字符折叠成连字符。 */
		function downloadName(title, fallback) {
			const raw = String(title ?? '').trim() || String(fallback ?? 'pele-diagram');
			const slug = raw
				.replace(/[^\p{L}\p{N}._-]+/gu, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 64);
			return `pele-${slug === '' ? 'diagram' : slug}`;
		}

		/** 触发浏览器下载（不落地到工作区，纯客户端行为）。 */
		function triggerDownload(blob, filename) {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename;
			anchor.style.display = 'none';
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}

		/** 数值夹紧。 */
		function clampNumber(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}

		/** 头部右侧的尺寸/体积小徽章。 */
		function Chip({ text }) {
			if (text === '') return null;
			return h(
				'span',
				{
					style: {
						flex: 'none',
						padding: '0 6px',
						border: '1px solid var(--dsw-alias-border-l1)',
						borderRadius: 999,
						fontSize: 11,
						lineHeight: '16px',
						whiteSpace: 'nowrap',
					},
				},
				text,
			);
		}

		/** 运行中的骨架条。 */
		function Skeleton() {
			const bar = (width) => h('div', {
				style: {
					height: 10,
					width,
					borderRadius: 5,
					background: 'var(--dsw-alias-bg-layer-2)',
				},
			});
			return h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: 8 } },
				bar('38%'),
				bar('92%'),
				bar('72%'),
			);
		}

		/** 查看器工具栏上的小图标按钮。 */
		function IconButton({ label, onClick, children }) {
			return h(
				'button',
				{
					type: 'button',
					title: label,
					'aria-label': label,
					onMouseDown: (event) => event.stopPropagation(),
					onClick,
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 26,
						height: 26,
						padding: 0,
						border: '1px solid var(--dsw-alias-border-l1)',
						borderRadius: 6,
						background: 'transparent',
						color: 'var(--dsw-alias-label-secondary)',
						cursor: 'pointer',
					},
				},
				children,
			);
		}

		/**
		 * 交互式图表查看器：滚轮缩放、右键拖动、左键框选放大、双击切换全屏、中键复位。
		 * 全屏时由调用方把它放进固定定位的容器（工具条提供退出按钮）。
		 *
		 * @param props.svg - 已清洗的 SVG 字符串（按自然尺寸参与 transform）。
		 * @param props.width - 图表自然宽度（px）。
		 * @param props.height - 图表自然高度（px）。
		 * @param props.heightPx - 卡片内查看器高度；全屏时由容器撑满。
		 * @param props.t - 翻译函数。
		 * @param props.fullscreen - 是否处于全屏叠加层。
		 * @param props.onFullscreen - 点全屏按钮时的回调（不传则不显示全屏按钮）。
		 * @param props.onClose - 全屏时点关闭按钮的回调。
		 * @param props.onToggleFullscreen - 双击图表时切换全屏的回调；不传则双击不响应。
		 */
		function DiagramViewer(props) {
			const { svg, width, height, heightPx, t, fullscreen = false, onFullscreen, onClose, onToggleFullscreen } = props;
			const hostRef = React.useRef(null);
			const canvasRef = React.useRef(null);
			const marqueeRef = React.useRef(null);
			const dragRef = React.useRef(null);
			const interactedRef = React.useRef(false);
			// 双击防线：拖拽刚结束时浏览器仍可能补发 dblclick，用 400ms 时间窗把它挡掉，
			// 避免「框选/平移收尾的那一下」被误判成双击进全屏。
			const dblGuardRef = React.useRef(0);
			// 本次按下是否真的拖动过（超过抖动阈值）。没拖动过就不算拖拽，也不阻止双击。
			const movedRef = React.useRef(false);
			const [view, setView] = React.useState(null);
			const [marquee, setMarquee] = React.useState(null);
			// 交互激活（focus-gated）：只有点击/聚焦查看器之后才接管滚轮；
			// 点击卡片外、按 Esc 或移走焦点后，滚轮重新交还给页面滚动，避免「鼠标悬停即劫持滚动」。
			// 全屏层的实例生来就是激活态（全屏由用户显式点击进入）。
			const [active, setActiveState] = React.useState(fullscreen);
			const activeRef = React.useRef(fullscreen);
			const setActive = React.useCallback((next) => {
				activeRef.current = next;
				setActiveState(next);
			}, []);

			/** 计算「适应窗口」的缩放与位置。 */
			const fit = React.useCallback(() => {
				const host = hostRef.current;
				if (host === null) return;
				const cw = host.clientWidth;
				const ch = host.clientHeight;
				if (cw === 0 || ch === 0) return;
				const scale = Math.min(cw / width, ch / height) * 0.98;
				setView({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 });
			}, [width, height]);

			// 首次挂载 / 容器尺寸变化时适应窗口（用户手动操作过之后不再打扰）。
			React.useEffect(() => {
				if (view === null) fit();
			}, [view, fit]);
			React.useEffect(() => {
				const host = hostRef.current;
				if (host === null || typeof ResizeObserver === 'undefined') return undefined;
				const observer = new ResizeObserver(() => {
					if (!interactedRef.current) fit();
				});
				observer.observe(host);
				return () => observer.disconnect();
			}, [fit]);

			// 关键：放大时让 SVG 按新的布局尺寸「原生重绘」，而不是把整块内容栅格化后用 CSS
			// transform 拉伸 —— 后者在部分环境（高分屏 / GPU 合成层 / 超大图）会被放大成位图，
			// 越放越糊。这里只给注入的根 <svg> 加 100% 尺寸，缩放交由布局（width/height）完成。
			React.useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return;
				const svgEl = canvas.querySelector('svg');
				if (svgEl === null || svgEl.getAttribute('viewBox') === null) return;
				svgEl.style.width = '100%';
				svgEl.style.height = '100%';
				svgEl.style.maxWidth = 'none';
				svgEl.style.display = 'block';
			}, [svg]);

			// 激活态下监听「卡片外」的点击与 Esc：一旦焦点离开卡片，就退出交互、把滚轮还给页面。
			// 边界取整张卡片（含标题栏/下载按钮），因此点卡片内部不会误退出。
			React.useEffect(() => {
				if (!active || fullscreen) return undefined;
				const host = hostRef.current;
				if (host === null) return undefined;
				const card = host.closest('[data-tool="pele_draw"]');
				const boundary = card === null ? host : card;
				const onPointerDown = (event) => {
					if (boundary.contains(event.target)) return;
					setActive(false);
				};
				const onKeyDown = (event) => {
					if (event.key !== 'Escape') return;
					setActive(false);
					host.blur();
				};
				document.addEventListener('mousedown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown);
				};
			}, [active, fullscreen, setActive]);

			// 滚轮缩放：用原生监听以便 preventDefault（React 的 onWheel 是 passive）。
			React.useEffect(() => {
				const host = hostRef.current;
				if (host === null) return undefined;
				const onWheel = (event) => {
					// 未激活：不拦截滚轮，交给页面正常滚动（滚轮缩放只在点击激活后生效）。
					if (!activeRef.current) return;
					event.preventDefault();
					interactedRef.current = true;
					const rect = host.getBoundingClientRect();
					const mx = event.clientX - rect.left;
					const my = event.clientY - rect.top;
					setView((current) => {
						const base = current ?? { scale: 1, x: 0, y: 0 };
						const factor = Math.exp(-event.deltaY * 0.0015);
						const scale = clampNumber(base.scale * factor, 0.01, 60);
						const ratio = scale / base.scale;
						return { scale, x: mx - (mx - base.x) * ratio, y: my - (my - base.y) * ratio };
					});
				};
				host.addEventListener('wheel', onWheel, { passive: false });
				return () => host.removeEventListener('wheel', onWheel);
			}, []);

			// 拖动过程中的全局 mousemove / mouseup（框选与平移共用）。
			React.useEffect(() => {
				const onMove = (event) => {
					const drag = dragRef.current;
					const host = hostRef.current;
					if (drag === null || host === null) return;
					const rect = host.getBoundingClientRect();
					const px = clampNumber(event.clientX - rect.left, 0, rect.width);
					const py = clampNumber(event.clientY - rect.top, 0, rect.height);
					// 3px 抖动阈值：双击时两次点击之间的微小位移不进入拖拽，也不闪框选。
					if (!movedRef.current && Math.abs(px - drag.px) < 3 && Math.abs(py - drag.py) < 3) return;
					movedRef.current = true;
					if (drag.mode === 'pan') {
						setView((current) => (current === null ? current : { ...current, x: drag.x + (px - drag.px), y: drag.y + (py - drag.py) }));
						return;
					}
					const next = {
						x: Math.min(drag.px, px),
						y: Math.min(drag.py, py),
						w: Math.abs(px - drag.px),
						h: Math.abs(py - drag.py),
					};
					marqueeRef.current = next;
					setMarquee(next);
				};
				const onUp = () => {
					const drag = dragRef.current;
					dragRef.current = null;
					// 真拖动过：随后浏览器仍可能派发 dblclick，先把它挡掉（见 dblGuardRef）。
					if (drag !== null && movedRef.current) dblGuardRef.current = Date.now() + 400;
					movedRef.current = false;
					if (drag !== null && drag.mode === 'box') {
						const box = marqueeRef.current;
						marqueeRef.current = null;
						setMarquee(null);
						const host = hostRef.current;
						if (box !== null && host !== null && box.w > 6 && box.h > 6) {
							interactedRef.current = true;
							setView((current) => {
								if (current === null) return current;
								const cw = host.clientWidth;
								const ch = host.clientHeight;
								const scale = clampNumber(Math.min(cw / box.w, ch / box.h) * 0.98, 0.01, 60);
								// 框选区域中心在图表坐标系里的位置 → 让它在视口中居中。
								const centerX = (box.x + box.w / 2 - current.x) / current.scale;
								const centerY = (box.y + box.h / 2 - current.y) / current.scale;
								return { scale, x: cw / 2 - centerX * scale, y: ch / 2 - centerY * scale };
							});
						}
					}
				};
				window.addEventListener('mousemove', onMove);
				window.addEventListener('mouseup', onUp);
				return () => {
					window.removeEventListener('mousemove', onMove);
					window.removeEventListener('mouseup', onUp);
				};
			}, []);

			const onMouseDown = (event) => {
				// 第一次点击只用于把焦点交给卡片（激活交互），不开始拖动/框选；
				// 之后在这个焦点里的点击才执行平移、框选等操作。
				if (!activeRef.current) {
					event.preventDefault();
					const host = hostRef.current;
					if (host !== null) host.focus({ preventScroll: true });
					setActive(true);
					return;
				}
				const host = hostRef.current;
				if (host === null) return;
				// 工具栏上的点击交给按钮自己的 onClick（按钮已 stopPropagation）；
				// 这里再兜一层：绝不让工具栏的点击变成拖拽/框选的起点。
				const target = event.target;
				if (target !== null && typeof target.closest === 'function' && target.closest('[data-pele-toolbar]') !== null) return;
				// 双击的第二次按下只服务于 dblclick：此时不要开始拖拽/框选，否则会闪一下选框。
				if (event.detail > 1) {
					event.preventDefault();
					return;
				}
				const rect = host.getBoundingClientRect();
				const px = event.clientX - rect.left;
				const py = event.clientY - rect.top;
				if (event.button === 1) {
					// 中键：复位。
					event.preventDefault();
					interactedRef.current = false;
					fit();
					return;
				}
				movedRef.current = false;
				if (event.button === 2) {
					event.preventDefault();
					dragRef.current = { mode: 'pan', px, py, x: view === null ? 0 : view.x, y: view === null ? 0 : view.y };
					return;
				}
				if (event.button === 0) {
					event.preventDefault();
					dragRef.current = { mode: 'box', px, py };
					marqueeRef.current = { x: px, y: py, w: 0, h: 0 };
					// 先不显示选框：等鼠标真的移动（>3px）再画，双击时就不会闪框。
				}
			};

			const viewerHeight = fullscreen ? '100%' : heightPx;
			// 缩放通过「布局尺寸」表达（宽高按 scale 放大），SVG 是矢量、按新尺寸重绘。
			const zoom = view === null ? 1 : view.scale;
			const offsetX = view === null ? 0 : view.x;
			const offsetY = view === null ? 0 : view.y;
			const hintText = fullscreen
				? t('viewer.hintFullscreen')
				: active
					? `${t('viewer.hint')} · ${t('viewer.deactivate')}`
					: t('viewer.activate');

			return h(
				'div',
				{
					ref: hostRef,
					'data-pele-viewer': '',
					'data-pele-active': active ? 'true' : 'false',
					tabIndex: 0,
					role: 'group',
					'aria-label': active ? t('viewer.hint') : t('viewer.activate'),
					style: {
						...VIEWER_STYLE,
						...THEME_VARS,
						height: viewerHeight,
						outline: 'none',
						cursor: active ? 'grab' : 'default',
						// 激活态给一圈内描边，作为「现在滚轮/拖动作用于这张图」的可见提示。
						boxShadow: active && !fullscreen
							? 'inset 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)'
							: 'none',
					},
					onMouseDown,
					onFocus: () => setActive(true),
					onBlur: (event) => {
						const next = event.relatedTarget;
						const host = hostRef.current;
						// 焦点仍留在同一张卡片内（如工具条/下载按钮）时保持激活。
						const card = host === null ? null : host.closest('[data-tool="pele_draw"]');
						const boundary = card === null ? host : card;
						if (next !== null && next !== undefined && boundary !== null && boundary.contains(next)) return;
						if (!fullscreen) setActive(false);
					},
					onContextMenu: (event) => event.preventDefault(),
					onDoubleClick: (event) => {
						// 双击图表 = 切换全屏（全屏层里再双击 = 退出）。
						// 刚拖拽结束时浏览器仍可能补发 dblclick，先按时间窗挡掉，避免误触。
						if (Date.now() < dblGuardRef.current) return;
						const target = event.target;
						if (target !== null && typeof target.closest === 'function' && target.closest('[data-pele-toolbar]') !== null) return;
						if (onToggleFullscreen === undefined) return;
						event.preventDefault();
						onToggleFullscreen();
					},
				},
				h('div', {
					ref: canvasRef,
					style: {
						position: 'absolute',
						left: offsetX,
						top: offsetY,
						width: Math.max(1, width * zoom),
						height: Math.max(1, height * zoom),
					},
					dangerouslySetInnerHTML: { __html: svg },
				}),
				marquee === null
					? null
					: h('div', {
							'data-pele-marquee': '',
							style: {
								position: 'absolute',
								left: marquee.x,
								top: marquee.y,
								width: marquee.w,
								height: marquee.h,
								border: '1px dashed var(--dsw-alias-brand-primary)',
								background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)',
								pointerEvents: 'none',
							},
						}),
				h(
					'div',
					{
						'data-pele-toolbar': '',
						style: TOOLBAR_STYLE,
						// 双击工具栏按钮不应连带触发「双击全屏」。
						onDoubleClick: (event) => event.stopPropagation(),
					},
					h(IconButton, {
						label: t('viewer.fit'),
						onClick: () => {
							interactedRef.current = false;
							fit();
						},
					}, h(FitGlyph, {})),
					fullscreen
						? h(IconButton, { label: t('viewer.exit'), onClick: onClose }, h(CloseGlyph, {}))
						: onFullscreen === undefined
							? null
							: h(IconButton, { label: t('viewer.fullscreen'), onClick: onFullscreen }, h(FullscreenGlyph, {})),
				),
				h('div', { style: HINT_STYLE, 'data-pele-hint': active ? 'active' : 'idle' }, hintText),
			);
		}

		/**
		 * 右上角下载按钮 + 下拉菜单（SVG / PNG）。
		 *
		 * PNG 导出会把「当前页面上真实渲染的 SVG」克隆出来，并把通过 CSS 变量继承来的
		 * 主题颜色固化成内联值，再画到 canvas；因此 PNG 与当前明/暗主题一致。
		 */
		function DownloadMenu({ svg, baseName, t }) {
			const [open, setOpen] = React.useState(false);
			const [hovered, setHovered] = React.useState(null);
			const [failed, setFailed] = React.useState(false);
			const wrapRef = React.useRef(null);

			React.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === 'Escape') setOpen(false);
				};
				document.addEventListener('mousedown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown);
				};
			}, [open]);

			/** 导出原始 SVG（主题中立：pele 的 var(--pele-*) 回退到浅色默认值）。 */
			const saveSvg = () => {
				try {
					triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
					setFailed(false);
				} catch (error) {
					console.warn('[dsh-pele] SVG 导出失败', error);
					setFailed(true);
				}
				setOpen(false);
			};

			/** 导出 PNG：克隆页面上渲染的 SVG、固化主题色、按 2x 栅格化。 */
			const savePng = async () => {
				setOpen(false);
				try {
					// 找到卡片里查看器已经渲染的那份 SVG（拿当前主题的计算值）。
					const card = wrapRef.current === null ? null : wrapRef.current.closest('[data-tool="pele_draw"]');
					const host = card === null ? null : card.querySelector('[data-pele-viewer]');
					const svgEl = host === null ? null : host.querySelector('svg');
					if (svgEl === null) throw new Error('rendered SVG not found');

					const clone = svgEl.cloneNode(true);
					const computed = getComputedStyle(svgEl);
					// 把 CSS 变量链（--_x → var(--pele-x)）的当前计算值固化成内联值。
					for (const name of ['--_bg', '--_fg', '--_m', '--_l', '--_s', '--_a', '--_b', '--_c', '--_r', '--_tw', '--_fm']) {
						const value = computed.getPropertyValue(name).trim();
						if (value !== '') clone.style.setProperty(name, value);
					}
					clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

					const viewBox = svgEl.viewBox !== undefined && svgEl.viewBox.baseVal !== null ? svgEl.viewBox.baseVal : null;
					const rawWidth = viewBox !== null && viewBox.width > 0 ? viewBox.width : Number(svgEl.getAttribute('width'));
					const rawHeight = viewBox !== null && viewBox.height > 0 ? viewBox.height : Number(svgEl.getAttribute('height'));
					if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
						throw new Error('invalid SVG size');
					}
					// 查看器给根 <svg> 加了 100% 尺寸用于矢量缩放；导出时改回自然尺寸，
					// 否则 SVG 作为图片加载会按默认视口（300×150）栅格化，PNG 反而发糊。
					clone.setAttribute('width', String(Math.round(rawWidth)));
					clone.setAttribute('height', String(Math.round(rawHeight)));
					clone.style.removeProperty('width');
					clone.style.removeProperty('height');
					clone.style.removeProperty('max-width');
					clone.style.removeProperty('display');
					// 2x 输出；超长边/超面积时等比降级，避免 canvas 过大。
					const scale = Math.min(2, 4096 / Math.max(rawWidth, rawHeight), Math.sqrt(16_000_000 / (rawWidth * rawHeight)));
					const width = Math.max(1, Math.round(rawWidth * scale));
					const height = Math.max(1, Math.round(rawHeight * scale));

					const serialized = new XMLSerializer().serializeToString(clone);
					const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }));
					const image = new Image();
					await new Promise((resolve, reject) => {
						image.onload = resolve;
						image.onerror = () => reject(new Error('SVG image load failed'));
						image.src = url;
					});
					URL.revokeObjectURL(url);

					// 背景取卡片实际背景（透明时退回白色），保证 PNG 在任何查看器里都清晰。
					let background = computed.getPropertyValue('--_bg').trim();
					if (background === '' || background === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(background)) {
						const cardBackground = card === null ? 'rgb(255, 255, 255)' : getComputedStyle(card).backgroundColor;
						background = cardBackground === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : cardBackground;
					}

					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const context = canvas.getContext('2d');
					if (context === null) throw new Error('canvas unavailable');
					context.fillStyle = background;
					context.fillRect(0, 0, width, height);
					context.drawImage(image, 0, 0, width, height);

					const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
					if (blob === null) throw new Error('PNG encode failed');
					triggerDownload(blob, `${baseName}.png`);
					setFailed(false);
				} catch (error) {
					console.warn('[dsh-pele] PNG 导出失败', error);
					setFailed(true);
				}
			};

			const itemStyle = (active) => ({
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 10,
				width: '100%',
				padding: '6px 8px',
				border: 'none',
				borderRadius: 6,
				background: active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
				color: 'var(--dsw-alias-label-primary)',
				font: 'inherit',
				fontSize: 12,
				textAlign: 'left',
				cursor: 'pointer',
			});
			const hintStyle = { flex: 'none', fontSize: 11, whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)' };

			return h(
				'div',
				{ ref: wrapRef, style: { position: 'relative', flex: 'none', display: 'inline-flex' } },
				h(
					'button',
					{
						type: 'button',
						'aria-label': t('download.button'),
						'aria-haspopup': 'menu',
						'aria-expanded': open,
						'data-download': 'pele-diagram',
						title: t('download.button'),
						onClick: () => setOpen((value) => !value),
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 24,
							height: 24,
							padding: 0,
							border: '1px solid var(--dsw-alias-border-l1)',
							borderRadius: 6,
							background: open ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
							color: 'var(--dsw-alias-label-secondary)',
							cursor: 'pointer',
						},
					},
					h(DownloadGlyph, {}),
				),
				open
					? h(
							'div',
							{
								role: 'menu',
								'aria-label': t('download.button'),
								style: {
									position: 'absolute',
									top: 'calc(100% + 4px)',
									right: 0,
									zIndex: 20,
									minWidth: 236,
									padding: 4,
									border: '1px solid var(--dsw-alias-border-l1)',
									borderRadius: 8,
									background: 'var(--dsw-alias-bg-layer-1)',
									boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
								},
							},
							h(
								'button',
								{
									type: 'button',
									role: 'menuitem',
									'data-download-kind': 'svg',
									onMouseEnter: () => setHovered('svg'),
									onMouseLeave: () => setHovered(null),
									onClick: saveSvg,
									style: itemStyle(hovered === 'svg'),
								},
								h('span', { style: { whiteSpace: 'nowrap' } }, t('download.svg')),
								h('span', { style: hintStyle }, t('download.svgHint')),
							),
							h(
								'button',
								{
									type: 'button',
									role: 'menuitem',
									'data-download-kind': 'png',
									onMouseEnter: () => setHovered('png'),
									onMouseLeave: () => setHovered(null),
									onClick: savePng,
									style: itemStyle(hovered === 'png'),
								},
								h('span', { style: { whiteSpace: 'nowrap' } }, t('download.png')),
								h('span', { style: hintStyle }, t('download.pngHint')),
							),
							failed ? h('div', { style: { padding: '4px 8px', fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' } }, t('download.failed')) : null,
						)
					: null,
			);
		}

		/**
		 * 一张 pele 图表卡片：preparing / start / result 三个阶段都用同一个组件渲染。
		 * @param props - keyed toolview 的 ToolCallViewProps（含 phase/block/t…）。
		 */
		function PeleCard(props) {
			const { phase, block, t: translate } = props;
			const t = typeof translate === 'function'
				? translate
				: (key) => ((navigator.language || '').startsWith('zh') ? zh[key] : en[key]) ?? key;

			const settled = phase === 'result';
			const meta = settled ? readMeta(block) : undefined;
			const args = parseArgs(
				settled ? (block && block.call && block.call.argsRaw) || '' : phase === 'start' ? block.argsRaw : '',
			);
			const title = typeof args?.title === 'string' && args.title.trim() !== ''
				? args.title.trim()
				: typeof meta?.title === 'string' && meta.title !== ''
					? meta.title
					: undefined;
			const state = phase === 'preparing'
				? 'preparing'
				: phase === 'start'
					? 'running'
					: block.isError
						? block.error?.code === 'interrupted'
							? 'stopped'
							: 'error'
						: 'ok';

			const svg = state === 'ok' ? sanitizeSvg(meta?.svg) : undefined;
			const viewerWidth = typeof meta?.width === 'number' && meta.width > 0 ? Math.round(meta.width) : 800;
			const viewerHeight = typeof meta?.height === 'number' && meta.height > 0 ? Math.round(meta.height) : 600;
			const typeLabel = typeof meta?.mermaidType === 'string'
				? meta.mermaidType
				: typeof meta?.type === 'string'
					? meta.type
					: typeof args?.diagram === 'string'
						? args.diagram.trimStart().split(/\s/, 1)[0]
						: undefined;
			const summary = title ?? typeLabel ?? t('card.diagram');
			const dimensions = typeof meta?.width === 'number' && typeof meta?.height === 'number'
				? `${Math.round(meta.width)}×${Math.round(meta.height)}`
				: '';
			const size = formatBytes(meta?.bytes);
			const errorText = state === 'error' || state === 'stopped'
				? resultText(block) || t(state === 'stopped' ? 'card.stopped' : 'card.failed')
				: '';
			const baseName = downloadName(title, meta?.type ?? typeLabel);
			const [fullscreen, setFullscreen] = React.useState(false);

			// 全屏时锁滚动 + Esc 退出。
			React.useEffect(() => {
				if (!fullscreen) return undefined;
				const onKeyDown = (event) => {
					if (event.key === 'Escape') setFullscreen(false);
				};
				window.addEventListener('keydown', onKeyDown);
				const body = document.body;
				const previous = body.style.overflow;
				body.style.overflow = 'hidden';
				return () => {
					window.removeEventListener('keydown', onKeyDown);
					body.style.overflow = previous;
				};
			}, [fullscreen]);

			const header = h(
				'div',
				{ style: HEADER_STYLE },
				h('span', { style: { flex: 'none', display: 'inline-flex', color: 'var(--dsw-alias-label-secondary)' } }, h(PeleGlyph, {})),
				h('span', { style: { flex: 'none', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, t('card.title')),
				h('span', { style: { flex: 'none', opacity: 0.5 } }, '·'),
				h(
					'span',
					{
						style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
						title: summary,
					},
					summary,
				),
				state === 'ok' ? h(Chip, { text: dimensions }) : null,
				state === 'ok' ? h(Chip, { text: size }) : null,
				state === 'ok' && svg !== undefined ? h(DownloadMenu, { svg, baseName, t }) : null,
			);

			let body = null;
			if (state === 'preparing' || state === 'running') {
				body = h(
					'div',
					{ style: BODY_STYLE },
					h(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
						h('span', {}, t(state === 'preparing' ? 'card.preparing' : 'card.running')),
					),
					h(Skeleton, {}),
				);
			} else if (state === 'error' || state === 'stopped') {
				body = h(
					'div',
					{ style: BODY_STYLE },
					h(
						'pre',
						{
							style: {
								margin: 0,
								maxHeight: 240,
								overflow: 'auto',
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
								fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
								fontSize: 12,
								lineHeight: '18px',
								color: state === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
							},
						},
						errorText,
					),
				);
			} else if (svg !== undefined) {
				// 卡片内查看器高度：小图给足留白，大图封顶 560，交互查看器负责缩放。
				const viewportHeight = Math.min(560, Math.max(220, viewerHeight));
				body = h(DiagramViewer, {
					svg: stripSvgSizing(svg),
					width: viewerWidth,
					height: viewerHeight,
					heightPx: viewportHeight,
					t,
					onFullscreen: () => setFullscreen(true),
					// 双击图表：进入全屏（与工具栏全屏按钮等价，只是少一次瞄准）。
					onToggleFullscreen: () => setFullscreen(true),
				});
			} else {
				body = h(
					'div',
					{ style: { ...BODY_STYLE, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
					meta?.svgOmitted === true
						? `${meta.svgOmittedReason ?? t('card.tooLarge')}`
						: resultText(block) || t('card.empty'),
				);
			}

			// 点击卡片任意位置（标题栏、徽章等）都把焦点交给图表查看器，等于「点击卡片激活交互」。
			// 图表区域自身的点击由 DiagramViewer 处理（激活且不触发拖动）。
			const activateFromCard = (event) => {
				const viewer = event.currentTarget.querySelector('[data-pele-viewer]');
				if (viewer !== null && !viewer.contains(event.target)) viewer.focus({ preventScroll: true });
			};

			const card = h('div', { style: CARD_STYLE, 'data-tool': 'pele_draw', 'data-state': state, onClick: activateFromCard }, header, body);

			// 全屏叠加层：固定定位覆盖整个 DSH 页面（Esc / 关闭按钮退出）。
			const overlay = fullscreen && svg !== undefined
				? h(
						'div',
						{
							'data-pele-fullscreen': '',
							style: {
								position: 'fixed',
								inset: 0,
								zIndex: 9999,
								display: 'flex',
								flexDirection: 'column',
								background: 'var(--dsw-alias-bg-layer-1)',
							},
						},
						h(
							'div',
							{
								style: {
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									padding: '10px 14px',
									borderBottom: '1px solid var(--dsw-alias-border-l1)',
									fontSize: 13,
									color: 'var(--dsw-alias-label-primary)',
								},
							},
							h(PeleGlyph, {}),
							h('span', { style: { fontWeight: 600 } }, t('card.title')),
							h('span', { style: { opacity: 0.5 } }, '·'),
							h(
								'span',
								{ style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
								summary,
							),
							h(IconButton, { label: t('viewer.exit'), onClick: () => setFullscreen(false) }, h(CloseGlyph, {})),
						),
						h(
							'div',
							{ style: { flex: '1 1 auto', minHeight: 0 } },
							h(DiagramViewer, {
								svg: stripSvgSizing(svg),
								width: viewerWidth,
								height: viewerHeight,
								fullscreen: true,
								t,
								onClose: () => setFullscreen(false),
								// 全屏里再双击 = 退出全屏（与 Esc / 关闭按钮等价）。
								onToggleFullscreen: () => setFullscreen(false),
							}),
						),
					)
				: null;

			return h(React.Fragment, null, card, overlay);
		}

		/** 客户端入口：注册字典与 `pele_draw` 的 keyed tool view。 */
		function apply(ctx) {
			const locale = ctx.get('locale');
			if (locale !== undefined) {
				ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-pele: dictionaries');
			}
			const slots = ctx.get('slots');
			if (slots === undefined) return;
			slots.inject('tool.call.toolview', () =>
				slots.register(
					{ name: 'tool.call.toolview', key: 'pele_draw', locale: NS },
					PeleCard,
				),
			);
		}

		return { inject: ['slots', 'locale'], apply };
	},
});
