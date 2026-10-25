/**
 * client.example.js 的无浏览器冒烟测试（只读：不联网、不启动服务、不写 DOM）。
 *
 * 验证内容：
 *   1. 文件是"经典脚本 + 单个顶层语句"（宿主会把多个 client.js 拼进同一个 <script>）。
 *   2. 脚本执行只注册 factory（惰性 CJS），不产生副作用、不 require react。
 *   3. factory 返回合法 Cordis 插件对象 { apply, inject }，inject 含 slots。
 *   4. apply 只用 slots.inject('tool.call.toolview', ...) 等待声明，然后
 *      register({ name:'tool.call.toolview', key:'pele_draw' }, 组件)。
 *   5. 三阶段 props 渲染：preparing 占位 / start 占位 / result SVG 卡片。
 *   6. 参数读取：preparing 用 PartialArguments 惰性视图；start 用 argsRaw JSON。
 *   7. 结果读取：meta.svg 内联（dangerouslySetInnerHTML）、meta.svgOmitted 降级、
 *      isError 错误卡、恶意 SVG 清洗、非 SVG 内容拒绝、超大 SVG 拒绝。
 *   8. useDisclosure 每次渲染恰好调用一次（hook 顺序）。
 *
 * 运行：node research/smoke-client.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE_URL = new URL('./client.example.js', import.meta.url);
const source = readFileSync(SOURCE_URL, 'utf8');

let failures = 0;
let passes = 0;
function check(name, fn) {
	try {
		fn();
		passes += 1;
		console.log('ok   ' + name);
	} catch (error) {
		failures += 1;
		console.log('FAIL ' + name + '\n     ' + String(error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n     ') : error));
	}
}
function assert(condition, message) {
	if (!condition) throw new Error(message ?? 'assertion failed');
}
function assertEqual(actual, expected, message) {
	if (actual !== expected) throw new Error((message ?? 'not equal') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ── 最小 React stub：createElement 只记录树；测试 harness 自己递归执行函数组件 ──
function createElement(type, props, ...children) {
	return { type, props: props ?? {}, children };
}
const React = { createElement, Fragment: Symbol('Fragment') };

// ── 伪 document：只验证 factory 内的 CSS 注入路径（不应有其它 DOM 依赖） ──
const appendedStyles = [];
const fakeDocument = {
	querySelector() {
		return null;
	},
	createElement(tagName) {
		return { tagName, dataset: {}, textContent: '' };
	},
	head: {
		appendChild(node) {
			appendedStyles.push(node);
		},
	},
};

// ── 执行 client.js（经典脚本：只注入 window / document） ──
const registrations = [];
const fakeWindow = {
	__ModuleLoader__: {
		load(registration) {
			registrations.push(registration);
		},
	},
};
const sandbox = { window: fakeWindow, document: fakeDocument, console };
vm.runInNewContext(source, sandbox, { filename: 'client.example.js' });

check('顶层只有一条语句 window.__ModuleLoader__.load(...)', () => {
	const topLevel = source.match(/^[A-Za-z_$][^\n]*/gm) ?? [];
	assertEqual(topLevel.length, 1, 'top-level statements: ' + JSON.stringify(topLevel));
	assert(topLevel[0].startsWith('window.__ModuleLoader__.load('), 'unexpected top-level: ' + topLevel[0]);
});

check('不含 ESM import/export 与 JSX 用法', () => {
	assert(!/^\s*(?:import|export)\s/m.test(source), 'ESM syntax found');
	assert(!/<\/[A-Za-z]/.test(source), 'JSX-looking closing tag found');
});

check('脚本执行只注册 factory（惰性 CJS，无副作用）', () => {
	assertEqual(registrations.length, 1, 'registrations');
	const registration = registrations[0];
	assertEqual(registration.id, 'dsh-pele');
	assertEqual(typeof registration.factory, 'function');
	assertEqual(appendedStyles.length, 0, 'factory 未执行前不应注入 CSS');
});

const registration = registrations[0];
const requiredSpecs = [];
const plugin = registration.factory((specifier) => {
	requiredSpecs.push(specifier);
	if (specifier === 'react') return React;
	throw new Error('client.example.js require() 了非基线模块: ' + specifier);
});

