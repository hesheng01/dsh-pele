/**
 * dsh-pele 的纯渲染层：只依赖 vendored pele，不依赖任何 DSH 包。
 *
 * 单独拆出来的原因：Host 工具注册需要 @deepseek-ai/dsh-tools（只能在 DSH 进程内解析），
 * 而本文件可以脱离 DSH 直接跑单元测试（scripts/selftest.mjs）。
 */
import { createHash } from 'node:crypto';
import { render } from './vendor/pele.js';

/** pele 渲染参数：字体尽量贴近 DSH Web UI，并显式写明安全上限。 */
export const RENDER_OPTIONS = {
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ' +
		'"Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
	fontFamilyMono:
		'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
	fontSize: 16,
	// 超宽图在卡片里会被 max-width:100% 等比缩小；这里只防单图过宽导致文字不可读。
	maxWidth: 1600,
	// pele 自带的安全上限（源码长度 / 边数 / 输出长度），显式写出便于审计。
	limit: 200_000,
	maxEdges: 4_000,
	outputLimit: 1_500_000,
};

/** 把字节数格式化成人类可读的值。 */
export function humanBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 把任意标题/类型名变成安全的文件名字干。 */
export function slugify(input, fallback) {
	const slug = String(input ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return slug.length > 0 ? slug : fallback;
}

/** 本地时间戳 `YYYYMMDD-HHmmss`，用作文件名去重。 */
export function timestamp(date = new Date()) {
	const pad = (value) => String(value).padStart(2, '0');
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

/**
 * 对 pele 输出的 SVG 做一次防御性清理（pele 本身已转义文本、过滤链接与样式，
 * 这里再移除脚本/foreignObject/内联事件，避免历史版本或异常输入带来注入面）。
 * @param svg - pele 渲染出的 SVG 字符串。
 */
export function sanitizeSvg(svg) {
	return String(svg)
		.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
		.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
		.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/\s(?:xlink:href|href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
}

/** 常见 CSS 颜色名 → RGB（只收录 classDef 里常用的；未收录的颜色跳过校正，保持原样）。 */
const NAMED_COLORS = {
	black: [0, 0, 0],
	white: [255, 255, 255],
	red: [255, 0, 0],
	green: [0, 128, 0],
	blue: [0, 0, 255],
	yellow: [255, 255, 0],
	orange: [255, 165, 0],
	purple: [128, 0, 128],
	pink: [255, 192, 203],
	gray: [128, 128, 128],
	grey: [128, 128, 128],
	lightgray: [211, 211, 211],
	lightgrey: [211, 211, 211],
	lightblue: [173, 216, 230],
	lightgreen: [144, 238, 144],
	lightcoral: [240, 128, 128],
	lightyellow: [255, 255, 224],
	darkblue: [0, 0, 139],
	darkgreen: [0, 100, 0],
	darkred: [139, 0, 0],
	navy: [0, 0, 128],
	teal: [0, 128, 128],
	cyan: [0, 255, 255],
	magenta: [255, 0, 255],
	silver: [192, 192, 192],
};

/** 把 CSS 颜色解析成相对亮度（0=黑，1=白）；不认识的格式返回 undefined。 */
function parseColorLuminance(value) {
	const text = String(value).trim().toLowerCase();
	const hex = /^#([0-9a-f]{3,8})$/.exec(text);
	let rgb;
	if (hex !== null) {
		let digits = hex[1];
		if (digits.length === 3 || digits.length === 4) digits = digits.split('').map((c) => c + c).join('');
		if (digits.length !== 6 && digits.length !== 8) return undefined;
		rgb = [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
	} else {
		const functional = /^rgba?\(([^)]+)\)$/.exec(text);
		if (functional !== null) {
			const parts = functional[1].split(/[\s,/]+/).filter(Boolean).map(Number);
			if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return undefined;
			rgb = parts.slice(0, 3);
		} else if (Array.isArray(NAMED_COLORS[text])) {
			rgb = NAMED_COLORS[text];
		} else {
			return undefined;
		}
	}
	const linear = (channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/**
 * 从节点组的内部标记里取出「显式填充色」：优先 style 里的 fill:#xxx（classDef 编译产物），
 * 其次 fill 属性。返回 undefined 表示该节点跟随主题变量（var(--_s) 等），不需要校正。
 * @param inner - 节点组的内部 SVG 片段。
 */
function explicitNodeFill(inner) {
	const styled = /style="[^"]*?\bfill\s*:\s*([^;"]+)/i.exec(inner);
	if (styled !== null) return styled[1].trim();
	const attr = /\bfill="([^"]+)"/i.exec(inner);
	if (attr !== null) return attr[1].trim();
	return undefined;
}

/**
 * 节点被 classDef/style 指定了固定填充色时，标签文字会继承主题文字色：
 * 夜间模式下主题文字是浅色，落在浅色填充上就几乎看不清（浅色主题下落在深色填充上也一样）。
 * 这里按填充色的相对亮度挑一个高对比文字色（黑或白中对比更高的那个），
 * 只对没有显式文字色的 text 生效，作者自己指定的 color 不覆盖。
 * @param fill - 显式填充色值。
 * @returns 注入用的文字颜色，或 undefined（不处理）。
 */
function contrastTextColor(fill) {
	if (typeof fill !== 'string') return undefined;
	const normalized = fill.trim().toLowerCase();
	if (normalized === '' || normalized === 'none' || normalized === 'transparent') return undefined;
	if (normalized.startsWith('var(') || normalized.startsWith('url(')) return undefined;
	const luminance = parseColorLuminance(normalized);
	if (luminance === undefined) return undefined;
	const contrastWithDark = (luminance + 0.05) / 0.05;
	const contrastWithLight = 1.05 / (luminance + 0.05);
	return contrastWithDark >= contrastWithLight ? '#1f1f1f' : '#f5f5f5';
}

/** 从 `<g` 之后的位置找到与之配对的 `</g>` 末尾（返回结束位置的下标）。 */
function findGroupEnd(svg, fromIndex) {
	let depth = 1;
	let index = fromIndex;
	while (index < svg.length) {
		const nextOpen = svg.indexOf('<g', index);
		const nextClose = svg.indexOf('</g>', index);
		if (nextClose < 0) return -1;
		if (nextOpen >= 0 && nextOpen < nextClose) {
			depth += 1;
			index = nextOpen + 2;
		} else {
			depth -= 1;
			index = nextClose + 4;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/**
 * 给「显式填充色」的节点标签注入高对比文字色，修掉夜间模式下的低对比度问题。
 * 渲染结果里节点的 classDef 颜色会编译成 rect 的行内 style（如 fill:#fecaca），
 * 而标签 text 没有自己的 fill，会继承根 <svg fill="var(--_fg)"> —— 主题一变就失配。
 *
 * 注意：pele 1.12.0 起已原生处理该问题（标签写成 fill="var(--pele-fg-on-light,#1f1f1f)" /
 * fill="var(--pele-fg-on-dark,#fff)"，并覆盖边与箭头），此时本函数不会重复注入；
 * 保留它作为旧版本/上游回退时的兜底。
 * @param svg - 已清理的 SVG 字符串。
 * @returns 注入文字色后的 SVG（没有需要处理的节点时原样返回）。
 */
export function ensureNodeLabelContrast(svg) {
	const source = String(svg);
	const openTag = /<g class="[^"]*\bpele-node\b[^"]*"[^>]*>/g;
	let output = '';
	let cursor = 0;
	let match;
	while ((match = openTag.exec(source)) !== null) {
		const innerStart = openTag.lastIndex;
		const end = findGroupEnd(source, innerStart);
		if (end < 0) break;
		const innerEnd = end - '</g>'.length;
		const inner = source.slice(innerStart, innerEnd);
		const color = contrastTextColor(explicitNodeFill(inner));
		if (color !== undefined && !inner.includes(`fill="${color}"`)) {
			const fixed = inner.replace(/<text\b[^>]*>/g, (tag) => {
				if (/\bfill\s*=/.test(tag) || /style="[^"]*\bfill\s*:/i.test(tag)) return tag;
				return tag.replace(/\s*(\/?)\s*>$/, (whole, slash) => ` fill="${color}"${slash === '/' ? '/>' : '>'}`);
			});
			output += source.slice(cursor, innerStart) + fixed;
			cursor = innerEnd;
		}
		openTag.lastIndex = end;
	}
	output += source.slice(cursor);
	return output;
}

/**
 * 识别「mindmap 节点文本以 mindmap 关键字开头」这一类词法坑。
 * 判据：mindmap 文档 + 解析错误提到 MINDMAP token + 源码里有以 mindmap 开头的节点行。
 * @param source - Mermaid 源码。
 * @param error - pele 抛出的错误。
 */
function isMindmapKeywordLabelIssue(source, error) {
	const message = String(error?.message ?? '');
	if (!message.includes("got 'MINDMAP'")) return false;
	const lines = source.split('\n');
	if (!/^\s*mindmap\b/i.test(lines[0] ?? '')) return false;
	return lines.slice(1).some((line) => /^\s*mindmap\b/i.test(line));
}

/**
 * 从 PeleError（或普通错误）构造给模型看的错误信息：类型、行列号、片段。
 * @param error - render() 抛出的错误。
 * @param source - 原始 Mermaid 源码，用于补充首行提示。
 */
export function describeRenderError(error, source) {
	const code = typeof error?.code === 'string' ? error.code : undefined;
	const line = Number.isInteger(error?.line) && error.line > 0 ? error.line : undefined;
	const column = Number.isInteger(error?.column) && error.column > 0 ? error.column : undefined;
	const snippet = typeof error?.snippet === 'string' && error.snippet !== '' ? error.snippet : undefined;
	const where = line === undefined ? '' : `（第 ${line} 行${column === undefined ? '' : `第 ${column} 列`}）`;
	const head = code === 'unsupported-diagram'
		? '未能识别 Mermaid 图表类型'
		: code === 'syntax'
			? 'Mermaid 语法错误'
			: code === 'semantic'
				? 'Mermaid 语义错误'
				: code === 'limit'
					? '图表超出 pele 的安全上限'
					: 'Mermaid 渲染失败';
	const detail = String(error?.message ?? error).trim();
	const lines = [`pele_draw: ${head}${where}：${detail}`];
	if (snippet !== undefined) lines.push(`相关片段：${snippet.trimEnd()}`);
	if (code === 'unsupported-diagram') {
		lines.push(
			'提示：源码需以 Mermaid 图表类型关键字开头，例如 "flowchart LR"、"sequenceDiagram"、' +
				'"classDiagram"、"stateDiagram-v2"、"erDiagram"、"gantt"、"pie"、"xychart-beta"、"mindmap"。',
		);
	} else if (code === 'syntax' || code === 'semantic') {
		const firstLine = source.trimStart().split('\n', 1)[0]?.trim();
		if (firstLine !== undefined && firstLine !== '') lines.push(`首行是：${firstLine}`);
	}

	// mindmap 的已知词法坑：节点文本以 "mindmap" 开头（大小写都会）时，pele/Mermaid 的
	// mindmap 词法器会把它词法成 MINDMAP 关键字，导致 "got 'MINDMAP'" 语法错误。
	// 这里给模型一条可自愈的改写提示，避免它反复提交同一份源码。
	if (isMindmapKeywordLabelIssue(source, error)) {
		lines.push(
			'提示：mindmap 里的节点文本不要以 "mindmap" 开头（大小写都算，会被当成图表关键字）。' +
				'可以改成「思维导图 mindmap」、给文本加引号 "mindmap"，或用 id[label] 形式如 mm[mindmap]。',
		);
	}
	return lines.join('\n');
}

/**
 * 渲染一张 Mermaid 图：成功返回尺寸、类型与清理后的 SVG；失败抛出可读错误。
 * @param source - Mermaid 源码。
 * @param options - 覆盖 RENDER_OPTIONS 的渲染参数（一般不用）。
 * @returns {{ type: string, mermaidType: string, width: number, height: number, bytes: number, svg: string }}
 */
export function renderDiagram(source, options) {
	let rendered;
	try {
		// idPrefix 仍传给 pele（它为未来版本/交互渲染预留），但实测 1.9–1.12 的 SVG 输出
		// 不使用它作为元素 id（只有 sankey 渐变等少数地方会用到）；同页多图时 SVG 内部 id
		// （如 U/A/D）理论上可能冲突，属于已知限制（见 README）。
		const idPrefix = `pele-${createHash('sha1').update(source).digest('hex').slice(0, 8)}`;
		rendered = render(source, { ...RENDER_OPTIONS, idPrefix, ...options });
	} catch (error) {
		throw new Error(describeRenderError(error, source));
	}
	// classDef/固定填充色会让标签文字在明暗主题下失配，这里统一做一次对比度校正。
	const svg = ensureNodeLabelContrast(sanitizeSvg(rendered.svg));
	return {
		type: rendered.type,
		mermaidType: rendered.mermaidType,
		width: Math.round(rendered.width),
		height: Math.round(rendered.height),
		bytes: Buffer.byteLength(svg, 'utf8'),
		svg,
	};
}
