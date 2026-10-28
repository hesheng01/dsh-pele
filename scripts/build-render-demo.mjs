/**
 * 生成「pele vs mermaid.js」与「pele 实时渲染过程」两个演示页（内联真实 pele SVG）。
 *
 * 用法：node scripts/build-render-demo.mjs
 * 输出：.probe/demo/{compare.html,process.html}、.probe/demo/stages/*.svg
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDiagram } from '../plugin/render.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '.probe', 'demo');
await mkdir(join(out, 'stages'), { recursive: true });

const FLOW = `flowchart TB
  S["Mermaid 源码（文本语法）"] --> M["mermaid.js（官方渲染器）"]
  S --> P["pele（本插件用的渲染器）"]
  M --> M1["浏览器 DOM + 异步 render"]
  M --> M2["约 3.4 MB（gzip 958 KB）"]
  P --> P1["零依赖 / 同步 / Node 可渲染"]
  P --> P2["685 KB（gzip 256 KB）"]
  P --> P3["CSS 变量换主题，不必重渲染"]
  M1 --> O["SVG 输出"]
  P1 --> O`;

const XY = `xychart-beta
  title "渲染器体积对比（KB）"
  x-axis ["pele", "mermaid.js"]
  y-axis "KB" 0 --> 4000
  bar [685, 3400]
  line [256, 958]`;

const QUAD = `quadrantChart
  title 渲染器定位
  x-axis 轻量 --> 全功能
  y-axis 特性少 --> 生态全
  quadrant-1 功能优先
  quadrant-2 官方生态
  quadrant-3 轻量优先
  quadrant-4 轻量实验
  pele: [0.15, 0.25]
  mermaid.js: [0.85, 0.9]`;

const flow = renderDiagram(FLOW);
const xy = renderDiagram(XY);
const quad = renderDiagram(QUAD);

/**
 * 给 SVG 根节点加唯一 id 并注入「按 id 作用域」的 <style>：
 * 避免多个内联 SVG 同页时，逐层揭示的规则泄漏到其它图（CSS 在文档内是全局的）。
 */
const injectStyle = (svg, id, css) =>
	svg.replace(/(<svg\b[^>]*>)/, (root) => root.replace('<svg ', `<svg id="${id}" `) + `<style>${css}</style>`);

/** 去掉 SVG 根节点的固定宽高，交给页面等比缩放。 */
const fluid = (svg) =>
	svg.replace(/^<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '')}>`);

/** 深色主题：同一份 SVG，仅在根节点覆盖 pele 的 CSS 变量。 */
const DARK_VARS =
	'.pele{--pele-bg:transparent;--pele-fg:#e8e8e8;--pele-muted:#a8a8a8;--pele-line:#e8e8e8;' +
	'--pele-surface:#2a2a2a;--pele-surface-alt:#3a3a3a;--pele-border:#6f6f6f;--pele-accent:#7aa2f7}';

const stages = {};
for (const [name, id, css] of [
	['0-source', 'pele-stage-source', ''],
	['1-edges', 'pele-stage-edges', '#pele-stage-edges .pele-node{display:none}'],
	['2-shapes', 'pele-stage-shapes', '#pele-stage-shapes .pele-label{display:none}'],
	['3-final', 'pele-stage-final', ''],
	['4-dark', 'pele-stage-dark', DARK_VARS.replaceAll('.pele{', '#pele-stage-dark{')],
]) {
	const svg = injectStyle(flow.svg, id, css);
	stages[name] = svg;
	await writeFile(join(out, 'stages', `${name}.svg`), svg);
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const page = (title, body, extra = '') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title}</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}
  body{margin:0;padding:28px 32px;background:#f6f6f4;color:#1f1f1f;font-family:${FONT};min-width:0}
  h1{font-size:22px;margin:0 0 6px;font-weight:650}
  .lead{margin:0 0 22px;color:#666;font-size:13px;line-height:1.6}
  .grid{display:grid;gap:16px}
  .panel{background:#fff;border:1px solid #dcdbd6;border-radius:12px;padding:14px 16px;min-width:0}
  .panel h2{font-size:13px;margin:0 0 10px;font-weight:600;color:#333;display:flex;justify-content:space-between;gap:10px}
  .panel h2 span{color:#888;font-weight:400}
  .canvas{display:flex;justify-content:center;align-items:center;min-height:80px}
  .canvas svg{max-width:100%;height:auto}
  .dark{background:#1b1b1b;border-color:#333}
  .dark h2{color:#ddd}.dark h2 span{color:#888}
  pre.src{font-family:${MONO};font-size:12px;line-height:1.55;background:#f2f1ec;border-radius:8px;padding:12px;margin:0;overflow:auto;white-space:pre;color:#333}
  table{border-collapse:collapse;font-size:13px;width:100%}
  th,td{border-bottom:1px solid #e7e6e1;padding:8px 10px;text-align:left;vertical-align:top}
  th{color:#666;font-weight:600;background:#fafaf7}
  td b{font-weight:600}
  .tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid #d5d4cf;color:#555;margin-right:4px}
  .foot{margin-top:18px;color:#888;font-size:12px}
  ${extra}
</style></head><body>${body}</body></html>`;

