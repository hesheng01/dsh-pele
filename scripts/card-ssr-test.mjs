/**
 * 卡片组件 SSR 测试：不启动浏览器，验证 plugin/client.js 的注册契约与三阶段渲染。
 *
 * 做法：用 node:vm 加载 client.js（拦截 window.__ModuleLoader__.load 拿到 factory），
 * materialize factory（require('react') 用真实 React 18），用假 ctx 调 apply()，
 * 捕获 tool.call.toolview 注册的组件，再用 react-dom/server 渲染各阶段 props。
 *
 * 用法：node scripts/card-ssr-test.mjs（依赖 .probe/ssr/node_modules 下的 react/react-dom）
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { renderDiagram } from '../plugin/render.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, '.probe', 'ssr', 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = await readFile(join(root, 'plugin', 'client.js'), 'utf8');

/** 1) 加载浏览器 bundle，拦截框架注册。 */
let spec;
const sandbox = {
	window: {
		__ModuleLoader__: {
			load: (value) => {
				spec = value;
			},
		},
	},
	navigator: { language: 'zh-CN' },
	console,
};
vm.runInNewContext(source, sandbox, { filename: 'plugin/client.js' });
assert.ok(spec !== undefined, 'client.js 必须调用 window.__ModuleLoader__.load');
assert.equal(spec.id, 'dsh-pele');
assert.equal(typeof spec.factory, 'function');

/** 2) materialize factory（只允许 require('react')）。 */
const moduleExports = spec.factory((name) => {
	if (name === 'react') return React;
	throw new Error(`unexpected require("${name}")`);
});
assert.equal(typeof moduleExports.apply, 'function', 'factory 必须返回 apply');
assert.deepEqual([...moduleExports.inject].sort(), ['locale', 'slots']);

/** 3) 假 ctx：捕获 keyed tool view 注册。 */
const captured = {};
const fakeLocale = { register: () => () => {} };
const fakeSlots = {
	inject: (key, callback) => {
		assert.equal(key, 'tool.call.toolview');
		callback();
		return () => {};
	},
	register: (options, component) => {
		captured.options = options;
		captured.component = component;
		return () => {};
	},
};
const ctx = {
	get: (name) => (name === 'slots' ? fakeSlots : name === 'locale' ? fakeLocale : undefined),
	effect: (fn) => {
		fn();
		return () => {};
	},
};
moduleExports.apply(ctx);
assert.ok(captured.component !== undefined, '必须注册 tool.call.toolview 组件');
assert.equal(captured.options.name, 'tool.call.toolview');
assert.equal(captured.options.key, 'pele_draw');
assert.equal(captured.options.locale, 'pele');

const Zh = {
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
	'viewer.hint': '滚轮缩放 · 右键拖动 · 左键框选 · 中键复位',
	'viewer.fit': '适应窗口',
	'viewer.fullscreen': '全屏查看',
	'viewer.exit': '退出全屏',
};
const t = (key) => Zh[key] ?? key;

const Card = captured.component;
const baseProps = {
	callId: 'call_test',
	toolName: 'pele_draw',
	cwd: root,
	useDisclosure: () => ({}),
	t,
};
const render = (props) => renderToStaticMarkup(React.createElement(Card, { ...baseProps, ...props }));

const flowchartSource = 'flowchart LR\n  start([Start]) --> check{Valid?}\n  check -- yes --> ok[Render]\n  check -- no --> fail[Error]';
const rendered = renderDiagram(flowchartSource);
const argsRaw = JSON.stringify({ diagram: flowchartSource, title: '流程图' });
const okMeta = {
	version: 1,
	type: rendered.type,
	mermaidType: rendered.mermaidType,
	width: rendered.width,
	height: rendered.height,
	bytes: rendered.bytes,
	title: '流程图',
	svg: rendered.svg,
};

let failures = 0;
let total = 0;
const check = (name, fn) => {
	total += 1;
	try {
		fn();
		console.log(`PASS  ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL  ${name}: ${error.message}`);
	}
};