check('materialize 时注入一份带 data-plugin 归属的 CSS', () => {
	assertEqual(appendedStyles.length, 1, 'styles appended');
	const tag = appendedStyles[0];
	assertEqual(tag.tagName, 'style');
	assertEqual(tag.dataset.plugin, 'dsh-pele');
	assertEqual(tag.dataset.pluginCss, 'dsh-pele/PeleCard.css');
	assert(tag.textContent.includes('.dsh-pele-card'), 'css body');
});

check('factory 返回 { apply, inject } 且只依赖基线模块 react', () => {
	assertEqual(typeof plugin.apply, 'function');
	assert(Array.isArray(plugin.inject), 'inject array');
	assertEqual(plugin.inject.join(','), 'slots');
	assertEqual(requiredSpecs.join(','), 'react');
});

// ── 注册路径 ──
const injectCalls = [];
const slotRegistrations = [];
const fakeCtx = {
	slots: {
		inject(key, callback) {
			injectCalls.push({ key, callback });
			return () => {};
		},
		register(options, component) {
			slotRegistrations.push({ options, component });
			return () => {};
		},
	},
};
plugin.apply(fakeCtx);

check('apply 等待 tool.call.toolview 声明后再注册', () => {
	assertEqual(injectCalls.length, 1);
	assertEqual(injectCalls[0].key, 'tool.call.toolview');
	assertEqual(typeof injectCalls[0].callback, 'function');
	assertEqual(slotRegistrations.length, 0, '声明出现前不应 register');
	injectCalls[0].callback();
	assertEqual(slotRegistrations.length, 1);
	assertEqual(slotRegistrations[0].options.name, 'tool.call.toolview');
	assertEqual(slotRegistrations[0].options.key, 'pele_draw');
	assertEqual(typeof slotRegistrations[0].component, 'function');
});

const PeleCard = slotRegistrations[0].component;

// ── 渲染 harness ──
function execute(node) {
	if (node === null || node === undefined || node === false || node === true) return null;
	if (typeof node === 'string' || typeof node === 'number') return node;
	if (Array.isArray(node)) return node.map(execute);
	if (typeof node.type === 'function') {
		const props = Object.assign({}, node.props);
		if (node.children.length > 0) props.children = node.children.length === 1 ? node.children[0] : node.children;
		return execute(node.type(props));
	}
	return { type: node.type, props: node.props, children: node.children.map(execute) };
}
function collectText(node, out = []) {
	if (node === null || node === undefined || node === false) return out;
	if (typeof node === 'string' || typeof node === 'number') {
		out.push(String(node));
		return out;
	}
	if (Array.isArray(node)) {
		for (const child of node) collectText(child, out);
		return out;
	}
	for (const child of node.children) collectText(child, out);
	return out;
}
function collectNodes(node, out = []) {
	if (node === null || node === undefined || node === false) return out;
	if (typeof node === 'string' || typeof node === 'number') return out;
	if (Array.isArray(node)) {
		for (const child of node) collectNodes(child, out);
		return out;
	}
	out.push(node);
	for (const child of node.children) collectNodes(child, out);
	return out;
}
function textOf(element) {
	return collectText(element).join(' ');
}
function disclosureStub(expanded = false) {
	const state = { calls: 0, expanded };
	const api = {
		get expanded() {
			return state.expanded;
		},
		setExpanded(value) {
			state.expanded = value === true;
		},
		toggle() {
			state.expanded = !state.expanded;
		},
	};
	return { api, state };
}
function render(props) {
	const disclosure = disclosureStub(typeof props.__expanded === 'boolean' ? props.__expanded : false);
	const clean = Object.assign({}, props);
	delete clean.__expanded;
	let hookCalls = 0;
	const useDisclosure = () => {
		hookCalls += 1;
		return disclosure.api;
	};
	const element = execute(PeleCard(Object.assign({ useDisclosure }, clean)));
	return { element, hookCalls };
}

