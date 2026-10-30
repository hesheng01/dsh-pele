/**
 * 双击全屏交互测试：用 jsdom + React 18 真实挂载卡片，派发浏览器鼠标事件。
 *
 * 覆盖：
 *   1. 未激活时双击图表 → 第一次点击只负责激活，双击直接进入全屏；
 *   2. 全屏层提示包含「双击或 Esc 退出全屏」；
 *   3. 全屏层内双击 → 退出全屏（与 Esc / 关闭按钮等价）；
 *   4. 双击工具栏按钮不触发全屏；
 *   5. 3px 抖动阈值：按下不动 / 微小移动不画选框，超过阈值才画；
 *   6. 真实拖拽后紧跟的 dblclick 不误触发全屏（400ms 时间窗），时间窗过后恢复；
 *   7. 双击的第二次 mousedown(detail=2) 不开始框选；
 *   8. 单击只激活查看器，不会误入全屏。
 *
 * 依赖：.probe/ssr 下的 react@18 / react-dom@18 / jsdom@26（.probe/ 已被 gitignore）。
 * 准备（一次即可）：
 *   mkdir -p .probe/ssr && cd .probe/ssr && npm i react@18 react-dom@18 jsdom@26
 * 运行：node scripts/card-interaction-test.mjs
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

// ── 0) 先在无 DOM 环境里渲染一张图（Host 侧渲染路径，不依赖浏览器） ──
const flowchartSource = 'flowchart LR\n  start([Start]) --> ok[Render]';
const rendered = renderDiagram(flowchartSource);
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

// ── 1) jsdom 环境：React DOM 在 require 时会探测浏览器全局，必须先挂好 ──
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
	url: 'http://localhost/',
	pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

for (const [name, value] of Object.entries({
	window,
	document,
	navigator: window.navigator,
	HTMLElement: window.HTMLElement,
	Element: window.Element,
	Node: window.Node,
	MouseEvent: window.MouseEvent,
	Event: window.Event,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	try {
		Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	} catch {
		// Node 内置只读全局：保留原值即可（client.js 只依赖 window/document）。
	}
}

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');

// ── 2) 加载浏览器 bundle，拦截框架注册（与 card-ssr-test 相同的加载方式） ──
const source = await readFile(join(root, 'plugin', 'client.js'), 'utf8');
let spec;
window.__ModuleLoader__ = {
	load: (value) => {
		spec = value;
	},
};
vm.runInNewContext(source, { window, document, navigator: window.navigator, console }, { filename: 'plugin/client.js' });
assert.ok(spec !== undefined, 'client.js 必须调用 window.__ModuleLoader__.load');

const captured = {};
const moduleExports = spec.factory((name) => {
	if (name === 'react') return React;
	throw new Error(`unexpected require("${name}")`);
});
moduleExports.apply({
	get: (name) =>
		name === 'slots'
			? {
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
				}
			: name === 'locale'
				? { register: () => () => {} }
				: undefined,
	effect: (fn) => {
		fn();
		return () => {};
	},
});
const Card = captured.component;
assert.equal(typeof Card, 'function', '必须注册卡片组件');

// ── 3) 渲染真实卡片（与 tool/result 事件相同的 props 形状） ──
const dictionary = {
	'card.title': 'Pele 图表',
	'card.diagram': '图表',
	'card.preparing': '准备绘制图表…',
	'card.running': '正在绘制图表…',
	'card.failed': '图表渲染失败',
	'card.stopped': '图表渲染已中止',
	'card.empty': '没有可显示的图表数据',
	'card.tooLarge': '图表过大',
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
const t = (key) => dictionary[key] ?? key;

const props = {
	callId: 'call_test',
	toolName: 'pele_draw',
	cwd: root,
	useDisclosure: () => ({}),
	t,
	phase: 'result',
	block: {
		kind: 'tool-result',
		isError: false,
		content: [],
		call: { name: 'pele_draw', argsRaw: JSON.stringify({ diagram: flowchartSource, title: '流程图' }) },
		meta: okMeta,
	},
};

const container = document.getElementById('root');
const reactRoot = createRoot(container);
await act(async () => {
	reactRoot.render(React.createElement(Card, props));
});

// ── 4) 事件与查询助手 ──
const viewer = () => container.querySelector('[data-pele-viewer]');
const overlay = () => container.querySelector('[data-pele-fullscreen]');
const marquee = () => container.querySelector('[data-pele-marquee]');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fire = async (target, type, init = {}) => {
	const event = new window.MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		view: window,
		detail: 1,
		button: 0,
		clientX: 100,
		clientY: 100,
		...init,
	});
	await act(async () => {
		target.dispatchEvent(event);
	});
};

/** 浏览器里真实的双击事件序列。 */
const doubleClick = async (target) => {
	await fire(target, 'mousedown', { detail: 1 });
	await fire(target, 'mouseup', { detail: 1 });
	await fire(target, 'click', { detail: 1 });
	await fire(target, 'mousedown', { detail: 2 });
	await fire(target, 'mouseup', { detail: 2 });
	await fire(target, 'click', { detail: 2 });
	await fire(target, 'dblclick', { detail: 2 });
};

/** jsdom 默认 getBoundingClientRect 全 0，这里给查看器一个 800×600 的视口。 */
const stubRect = () => {
	const host = viewer();
	host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 });
	return host;
};