check('preparing 阶段显示准备文案', () => {
	const html = render({ phase: 'preparing', block: {} });
	assert.ok(html.includes('data-state="preparing"'), html.slice(0, 400));
	assert.ok(html.includes('准备绘制图表'), html.slice(0, 400));
});

check('start 阶段显示运行文案', () => {
	const html = render({ phase: 'start', block: { phase: 'start', argsRaw } });
	assert.ok(html.includes('data-state="running"'));
	assert.ok(html.includes('正在绘制图表'));
});

check('result 成功阶段内联 SVG、标题、尺寸/体积与下载入口', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [{ type: 'text', text: '已用 pele 渲染' }],
			call: { name: 'pele_draw', argsRaw },
			meta: okMeta,
		},
	});
	assert.ok(html.includes('data-state="ok"'), 'state');
	assert.ok(html.includes('<svg'), 'svg 注入');
	assert.ok(html.includes('流程图'), '标题');
	assert.ok(html.includes(`${rendered.width}×${rendered.height}`), '尺寸徽章');
	assert.ok(html.includes(`${(rendered.bytes / 1024).toFixed(1)} KB`), '体积徽章');
	assert.ok(html.includes('data-download="pele-diagram"'), '下载按钮');
	assert.ok(!html.includes('role="menu"'), '菜单默认关闭');
	assert.ok(!html.includes('/tmp/demo/flowchart.svg'), '不应再有保存路径');
	assert.ok(html.includes('--pele-fg'), '主题变量');
	assert.ok(html.includes('data-pele-viewer'), '交互查看器容器');
	assert.ok(html.includes('滚轮缩放'), '查看器操作提示');
	assert.ok(html.includes('全屏查看'), '全屏按钮');
	assert.ok(html.includes('适应窗口'), '适应窗口按钮');
	assert.ok(!html.includes('max-width:100%'), 'SVG max-width 应被剥离（按自然尺寸参与 transform）');
});

check('交互查看器：工具栏与提示齐全，但全屏层默认不出现', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [],
			call: { name: 'pele_draw', argsRaw },
			meta: okMeta,
		},
	});
	assert.ok(html.includes('data-pele-viewer'), '查看器容器');
	assert.ok(html.includes('aria-label="全屏查看"'), '全屏按钮可访问名');
	assert.ok(html.includes('aria-label="适应窗口"'), '适应窗口按钮可访问名');
	assert.ok(html.includes('中键复位'), '操作提示包含中键复位');
	assert.ok(!html.includes('data-pele-fullscreen'), '全屏层应默认关闭');
});

check('result 错误阶段显示 Mermaid 行列号诊断', () => {
	const errorText = 'pele_draw: Mermaid 语法错误（第 3 行第 1 列）：Parse error on line 3';
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: true,
			error: { name: 'Error', code: 'unknown' },
			content: [{ type: 'text', text: errorText }],
			call: { name: 'pele_draw', argsRaw: JSON.stringify({ diagram: 'flowchart LR\n A --> ' }) },
		},
	});
	assert.ok(html.includes('data-state="error"'));
	assert.ok(html.includes('Mermaid 语法错误'));
	assert.ok(html.includes('第 3 行第 1 列'));
});

check('result 无 meta 时降级显示结果文本', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [{ type: 'text', text: '图表数据缺失' }],
			call: { name: 'pele_draw', argsRaw },
		},
	});
	assert.ok(html.includes('data-state="ok"'));
	assert.ok(html.includes('图表数据缺失'));
});

check('客户端清洗：拒绝非 <svg 开头的注入', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [],
			call: { name: 'pele_draw', argsRaw },
			meta: { ...okMeta, svg: '<script>alert(1)</script><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
		},
	});
	assert.ok(!html.includes('<script'), '不应出现 script');
	assert.ok(!html.includes('alert(1)'), '不应出现注入内容');
});