// ── 三阶段渲染 ──
check('preparing：占位卡 + 流式 title（PartialArguments 惰性视图）', () => {
	// 模拟 preparing 的 args 视图：title 字段已闭合，diagram 还在流式。
	const args = {
		has(key) {
			return key === 'title' || key === 'diagram';
		},
		complete(key) {
			return key === 'title';
		},
		text(key) {
			if (key === 'title') return '鉴权流程';
			return undefined;
		},
		value() {
			return undefined;
		},
		closed() {
			return false;
		},
		isSealed: false,
	};
	const block = { phase: 'preparing', callId: 'c1', name: 'pele_draw', turn: 1, step: 1, time: 0, subCalls: [], args };
	const { element, hookCalls } = render({ phase: 'preparing', block });
	const text = textOf(element);
	const nodes = collectNodes(element);
	assert(text.includes('绘制图表 · 鉴权流程'), 'title in head: ' + text);
	assert(text.includes('准备中'), 'status: ' + text);
	assert(text.includes('正在准备图表参数'), 'placeholder: ' + text);
	assertEqual(hookCalls, 1, 'useDisclosure 调用次数');
	assert(nodes.some((n) => n.props.className === 'dsh-pele-placeholder'), 'placeholder node');
	assert(!nodes.some((n) => n.props.dangerouslySetInnerHTML), 'preparing 不应注入 HTML');
});

check('start：占位卡 + argsRaw 完整参数', () => {
	const block = {
		phase: 'start',
		callId: 'c1',
		name: 'pele_draw',
		turn: 1,
		step: 1,
		time: 0,
		subCalls: [],
		argsRaw: JSON.stringify({ diagram: 'flowchart LR\n A-->B', title: '鉴权流程' }),
		args: { isSealed: true },
	};
	const { element } = render({ phase: 'start', block });
	const text = textOf(element);
	assert(text.includes('鉴权流程'), 'title');
	assert(text.includes('绘制中'), 'status');
	assert(text.includes('正在渲染 Mermaid 图表'), 'placeholder');
});

check('result：meta.svg 内联渲染 + 尺寸/字节/文件脚注', () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 374 78" style="max-width:100%;height:auto"><g><rect width="10" height="10"/></g></svg>';
	const block = {
		kind: 'tool-result',
		seq: 3,
		time: 1,
		callId: 'c1',
		name: 'pele_draw',
		args: { isSealed: true },
		call: { name: 'pele_draw', argsRaw: JSON.stringify({ diagram: 'flowchart LR\n A-->B', title: '鉴权流程' }) },
		content: [{ type: 'text', text: '已用 pele 渲染 flowchart-v2 图表（374×78）。' }],
		isError: false,
		meta: { version: 1, type: 'flowchart', mermaidType: 'flowchart-v2', width: 374, height: 78, bytes: 2114, title: '鉴权流程', saved: '<repo>/diagrams/a.svg', svg },
		subCalls: [],
	};
	const { element } = render({ phase: 'result', block, cwd: '<repo>' });
	const nodes = collectNodes(element);
	const svgNode = nodes.find((n) => n.props && n.props.dangerouslySetInnerHTML);
	assert(svgNode !== undefined, 'svg node');
	assertEqual(svgNode.props.className, 'dsh-pele-body');
	assertEqual(svgNode.props.dangerouslySetInnerHTML.__html, svg);
	const text = textOf(element);
	assert(text.includes('绘制图表 · 鉴权流程'), 'title: ' + text);
	assert(text.includes('374×78'), 'dimensions: ' + text);
	assert(text.includes('2.1 KB'), 'bytes: ' + text);
	assert(text.includes('完成'), 'status: ' + text);
	assert(text.includes('查看 Mermaid 源码'), 'source toggle: ' + text);
	assert(text.includes('打开 diagrams/a.svg'), 'saved path: ' + text);
});

check('result：useDisclosure 展开后显示 Mermaid 源码', () => {
	const block = {
		kind: 'tool-result',
		seq: 3,
		time: 1,
		callId: 'c1',
		name: 'pele_draw',
		args: { isSealed: true },
		call: { name: 'pele_draw', argsRaw: JSON.stringify({ diagram: 'flowchart LR\n A-->B', title: '鉴权流程' }) },
		content: [],
		isError: false,
		meta: null,
		subCalls: [],
	};
	const { element } = render({ phase: 'result', block, cwd: '/tmp', __expanded: true });
	const nodes = collectNodes(element);
	const pre = nodes.find((n) => n.type === 'pre' && n.props.className === 'dsh-pele-pre');
	assert(pre !== undefined, 'pre block');
	assertEqual(collectText(pre).join(''), 'flowchart LR\n A-->B');
	assert(textOf(element).includes('收起 Mermaid 源码'), 'toggle label');
});

