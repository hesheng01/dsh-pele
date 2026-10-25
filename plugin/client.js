/**
 * dsh-pele 浏览器半身：把 `pele_draw` 工具调用渲染成会话里的内联图表卡片。
 *
 * 数据来源：Host 工具把 pele 渲染出的 SVG 放进 tool result 的 `meta`
 * （presentationMeta），模型上下文里只有摘要文本。这里从 `block.meta` 取 SVG，
 * 用 dangerouslySetInnerHTML 注入；SVG 本身用 CSS 变量取色（--pele-*），
 * 所以把 DSH 主题 token 映射到这些变量后，同一份 SVG 在明/暗主题下都正确。
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
		};

		/**
		 * pele 主题变量 → DSH 主题 token 的映射。
		 * pele 的 SVG 里所有颜色都写成 var(--_x)，而 --_x 又指向 var(--pele-x, 默认值)；
		 * 因此在容器上覆盖 --pele-* 就能让图表跟随 Harness 的明/暗主题。
		 */
		const THEME_VARS = {
			'--pele-bg': 'transparent',
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

		/** 图表主体容器：限高 + 允许横向滚动。 */
		const BODY_STYLE = {
			padding: '12px 14px',
			borderTop: '1px solid var(--dsw-alias-border-l1)',
			maxHeight: 560,
			overflow: 'auto',
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
			const bodyRef = React.useRef(null);

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
					// 找到卡片主体里已经渲染的那份 SVG（拿当前主题的计算值）。
					const card = wrapRef.current === null ? null : wrapRef.current.closest('[data-tool="pele_draw"]');
					const host = card === null ? null : card.querySelector('[data-pele-body]');
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
				body = h('div', {
					'data-pele-body': '',
					style: { ...BODY_STYLE, ...THEME_VARS, display: 'flex', justifyContent: 'center' },
					dangerouslySetInnerHTML: { __html: svg },
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

			return h('div', { style: CARD_STYLE, 'data-tool': 'pele_draw', 'data-state': state }, header, body);
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