/** 退出全屏会让卡片内查看器失活（焦点离开卡片），需要时重新点一下激活。 */
const ensureActive = async (host) => {
	if (host.getAttribute('data-pele-active') === 'true') return;
	await fire(host, 'mousedown', { clientX: 100, clientY: 100 });
	assert.equal(host.getAttribute('data-pele-active'), 'true', '查看器应被点击激活');
};

let failures = 0;
let total = 0;
const check = async (name, fn) => {
	total += 1;
	try {
		await fn();
		console.log(`PASS  ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL  ${name}: ${error.message}`);
	}
};

// ── 5) 用例 ──
await check('未激活时双击图表 → 直接进入全屏', async () => {
	assert.equal(viewer().getAttribute('data-pele-active'), 'false', '初始应为未激活');
	await doubleClick(viewer());
	assert.ok(overlay() !== null, '双击后应出现全屏层');
	assert.equal(viewer().getAttribute('data-pele-active'), 'true', '第一次点击应激活查看器');
});

await check('全屏层提示包含「双击或 Esc 退出全屏」', async () => {
	assert.ok(overlay() !== null, '前置：全屏层已打开');
	const text = overlay().textContent;
	assert.ok(text.includes('双击或 Esc 退出全屏'), `全屏提示不包含退出说明：${text.slice(0, 160)}`);
});

await check('全屏层内双击 → 退出全屏', async () => {
	const full = overlay().querySelector('[data-pele-viewer]');
	assert.ok(full !== null, '全屏层里应有查看器');
	await doubleClick(full);
	assert.equal(overlay(), null, '双击后全屏层应关闭');
});

await check('双击工具栏按钮不触发全屏', async () => {
	const toolbar = viewer().querySelector('[data-pele-toolbar]');
	assert.ok(toolbar !== null, '查看器应有工具栏');
	await fire(toolbar, 'dblclick', { detail: 2 });
	assert.equal(overlay(), null, '双击工具栏不应进入全屏');
});

await check('3px 抖动阈值：按下不动 / 微小移动不画选框，超过阈值才画', async () => {
	const host = stubRect();
	await ensureActive(host);
	await fire(host, 'mousedown', { clientX: 100, clientY: 100 });
	assert.equal(marquee(), null, '按下但未移动时不应出现选框');
	await fire(host, 'mousemove', { clientX: 102, clientY: 101 });
	assert.equal(marquee(), null, '2px 抖动不应出现选框');
	await fire(host, 'mousemove', { clientX: 140, clientY: 160 });
	assert.ok(marquee() !== null, '超过阈值后应出现选框');
	await fire(host, 'mouseup', { clientX: 140, clientY: 160 });
	assert.equal(marquee(), null, '松开后选框消失');
});

await check('真实拖拽后紧跟的 dblclick 不误触发全屏（400ms 时间窗）', async () => {
	const host = stubRect();
	await ensureActive(host);
	// 自己先做一次真实拖拽，别依赖上一条用例留下的状态。
	await fire(host, 'mousedown', { clientX: 100, clientY: 100 });
	await fire(host, 'mousemove', { clientX: 150, clientY: 160 });
	await fire(host, 'mouseup', { clientX: 150, clientY: 160 });
	await fire(host, 'dblclick', { detail: 2 });
	assert.equal(overlay(), null, '拖拽刚结束时双击应被忽略');
	await sleep(450);
	await fire(host, 'dblclick', { detail: 2 });
	assert.ok(overlay() !== null, '时间窗过后双击应正常进入全屏');
});

await check('双击的第二次 mousedown(detail=2) 不开始框选', async () => {
	// 先退出上一条用例打开的全屏层。
	const full = overlay().querySelector('[data-pele-viewer]');
	await fire(full, 'dblclick', { detail: 2 });
	assert.equal(overlay(), null, '先退出全屏');
	const host = stubRect();
	await ensureActive(host);
	await fire(host, 'mousedown', { detail: 2, clientX: 200, clientY: 200 });
	await fire(host, 'mousemove', { clientX: 260, clientY: 260 });
	assert.equal(marquee(), null, 'detail=2 的按下不应开始框选');
	await fire(host, 'mouseup', { clientX: 260, clientY: 260 });
	assert.equal(marquee(), null);
});

await check('单击只激活查看器，不会误入全屏', async () => {
	// 先点卡片外，退出交互态（激活是 focus-gated 的）。
	await fire(document.body, 'mousedown', { clientX: 5, clientY: 5 });
	assert.equal(viewer().getAttribute('data-pele-active'), 'false', '点卡片外应退出交互');
	await fire(viewer(), 'mousedown', { clientX: 100, clientY: 100 });
	await fire(viewer(), 'mouseup', { clientX: 100, clientY: 100 });
	await fire(viewer(), 'click', { detail: 1 });
	assert.equal(viewer().getAttribute('data-pele-active'), 'true', '单击应激活查看器');
	assert.equal(overlay(), null, '单击不应进入全屏');
});

console.log(failures === 0 ? `\nCARD INTERACTION TEST PASS (${total}/${total})` : `\nCARD INTERACTION TEST FAILED (${failures}/${total})`);
await act(async () => {
	reactRoot.unmount();
});
process.exit(failures === 0 ? 0 : 1);
