/**
 * 用插件的渲染链路（plugin/render.js，等价于 Host 工具）重新生成 33 种图表的
 * 样本 SVG、遍历报告、摘要与 manifest，保证仓库里的语料可复现。
 *
 * 用法：node scripts/build-traversal-report.mjs
 * 输入：research/samples/sources.json
 * 输出：research/samples/*.svg、research/samples/manifest.json、
 *       research/traversal-report.json、research/traversal-summary.md
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanBytes, renderDiagram } from '../plugin/render.js';

/** vendored pele 版本（升级 vendor 时同步修改）。 */
const VENDORED_PELE_VERSION = '1.12.0';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const samplesDir = join(root, 'research', 'samples');
const sources = JSON.parse(await readFile(join(samplesDir, 'sources.json'), 'utf8'));
await mkdir(samplesDir, { recursive: true });

const report = [];
const manifest = [];
const rows = [];

for (const [name, source] of Object.entries(sources)) {
	try {
		const rendered = renderDiagram(source);
		const file = `${name}.svg`;
		await writeFile(join(samplesDir, file), rendered.svg, 'utf8');
		const saved = `research/samples/${file}`;
		report.push({
			name,
			ok: true,
			type: rendered.type,
			mermaidType: rendered.mermaidType,
			width: rendered.width,
			height: rendered.height,
			bytes: rendered.bytes,
			saved,
			error: null,
		});
		manifest.push({
			name,
			file,
			type: rendered.type,
			mermaidType: rendered.mermaidType,
			width: rendered.width,
			height: rendered.height,
			bytes: rendered.bytes,
			links: 0,
			source: source.trimStart().split('\n', 1)[0],
		});
		rows.push(`| ${name} | ✅ | ${rendered.mermaidType} | ${rendered.width}×${rendered.height} | ${humanBytes(rendered.bytes)} (${rendered.bytes} B) |`);
		console.log(`OK   ${name}: ${rendered.mermaidType} ${rendered.width}x${rendered.height} ${rendered.bytes}B`);
	} catch (error) {
		report.push({ name, ok: false, type: null, mermaidType: null, width: 0, height: 0, bytes: 0, saved: null, error: String(error.message) });
		rows.push(`| ${name} | ❌ | — | — | ${String(error.message).split('\n')[0]} |`);
		console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`);
	}
}

const okCount = report.filter((item) => item.ok).length;
await writeFile(join(root, 'research', 'traversal-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(join(samplesDir, 'manifest.json'), JSON.stringify({
	pele: VENDORED_PELE_VERSION,
	node: process.version,
	generatedBy: 'scripts/build-traversal-report.mjs',
	samples: manifest,
}, null, 2) + '\n', 'utf8');

await writeFile(join(root, 'research', 'traversal-summary.md'), `# Pele 33 种 Mermaid 图表遍历摘要

- 生成方式：\`node scripts/build-traversal-report.mjs\`（与 \`pele_draw\` 工具同一渲染链路 \`plugin/render.js\`）。
- 渲染器：vendored pele **${VENDORED_PELE_VERSION}**，Node ${process.version}。
- 遍历结果：**${okCount}/${report.length} 成功**，失败 ${report.length - okCount} 项；SVG 已写入 \`research/samples/\`。
- 字节数取自实际 SVG 文件，尺寸取自渲染结果。

| 名称 | 是否成功 | 类型 | 尺寸 | 体积 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`, 'utf8');

console.log(`\n完成：${okCount}/${report.length} 成功；报告 research/traversal-report.json，样本 research/samples/`);