const compare = page(
	'pele 图表：pele vs mermaid.js',
	`<h1>通过 pele 图表看 pele 与 mermaid.js 的区别</h1>
<p class="lead">下面三张图全部由 pele 渲染（与 dsh-pele 插件 Host 半身同一份 vendored pele 1.12.0）。左边是同一份 Mermaid 语法的两条渲染路线，中间是体积对比，右边是定位取舍。</p>
<div class="grid" style="grid-template-columns:1.55fr 1fr 1fr">
  <div class="panel"><h2>① 同一份 Mermaid 语法，两种渲染器 <span>flowchart · ${flow.width}×${flow.height}</span></h2><div class="canvas">${fluid(flow.svg)}</div></div>
  <div class="panel"><h2>② 打包体积（KB） <span>xychart · bar=原始 / line=gzip</span></h2><div class="canvas">${fluid(xy.svg)}</div></div>
  <div class="panel"><h2>③ 定位：轻量 vs 生态 <span>quadrantChart</span></h2><div class="canvas">${fluid(quad.svg)}</div></div>
</div>
<div class="panel" style="margin-top:16px">
  <h2>差异对照 <span>同样是「把 Mermaid 源码变成图」</span></h2>
  <table>
    <tr><th style="width:130px">维度</th><th>pele 1.12.0（本插件）</th><th>mermaid.js 11.17.2（官方）</th></tr>
    <tr><td>是什么</td><td>把 <b>Mermaid 语法</b>渲染成 SVG 的一个<b>轻量渲染器实现</b>（自己解析+排版+出图）</td><td>Mermaid 语法的<b>官方渲染器</b>，也是整个 Mermaid 生态的参考实现</td></tr>
    <tr><td>体积</td><td><b>685 KB</b>（gzip 256 KB），零运行时依赖</td><td><b>3.4 MB</b>（gzip 958 KB）</td></tr>
    <tr><td>运行环境</td><td><b>同步</b>，不需要 DOM：Node 里可直接渲染（本插件就这么用：在 Host 端出 SVG 交给卡片）</td><td>需要浏览器 DOM 度量文本，<b>异步</b> <code>render()</code></td></tr>
    <tr><td>主题</td><td>颜色全是 CSS 变量（<code>--pele-*</code>）：<b>同一份 SVG 换变量即换肤，不用重渲染</b></td><td>内置主题需要重新 render 才能切换</td></tr>
    <tr><td>覆盖</td><td>支持 Mermaid 12.1 的 <b>33 类图表语法</b>，但布局与视觉是 pele 自己的风格（非像素级一致）</td><td>功能最全：交互、HTML label、更完整的扩展与生态</td></tr>
    <tr><td>本插件为什么选它</td><td colspan="2">小、快（单图渲染 &lt;1 ms）、可在 Host 端同步产出 SVG 数据 → 模型只给 Mermaid 源码，图不进模型上下文，卡片跟随 DSH 明暗主题</td></tr>
  </table>
</div>
<p class="foot">数据来源：本机实测 bundle 大小（pele.js 701,816 B / mermaid.min.js 3,572,661 B）与本机 pele 渲染探针（parse≈0.06 ms，render≈0.41 ms）。</p>`,
	'.grid{grid-template-columns:1.55fr 1fr 1fr}',
);