check('客户端清洗：剥掉合法 SVG 内的 script/onload', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [],
			call: { name: 'pele_draw', argsRaw },
			meta: {
				...okMeta,
				svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>',
			},
		},
	});
	assert.ok(!html.includes('<script'), 'script 应被剥掉');
	assert.ok(!html.includes('onload'), 'onload 应被剥掉');
	assert.ok(html.includes('<rect'), '正常内容保留');
});

check('超大 SVG 被拒绝（>600KB）', () => {
	const big = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(30000)}<text>BIGMARKER</text></svg>`;
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [{ type: 'text', text: '图表较大' }],
			call: { name: 'pele_draw', argsRaw },
			meta: { ...okMeta, svg: big },
		},
	});
	assert.ok(!html.includes('BIGMARKER'), '超大 SVG 不应注入');
});

check('无 SVG（svgOmitted）时提示图表过大且不渲染下载入口', () => {
	const html = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: false,
			content: [],
			call: { name: 'pele_draw', argsRaw },
			meta: { ...okMeta, svg: undefined, svgOmitted: true, svgOmittedReason: 'SVG 超过会话内联上限（500.0 KB），请精简图表' },
		},
	});
	assert.ok(html.includes('请精简图表'), '应提示精简图表');
	assert.ok(!html.includes('data-download="pele-diagram"'), '无 SVG 不应有下载入口');
});

check('系列色使用鲜艳调色板（无黑/灰）', () => {
	const html = render({
		phase: 'result',
		block: { kind: 'tool-result', isError: false, content: [], call: { name: 'pele_draw', argsRaw }, meta: okMeta },
	});
	for (const hex of ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']) {
		assert.ok(html.includes(hex), `缺少系列色 ${hex}`);
	}
	assert.ok(!html.includes('--pele-series-1:var(--dsw-alias-brand-primary)'), 'series-1 不应再跟随品牌色');
	assert.ok(!/--pele-series-\d:#(?:000|1f1f1f|333|666|999)\b/.test(html), '系列色不应含黑/灰');
});

check('图表文字使用带蓝调的主题色（非纯黑/灰）', () => {
	const html = render({
		phase: 'result',
		block: { kind: 'tool-result', isError: false, content: [], call: { name: 'pele_draw', argsRaw }, meta: okMeta },
	});
	assert.ok(html.includes('--pele-fg:color-mix(in srgb, #3b82f6'), 'fg 应混入蓝调');
	assert.ok(html.includes('--pele-muted:color-mix(in srgb, #3b82f6'), 'muted 应混入蓝调');
	assert.ok(!html.includes('--pele-fg:var(--dsw-alias-label-primary)'), 'fg 不应是纯主题黑');
});

check('非成功阶段不渲染下载入口', () => {
	const preparing = render({ phase: 'preparing', block: {} });
	assert.ok(!preparing.includes('data-download="pele-diagram"'), 'preparing 无下载入口');
	const running = render({ phase: 'start', block: { phase: 'start', argsRaw } });
	assert.ok(!running.includes('data-download="pele-diagram"'), 'running 无下载入口');
	const error = render({
		phase: 'result',
		block: {
			kind: 'tool-result',
			isError: true,
			error: { name: 'Error', code: 'unknown' },
			content: [{ type: 'text', text: '渲染失败' }],
			call: { name: 'pele_draw', argsRaw },
		},
	});
	assert.ok(!error.includes('data-download="pele-diagram"'), 'error 无下载入口');
});

check('字典包含下载与查看器文案（zh/en 键一致）', () => {
	for (const key of ['download.button', 'download.svg', 'download.png', 'download.svgHint', 'download.pngHint', 'download.failed', 'viewer.hint', 'viewer.fit', 'viewer.fullscreen', 'viewer.exit']) {
		assert.ok(typeof Zh[key] === 'string' && Zh[key] !== '', `缺少 ${key}`);
	}
	assert.ok(!('card.open' in Zh), 'card.open 应已删除');
});

console.log(failures === 0 ? `\nCARD SSR TEST PASS (${total}/${total})` : `\nCARD SSR TEST FAILED (${failures}/${total})`);
process.exit(failures === 0 ? 0 : 1);