check('result：meta.svgOmitted 降级卡（超内联上限）', () => {
	const block = {
		kind: 'tool-result',
		seq: 3,
		time: 1,
		callId: 'c1',
		name: 'pele_draw',
		args: { isSealed: true },
		call: null,
		content: [],
		isError: false,
		meta: { version: 1, svgOmitted: true, svgOmittedReason: 'SVG 超过会话内联上限（500.0 KB）', saved: '/tmp/a.svg', title: '大图' },
		subCalls: [],
	};
	const { element } = render({ phase: 'result', block, cwd: '/tmp' });
	const text = textOf(element);
	assert(text.includes('SVG 超过会话内联上限'), 'reason: ' + text);
	assert(!collectNodes(element).some((n) => n.props && n.props.dangerouslySetInnerHTML), '不应注入 HTML');
});

check('result：isError 显示错误文本（content 为空时退回结构化 error）', () => {
	const block = {
		kind: 'tool-result',
		seq: 3,
		time: 1,
		callId: 'c1',
		name: 'pele_draw',
		args: { isSealed: true },
		call: null,
		content: [],
		isError: true,
		error: { name: 'Error', code: 'PELE_SYNTAX' },
		subCalls: [],
	};
	const { element } = render({ phase: 'result', block });
	const text = textOf(element);
	assert(text.includes('Error: PELE_SYNTAX'), 'error text: ' + text);
	assert(text.includes('失败'), 'status: ' + text);
	const errorNode = collectNodes(element).find((n) => n.props && n.props.className === 'dsh-pele-error');
	assert(errorNode !== undefined && errorNode.props.role === 'alert', 'error node');
});

check('result：恶意/异常 SVG 清洗与拒绝', () => {
	const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onload="alert(2)" width="1" height="1"/></svg>';
	const blockFor = (svg) => ({
		kind: 'tool-result', seq: 3, time: 1, callId: 'c1', name: 'pele_draw',
		args: { isSealed: true }, call: null, content: [], isError: false,
		meta: { version: 1, svg, width: 1, height: 1, bytes: 1 }, subCalls: [],
	});
	const hostileNodes = collectNodes(render({ phase: 'result', block: blockFor(hostile) }).element);
	const injected = hostileNodes.find((n) => n.props && n.props.dangerouslySetInnerHTML);
	assert(injected !== undefined, 'hostile svg still rendered (sanitized)');
	assert(!injected.props.dangerouslySetInnerHTML.__html.includes('<script'), 'script stripped');
	assert(!/onload\s*=/.test(injected.props.dangerouslySetInnerHTML.__html), 'event handler stripped');

	// 非 SVG 内容：拒绝注入，走降级占位。
	const htmlNodes = collectNodes(render({ phase: 'result', block: blockFor('<div>not svg</div>') }).element);
	assert(!htmlNodes.some((n) => n.props && n.props.dangerouslySetInnerHTML), 'non-svg rejected');
	assert(textOf(htmlNodes).includes('没有可内联的 SVG'), 'fallback reason');

	// 超大 SVG：拒绝注入。
	const huge = '<svg>' + 'x'.repeat(700 * 1024) + '</svg>';
	const hugeNodes = collectNodes(render({ phase: 'result', block: blockFor(huge) }).element);
	assert(!hugeNodes.some((n) => n.props && n.props.dangerouslySetInnerHTML), 'huge svg rejected');
	assert(textOf(hugeNodes).includes('SVG 过大'), 'huge reason: ' + textOf(hugeNodes));
});

check('异常输入不崩：block 缺失 / args 视图不完整 / meta 非对象', () => {
	render({ phase: 'preparing' });
	render({ phase: 'start', block: { phase: 'start', argsRaw: '{"title":' } });
	render({ phase: 'result', block: { kind: 'tool-result', content: [], isError: false, meta: 42, args: null } });
	render({ phase: 'result', block: { kind: 'tool-result', content: null, isError: false, meta: null } });
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures > 0) process.exitCode = 1;
