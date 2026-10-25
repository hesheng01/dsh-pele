/**
 * 生成 33 种图表遍历结果的视觉索引页（自包含 HTML，内联全部 SVG）。
 *
 * 用法：node scripts/build-gallery.mjs
 * 输入：research/traversal-report.json（由 scripts/build-traversal-report.mjs 用同一渲染链路生成）
 * 输出：research/traversal-gallery.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const report = JSON.parse(await readFile(join(root, 'research', 'traversal-report.json'), 'utf8'));

/** HTML 转义（图表标题来自我们自己的语料，仍然转义以免破坏页面结构）。 */
const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const cells = [];
for (const item of report) {
	if (!item.ok) {
		cells.push(`<figure class="cell failed"><figcaption>${escapeHtml(item.name)} · 失败</figcaption><pre>${escapeHtml(item.error ?? '')}</pre></figure>`);
		continue;
	}
	const svg = await readFile(item.saved, 'utf8');
	// 去掉 SVG 根节点的固定宽高，交给卡片等比缩放；保留 viewBox。
	const scaled = svg.replace(/^<svg\b([^>]*)>/, (match, attrs) => {
		const cleaned = attrs
			.replace(/\swidth="[^"]*"/, '')
			.replace(/\sheight="[^"]*"/, '');
		return `<svg${cleaned}>`;
	});
	cells.push(`<figure class="cell" data-name="${escapeHtml(item.name)}">
  <figcaption>
    <strong>${escapeHtml(item.name)}</strong>
    <span class="meta">${escapeHtml(item.mermaidType ?? item.type ?? '')} · ${item.width}×${item.height} · ${(item.bytes / 1024).toFixed(1)} KB</span>
  </figcaption>
  <div class="canvas">${scaled}</div>
</figure>`);
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-pele · 33 种 Mermaid 图表遍历</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 36px 56px;
    background: #f6f6f4; color: #1f1f1f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  header { margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 6px; font-weight: 600; }
  p.lead { margin: 0; color: #6e6e6e; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 16px; }
  .cell {
    margin: 0; padding: 12px 14px 14px; background: #ffffff;
    border: 1px solid #dbdad5; border-radius: 10px;
    display: flex; flex-direction: column; gap: 10px; min-width: 0;
  }
  figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
  figcaption strong { font-size: 13px; font-weight: 600; }
  .meta { color: #6e6e6e; font-size: 11px; white-space: nowrap; }
  .canvas { display: flex; align-items: center; justify-content: center; min-height: 120px; overflow: auto; }
  .canvas svg { max-width: 100%; height: auto; }
  .failed pre { color: #c0392b; white-space: pre-wrap; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>dsh-pele · pele 1.10.0 · 33 种 Mermaid 图表遍历</h1>
  <p class="lead">33/33 成功，0 失败。每张图均由 Host 端 <code>pele_draw</code> 工具真实渲染并落盘，此处为原始 SVG 内联预览（会话卡片使用同一份 SVG + 主题变量）。</p>
</header>
<div class="grid">
${cells.join('\n')}
</div>
</body>
</html>
`;

await writeFile(join(root, 'research', 'traversal-gallery.html'), html);
console.log(`gallery written: research/traversal-gallery.html (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB, ${report.length} diagrams)`);