const processPage = page(
	'pele 实时渲染过程',
	`<h1>pele 渲染过程（同一张图，逐层揭示）</h1>
<p class="lead">一张图从 Mermaid 源码到可显示 SVG 的过程：解析 → 布局（节点形状）→ 连边 → 文字 → 主题化。下面每一帧都是 pele 真实产物的逐层呈现；整张图真实渲染耗时约 <b>0.3–0.4 ms</b>（parse≈0.06 ms）。</p>
<div class="grid" style="grid-template-columns:1fr 1fr 1fr">
  <div class="panel"><h2>① 输入：Mermaid 源码 <span>文本</span></h2>
    <pre class="src">flowchart TB
  S["Mermaid 源码（文本语法）"] --&gt; M["mermaid.js（官方渲染器）"]
  S --&gt; P["pele（本插件用的渲染器）"]
  M --&gt; M1["浏览器 DOM + 异步 render"]
  M --&gt; M2["约 3.4 MB（gzip 958 KB）"]
  P --&gt; P1["零依赖 / 同步 / Node 可渲染"]
  P --&gt; P2["685 KB（gzip 256 KB）"]
  P --&gt; P3["CSS 变量换主题，不必重渲染"]
  M1 --&gt; O["SVG 输出"]
  P1 --&gt; O</pre></div>
  <div class="panel"><h2>② 解析 + 布局：只剩「形状骨架」 <span>节点框已就位</span></h2>
    <div class="canvas">${fluid(stages['2-shapes'])}</div></div>
  <div class="panel"><h2>③ 连边 <span>边与箭头按布局结果连接</span></h2>
    <div class="canvas">${fluid(stages['1-edges'])}</div></div>
</div>
<div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
  <div class="panel"><h2>④ 完成：文字排版 + 输出 SVG <span>${flow.width}×${flow.height} · ${(flow.bytes / 1024).toFixed(1)} KB</span></h2>
    <div class="canvas">${fluid(stages['3-final'])}</div></div>
  <div class="panel dark"><h2>⑤ 主题化：同一份 SVG 换 CSS 变量 <span>深色，不重新渲染</span></h2>
    <div class="canvas">${fluid(stages['4-dark'])}</div></div>
</div>
<p class="foot">说明：pele 的 render() 是同步的、一次产出完整 SVG；上面的「逐层」是把渲染器内部的产物（形状/连边/文字）分帧呈现，便于看清一次渲染里发生了什么。</p>`,
	'.grid{grid-template-columns:1fr 1fr 1fr}',
);

await writeFile(join(out, 'compare.html'), compare);
await writeFile(join(out, 'process.html'), processPage);

/** 用于生成 GIF 的单帧小页面。 */
const framePage = (content, dark = false) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${dark ? '#1b1b1b' : '#ffffff'};font-family:${FONT}}
  .wrap{width:1320px;height:420px;display:flex;align-items:center;justify-content:center;padding:18px}
  .wrap svg{max-width:100%;max-height:100%;height:auto}
  pre{margin:0;padding:18px 24px;font-family:${MONO};font-size:15px;line-height:1.6;color:#333;background:#f4f3ee;border:1px solid #ddd;border-radius:10px;width:1240px;height:340px;overflow:hidden;white-space:pre}
</style></head><body><div class="wrap">${content}</div></body></html>`;

const frames = {
	'frame0': await framePage(`<pre>flowchart TB
  S["Mermaid 源码（文本语法）"] --&gt; M["mermaid.js（官方渲染器）"]
  S --&gt; P["pele（本插件用的渲染器）"]
  M --&gt; M1["浏览器 DOM + 异步 render"]
  M --&gt; M2["约 3.4 MB（gzip 958 KB）"]
  P --&gt; P1["零依赖 / 同步 / Node 可渲染"]
  P --&gt; P2["685 KB（gzip 256 KB）"]
  P --&gt; P3["CSS 变量换主题，不必重渲染"]</pre>`),
	'frame1': await framePage(fluid(stages['1-edges'])),
	'frame2': await framePage(fluid(stages['2-shapes'])),
	'frame3': await framePage(fluid(stages['3-final'])),
	'frame4': await framePage(fluid(stages['4-dark']), true),
};
for (const [name, html] of Object.entries(frames)) await writeFile(join(out, `${name}.html`), html);

console.log('demo pages written to .probe/demo/');
console.log(JSON.stringify({ flow, xy: { width: xy.width, height: xy.height }, quad: { width: quad.width, height: quad.height } }));
