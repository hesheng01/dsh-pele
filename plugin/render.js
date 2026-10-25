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
		// idPrefix 仍传给 pele（它为未来版本/交互渲染预留），但实测 1.9–1.10 的 SVG 输出不使用它；
		// 同页多图时 SVG 内部 id（如 U/A/D）理论上可能冲突，属于已知限制（见 README）。
		const idPrefix = `pele-${createHash('sha1').update(source).digest('hex').slice(0, 8)}`;
		rendered = render(source, { ...RENDER_OPTIONS, idPrefix, ...options });
	} catch (error) {
		throw new Error(describeRenderError(error, source));
	}
	const svg = sanitizeSvg(rendered.svg);
	return {
		type: rendered.type,
		mermaidType: rendered.mermaidType,
		width: Math.round(rendered.width),
		height: Math.round(rendered.height),
		bytes: Buffer.byteLength(svg, 'utf8'),
		svg,
	};
}
