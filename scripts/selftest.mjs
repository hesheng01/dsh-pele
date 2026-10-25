/**
 * dsh-pele 离线自检：不依赖 DSH，直接验证 vendored pele 的渲染层。
 *
 * 用法：node scripts/selftest.mjs [--write-samples]
 *   --write-samples 额外把每张图写到 .probe/samples/ 便于人工查看。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDiagram } from '../plugin/render.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sampleDir = join(root, '.probe', 'samples');
const writeSamples = process.argv.includes('--write-samples');

/** 覆盖 pele 主要图表族的测试语料。 */
const cases = [
	['flowchart', 'flowchart LR\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n  C --> D'],
	['flowchart-elk', 'flowchart-elk TD\n  A --> B --> C'],
	['sequence', 'sequenceDiagram\n  autonumber\n  Alice->>Bob: 你好\n  Bob-->>Alice: 你好!\n  Alice->>Bob: 接口呢?\n  Bob-->>Alice: 在这里'],
	['class', 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog\n  Animal <|-- Dog'],
	['state', 'stateDiagram-v2\n  [*] --> 待机\n  待机 --> 运行: 启动\n  运行 --> 待机: 停止\n  运行 --> [*]: 故障'],
	['er', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }'],
	['gantt', 'gantt\n  title 项目排期\n  dateFormat YYYY-MM-DD\n  section 设计\n  需求 :a1, 2026-01-01, 10d\n  评审 :a2, after a1, 5d\n  section 开发\n  编码 :b1, after a2, 20d'],
	['pie', 'pie showData\n  title 流量来源\n  "搜索" : 45\n  "直接访问" : 30\n  "社交" : 25'],
	['quadrant', 'quadrantChart\n  title 优先级\n  x-axis 低影响 --> 高影响\n  y-axis 低成本 --> 高成本\n  quadrant-1 立刻做\n  quadrant-2 规划\n  quadrant-3 不做\n  quadrant-4 有空再做\n  需求 A: [0.8, 0.2]\n  需求 B: [0.3, 0.7]'],
	['xychart', 'xychart-beta\n  title "月度销量"\n  x-axis ["一月", "二月", "三月", "四月"]\n  y-axis "件" 0 --> 500\n  bar [120, 260, 380, 410]\n  line [120, 260, 380, 410]'],
	['mindmap', 'mindmap\n  root((DSH 插件))\n    Host\n      工具注册\n      pele 渲染\n    Client\n      卡片渲染\n      主题适配'],
	['timeline', 'timeline\n  title 版本历史\n  2026-01 : 立项\n  2026-03 : 内测\n  2026-06 : 发布'],
	['journey', 'journey\n  title 用户旅程\n  section 发现\n    看到介绍: 5: 用户\n  section 使用\n    第一次绘图: 3: 用户\n    定制主题: 4: 用户'],
	['gitGraph', 'gitGraph\n  commit\n  branch feature\n  commit\n  checkout main\n  commit\n  merge feature'],
	['sankey', 'sankey-beta\n\nA,B,10\nB,C,5\nB,D,5'],
	['block', 'block-beta\n  columns 2\n  a b\n  c d'],
	['packet', 'packet-beta\n  0-7: "Source"\n  8-15: "Dest"\n  16-31: "Length"'],
	['kanban', 'kanban\n  todo[待办]\n    t1[写文档]\n  doing[进行中]\n    t2[写代码]\n  done[已完成]\n    t3[调研]'],
	['architecture', 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[数据库] in api\n  service srv(server)[服务] in api\n  db:L -- R:srv'],
	['radar', 'radar-beta\n  title 技能评估\n  axis a["前端"], b["后端"]\n  curve c1["Alice"]{4, 3}\n  curve c2["Bob"]{2, 5}'],
	['treemap', 'treemap-beta\n  "Root"\n    "A": 40\n    "B": 30\n    "C": 30'],
	['requirement', 'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: "系统必须支持绘图"\n    risk: high\n    verifymethod: test\n  }'],
	['c4', 'C4Context\n  title 系统上下文\n  Person(user, "用户")\n  System(sys, "DSH")\n  Rel(user, sys, "使用")'],
];

const errors = [
	['空输入', ''],
	['未识别类型', '这不是 mermaid'],
	['语法错误', 'flowchart LR\n  A --> '],

];

let failures = 0;
const rows = [];
for (const [name, source] of cases) {
	try {
		const result = renderDiagram(source);
		rows.push([name, result.type, result.mermaidType, `${result.width}×${result.height}`, `${(result.bytes / 1024).toFixed(1)} KB`]);
		if (writeSamples) {
			await mkdir(sampleDir, { recursive: true });
			await writeFile(join(sampleDir, `${name}.svg`), result.svg);
		}
	} catch (error) {
		failures += 1;
		rows.push([name, 'FAILED', '', '', String(error.message).split('\n')[0]]);
	}
}

console.log('| 用例 | type | mermaidType | 尺寸 | 体积 |');
console.log('| --- | --- | --- | --- | --- |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);

console.log('\n错误处理：');
for (const [name, source] of errors) {
	try {
		renderDiagram(source);
		console.log(`- ${name}: 未按预期抛错（FAILED）`);
		failures += 1;
	} catch (error) {
		const firstLine = String(error.message).split('\n')[0];
		console.log(`- ${name}: ${firstLine}`);
	}
}

if (writeSamples) console.log(`\n样例已写入 ${sampleDir}`);
// mindmap 词法坑：节点文本以 mindmap 开头应被词法成关键字，并返回可自愈提示。
try {
	renderDiagram('mindmap\n  root((pele))\n    mindmap');
	console.log('- mindmap 关键字坑: 未按预期抛错（FAILED）');
	failures += 1;
} catch (error) {
	const hinted = String(error.message).includes('提示：mindmap');
	console.log(`- mindmap 关键字坑: ${hinted ? '返回自愈提示 ✅' : '缺少提示（FAILED）'}`);
	if (!hinted) failures += 1;
}

// 安全上限：用极小的 outputLimit 触发 pele 的 limit 错误路径。
try {
	renderDiagram('flowchart LR\n  A --> B', { outputLimit: 200 });
	console.log('- 安全上限: 未按预期抛错（FAILED）');
	failures += 1;
} catch (error) {
	console.log(`- 安全上限: ${String(error.message).split('\n')[0]}`);
}

console.log(failures === 0 ? '\nSELFTEST PASS' : `\nSELFTEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
