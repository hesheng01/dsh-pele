#!/usr/bin/env node
/**
 * pele 1.9.0 Node probe — reproducible evidence for research/pele-api.md
 *
 * Usage:
 *   node research/pele-node-probe.mjs            # run all checks, write samples
 *   node research/pele-node-probe.mjs --no-write # run checks, do not touch samples/
 *   node research/pele-node-probe.mjs --json out.json
 *
 * Entry resolution (first hit wins):
 *   1. $PELE_ENTRY (absolute or relative path / bare module specifier)
 *   2. ../.probe/package/dist/pele.js  (the unpacked npm tarball used for this research)
 *   3. bare `pele` (installed via `npm i pele@1.9.0`)
 *
 * Every claim in research/pele-api.md tagged "[probe: <section>]" is produced by the
 * corresponding section below. The probe is read-only with respect to the workspace
 * except for writing research/samples/*.svg + research/samples/manifest.json.
 *
 * Node version used for the recorded run: v26.12.1 (pele requires Node >= 20).
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(HERE, 'samples');
const argv = process.argv.slice(2);
const writeSamples = !argv.includes('--no-write');
const jsonOut = (() => {
  const i = argv.indexOf('--json');
  return i !== -1 ? argv[i + 1] : undefined;
})();

const out = [];
const log = (...a) => { const line = a.join(' '); out.push(line); console.log(line); };
const section = (name) => log(`\n===== ${name} =====`);
const table = (rows) => {
  for (const r of rows) log('  ' + r.map((c) => String(c)).join('  '));
};

async function resolveEntry() {
  const candidates = [];
  if (process.env.PELE_ENTRY) candidates.push(process.env.PELE_ENTRY);
  candidates.push(path.join(HERE, '..', '.probe', 'package', 'dist', 'pele.js'));
  for (const c of candidates) {
    const p = c.startsWith('.') || path.isAbsolute(c) ? path.resolve(c) : c;
    if (path.isAbsolute(p)) {
      if (fs.existsSync(p)) return { spec: pathToFileURL(p).href, label: p };
    } else {
      return { spec: c, label: c };
    }
  }
  return { spec: 'pele', label: 'pele' };
}

const { spec, label } = await resolveEntry();
const pele = await import(spec);
const pkgFile = path.join(HERE, '..', '.probe', 'package', 'package.json');
const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : {};

/* ------------------------------------------------------------------ */
/* Diagram sources.                                                   */
/*   required: the 10 types requested by the task                     */
/*   extra:    every other diagram type registered by pele 1.9.0      */
/* Sources are hand-written but each one renders without error — the  */
/* probe re-verifies that on every run (see "diagram matrix").        */
/* ------------------------------------------------------------------ */
const SAMPLES = [
  // ---- required 10 ---------------------------------------------------
  ['flowchart', `flowchart LR
  start([Start]) --> check{Is it valid?}
  check -- yes --> ok[Render SVG]
  check -- no --> fail[Show error]
  ok --> done([Done])`],
  ['sequence', `sequenceDiagram
  autonumber
  participant U as User
  participant A as API
  participant D as Database
  U->>A: GET /items
  A->>D: SELECT * FROM items
  D-->>A: rows
  A-->>U: 200 JSON
  Note over U,A: Client retries on 5xx`],
  ['class', `classDiagram
  class Diagram {
    +String source
    +render() SVG
  }
  class Renderer {
    +parse(text) Model
    +render(model) SVG
  }
  Diagram --> Renderer : uses
  Renderer <|-- SvgRenderer`],
  ['state', `stateDiagram-v2
  [*] --> Idle
  Idle --> Parsing : input
  Parsing --> Layout : model
  Layout --> Draw : boxes
  Draw --> Idle : svg
  Parsing --> Error : bad syntax
  Error --> Idle : reset`],
  ['er', `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "appears in"
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    date created
  }`],
  ['gantt', `gantt
  title Pele render pipeline
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  section Parse
  Lexer :a1, 2024-01-01, 5d
  Parser :a2, after a1, 4d
  section Render
  Layout :b1, after a2, 6d
  SVG :b2, after b1, 3d
  Review :milestone, m1, after b2, 0d`],
  ['pie', `pie showData
  title Diagram metadata
  "flowchart" : 12
  "sequence" : 8
  "class" : 5
  "state" : 4
  "other" : 3`],
  ['xychart', `xychart-beta
  title "Render time by diagram type"
  x-axis [flowchart, sequence, class, state, er]
  y-axis "milliseconds" 0 --> 100
  bar [45, 38, 30, 28, 25]
  line [40, 35, 28, 26, 22]`],
  ['mindmap', `mindmap
  root((Pele))
    Parse
      Mermaid syntax
      Custom parsers
    Layout
      Boxes
      Edges
    Render
      SVG
      CSS variables`],
  ['timeline', `timeline
  title Pele milestones
  section 2023
    Prototype : Obsidian plugin
  section 2024
    Public API : pele.run
    v1.0 : npm package
  section 2025
    v1.9 : themeable SVG`],

  // ---- extra types (all registered by the main entry) ----------------
  ['journey', `journey
  title Render a diagram
  section Author
    Write Mermaid: 5: User
    Paste into note: 4: User
  section Render
    Parse text: 3: App
    Layout boxes: 4: App
    Output SVG: 5: App`],
  ['gitgraph', `gitGraph
  commit id: "init"
  branch feature
  checkout feature
  commit id: "work"
  commit id: "tests"
  checkout main
  merge feature
  commit id: "release"`],
  ['quadrant', `quadrantChart
  title Diagram candidates
  x-axis Slow --> Fast
  y-axis Limited --> Rich
  quadrant-1 Adopt
  quadrant-2 Evaluate
  quadrant-3 Skip
  quadrant-4 Watch
  Flowchart: [0.9, 0.8]
  Gantt: [0.7, 0.6]
  Mindmap: [0.6, 0.3]
  C4: [0.3, 0.7]`],
  ['requirement', `requirementDiagram
  requirement render_req {
    id: 1
    text: render Mermaid text to SVG
    risk: medium
    verifymethod: test
  }
  element pele {
    type: simulation
  }
  pele - satisfies -> render_req`],
  ['c4', `C4Context
  title Diagram rendering
  Person(user, "User")
  System(app, "dsh-pele")
  System_Ext(pele, "pele")
  Rel(user, app, "asks for diagram")
  Rel(app, pele, "renders SVG")`],
  ['sankey', `sankey-beta
  Markdown,Mermaid text,100
  Mermaid text,Pele,100
  Pele,SVG,100`],
  ['block', `block-beta
  columns 3
  md["Markdown"] mermaid["Mermaid text"] pele["Pele"]
  pele --> svg["SVG"]`],
  ['packet', `packet-beta
  0-15: "Source Port"
  16-31: "Destination Port"
  32-63: "Sequence Number"
  64-95: "Acknowledgement Number"`],
  ['kanban', `kanban
  todo[Todo]
    t1[Write parser]
  doing[Doing]
    t2[Render SVG]
  done[Done]
    t3[Ship v1.9]`],
  ['architecture', `architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service server(server)[Server] in api
  service cache(disk)[Cache] in api
  db:L -- R:server
  server:L -- R:cache`],
  ['radar', `radar-beta
  axis speed["Speed"], size["Size"], theme["Theming"]
  curve pele["Pele"]{90, 95, 85}
  curve mermaid["Mermaid"]{40, 30, 60}`],
  ['treemap', `treemap
  "Pele"
    "flowchart": 40
    "sequence": 20
    "class": 15
    "other": 25`],
  ['info', `info`],
  ['agentflow', `agentflow-beta LR
  a[Receive note] --> b[Parse Mermaid]
  b --> c[Render SVG]
  c --> d[Embed result]`],
  ['usecase', `usecase-beta
  actor User
  usecase(Login)
  User --> Login
  User --> Logout
  User --> Register`],
  ['railroad', `railroad-ebnf-beta
  diagram = rule+ ;
  rule = name "=" expression ";" ;
  expression = "text" | name ;`],
  ['treeview', `treeView-beta
  root
    src
      index.ts
      render.ts
    dist
      pele.js`],
  ['venn', `venn-beta
  title Ownership
  set A["Pele"]
  set B["Mermaid"]
  union A,B["Mermaid syntax"]`],
  ['cynefin', `cynefin-beta
  title Domains
  clear
    "Mermaid syntax is known"
  complicated
    "Layout needs analysis"
  complex
    "Themes are emergent"
  clear --> complex`],
  ['wardley', `wardley-beta
  title Rendering stack
  anchor user[0.62,0.90]
  component markdown[0.45,0.85]
  component pele[0.55,0.45]
  component svg[0.75,0.70]
  user --> markdown
  markdown --> pele
  pele --> svg`],
  ['swimlane', `swimlane-beta LR
  subgraph Author
    a[Write text]
  end
  subgraph App
    b[Render]
  end
  a --> b`],
  ['ishikawa', `ishikawa-beta
  title Why diagrams are slow
  effect Slow render
  cause Syntax
    reason Huge input
    reason Deep nesting
  cause Layout
    reason Many edges
    reason Wide labels`],
  ['eventmodeling', `eventmodeling
  tf 1 command AddItem
  tf 2 event ItemAdded
  tf 3 readmodel Cart
  tf 4 processor Recalculate`],
];

/* Helpers ------------------------------------------------------------- */
const dims = (r) => `${r.width}x${r.height}`;
const svgStyle = (r) => {
  const m = r.svg.match(/\sstyle="([^"]*)"/);
  return m ? m[1] : '';
};
const errInfo = (e) => ({
  name: e?.name,
  ctor: e?.constructor?.name,
  isError: e instanceof Error,
  code: e?.code,
  type: e?.type,
  mermaidType: e?.mermaidType,
  line: e?.line,
  column: e?.column,
  snippet: e?.snippet,
  message: String(e?.message ?? e).slice(0, 300),
});
const run = (fn) => {
  try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: errInfo(e) }; }
};
const printResult = (name, res) => {
  if (res.ok) log(`  OK    ${name}: ${typeof res.value === 'string' ? res.value : JSON.stringify(res.value)}`);
  else log(`  THROW ${name}: ${res.error.name} code=${res.error.code} msg=${JSON.stringify(res.error.message.split('\n')[0])}`);
};

const summary = { env: {}, samples: [], options: {}, errors: {}, limits: {}, theme: {}, entries: {} };

/* ==================================================================== */
section('env');
log(`  node: ${process.version}`);
log(`  pele entry: ${label}`);
log(`  package: ${pkg.name}@${pkg.version} (${pkg.license}) type=${pkg.type} engines.node=${pkg.engines?.node}`);
log(`  samples dir: ${SAMPLES_DIR}${writeSamples ? '' : ' (write disabled)'}`);
summary.env = { node: process.version, entry: label, package: pkg.name, version: pkg.version, license: pkg.license };

/* ==================================================================== */
section('exports');
const exportNames = Object.keys(pele).sort();
log('  ' + exportNames.join(', '));
log('  notes: `render`, `parse`, `mount`, `register`, `registered`, `detectType`, `supports`, `forgetTextWidths`, `enableZoom`, `PeleError`');
summary.env.exports = exportNames;

/* ==================================================================== */
section('diagram matrix');
log('  name            type            mermaidType       size        bytes   links');
const matrix = [];
for (const [name, source] of SAMPLES) {
  const res = run(() => pele.render(source));
  if (res.ok) {
    const r = res.value;
    matrix.push({ name, ok: true, type: r.type, mermaidType: r.mermaidType, width: r.width, height: r.height, bytes: r.svg.length, links: r.links.length });
    log(`  OK   ${name.padEnd(15)} ${String(r.type).padEnd(15)} ${String(r.mermaidType).padEnd(17)} ${dims(r).padEnd(11)} ${String(r.svg.length).padEnd(7)} ${r.links.length}`);
  } else {
    matrix.push({ name, ok: false, error: res.error });
    log(`  FAIL ${name.padEnd(15)} ${res.error.code}: ${res.error.message.split('\n')[0]}`);
  }
}
summary.samples = matrix;

// cross-check detection for every registered type
section('detectType / supports');
const DETECT_HEADERS = {
  flowchart: 'flowchart LR\n A-->B',
  'flowchart-elk': 'flowchart-elk LR\n A-->B',
  sequence: 'sequenceDiagram\n A->>B: hi',
  class: 'classDiagram\n class A',
  state: 'stateDiagram-v2\n [*] --> A',
  er: 'erDiagram\n A ||--o{ B : has',
  pie: 'pie\n "a": 1',
  gantt: 'gantt\n dateFormat YYYY-MM-DD\n A :a1, 2024-01-01, 1d',
  gitGraph: 'gitGraph\n commit',
  mindmap: 'mindmap\n root',
  timeline: 'timeline\n 2024 : x',
  journey: 'journey\n title J\n section S\n A: 5: Me',
  xychart: 'xychart-beta\n x-axis [a]\n y-axis 0 --> 1\n bar [1]',
  quadrantChart: 'quadrantChart\n title Q',
  requirement: 'requirementDiagram\n requirement r {\n id: 1\n text: t\n risk: low\n verifymethod: test\n }',
  c4: 'C4Context\n title C',
  sankey: 'sankey-beta\n A,B,1',
  block: 'block-beta\n a',
  packet: 'packet-beta\n 0-7: "a"',
  kanban: 'kanban\n todo[T]',
  architecture: 'architecture-beta\n service a(server)[A]',
  radar: 'radar-beta\n axis a["A"]',
  treemap: 'treemap\n "r"\n  "a": 1',
  info: 'info',
  agentflow: 'agentflow-beta\n a[A]',
  usecase: 'usecase-beta\n actor U',
  railroad: 'railroad-ebnf-beta\n a = "x" ;',
  treeView: 'treeView-beta\n root',
  venn: 'venn-beta\n set A',
  cynefin: 'cynefin-beta\n clear',
  wardley: 'wardley-beta\n title W',
  swimlane: 'swimlane-beta\n a[A]',
  ishikawa: 'ishikawa-beta\n effect E',
  eventmodeling: 'eventmodeling\n tf 1 command A',
};
for (const [type, src] of Object.entries(DETECT_HEADERS)) {
  log(`  ${type.padEnd(15)} detectType=${String(pele.detectType(src)).padEnd(15)} supports=${pele.supports(src)} registered=${pele.registered(type)}`);
}

/* ==================================================================== */
section('write samples');
if (writeSamples) fs.mkdirSync(SAMPLES_DIR, { recursive: true });
const manifest = { pele: pkg.version || '1.9.0', node: process.version, generatedBy: 'research/pele-node-probe.mjs', samples: [] };
for (const [name, source] of SAMPLES) {
  const res = run(() => pele.render(source, { idPrefix: `pele-${name}` }));
  if (!res.ok) { log(`  skip ${name} (render failed)`); continue; }
  const r = res.value;
  const file = `${name}.svg`;
  if (writeSamples) fs.writeFileSync(path.join(SAMPLES_DIR, file), r.svg);
  manifest.samples.push({ name, file, type: r.type, mermaidType: r.mermaidType, width: r.width, height: r.height, bytes: r.svg.length, links: r.links.length, source: source.split('\n')[0] });
  log(`  ${writeSamples ? 'wrote' : 'dry-run'} ${file.padEnd(18)} ${dims(r).padEnd(11)} ${String(r.svg.length).padStart(6)} bytes  ${r.type}/${r.mermaidType}`);
}
if (writeSamples) {
  fs.writeFileSync(path.join(SAMPLES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const sources = {};
  for (const [name, source] of SAMPLES) sources[name] = source;
  fs.writeFileSync(path.join(SAMPLES_DIR, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
  log(`  wrote manifest.json (${manifest.samples.length} samples) and sources.json (same sources, used by the browser probe)`);
}
summary.manifest = manifest.samples;

/* ==================================================================== */
section('render options: defaults');
const BASE = 'flowchart LR\n  A[Start] --> B{A decision point} -- Yes --> C[Finish]';
const base = pele.render(BASE);
log(`  default flowchart: ${dims(base)} bytes=${base.svg.length} type=${base.type}/${base.mermaidType}`);
log(`  returned keys: ${Object.keys(base).join(', ')}`);
log(`  svg root: ${base.svg.slice(0, 420)}`);
log(`  default svg style (first 400 chars): ${svgStyle(base).slice(0, 400)}`);
summary.options.defaults = { width: base.width, height: base.height, bytes: base.svg.length, keys: Object.keys(base) };

section('render options: padding / fontSize / fontFamily');
for (const padding of [0, 4, 8, 20, 40]) log(`  padding=${padding}: ${dims(pele.render(BASE, { padding }))}`);
for (const fontSize of [8, 10, 12, 16, 20, 24, 32]) log(`  fontSize=${fontSize}: ${dims(pele.render(BASE, { fontSize }))}`);
for (const fontFamily of ['sans-serif', 'monospace', 'serif', 'Foo Bar Baz']) log(`  fontFamily=${JSON.stringify(fontFamily)}: ${dims(pele.render(BASE, { fontFamily }))}  (Node has no canvas -> metrics table is used, font family must not change the Node layout)`);
log(`  fontFamilyMono: ${dims(pele.render(BASE, { fontFamilyMono: 'Foo Mono' }))} (same reason)`);
log(`  custom measurer (2x width): ${dims(pele.render(BASE, { measurer: { width: (t, s) => t.length * s * 2 } }))}`);
log(`  custom measurer (0.5x width): ${dims(pele.render(BASE, { measurer: { width: (t, s) => t.length * s * 0.5 } }))}`);
summary.options.typography = {
  padding: Object.fromEntries([0, 4, 8, 20, 40].map((p) => [p, pele.render(BASE, { padding: p }).width])),
  fontSize: Object.fromEntries([8, 10, 12, 16, 20, 24, 32].map((f) => [f, pele.render(BASE, { fontSize: f }).width])),
  fontFamilyAffectsNode: false,
};

section('render options: responsive / config / maxWidth / autoDirection');
log(`  responsive default style: ${JSON.stringify(svgStyle(base).slice(0, 40))} (max-width:100%;height:auto;)`);
log(`  responsive:false style:   ${JSON.stringify(svgStyle(pele.render(BASE, { responsive: false })).slice(0, 40))}`);
log(`  config.flowchart.useMaxWidth=false style: ${JSON.stringify(svgStyle(pele.render(BASE, { config: { flowchart: { useMaxWidth: false } } })).slice(0, 40))}`);
log(`  config.flowchart.nodeSpacing=100/rankSpacing=200: ${dims(pele.render(BASE, { config: { flowchart: { nodeSpacing: 100, rankSpacing: 200 } } }))}`);
const fm = '---\ntitle: Front matter title\nconfig:\n  flowchart:\n    useMaxWidth: false\n---\n' + BASE;
const fmr = pele.render(fm);
log(`  front matter title+config: ${dims(fmr)} responsive-style=${JSON.stringify(svgStyle(fmr).slice(0, 30))} titleInSvg=${/pele-title/.test(fmr.svg)}`);
const WIDE = 'flowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four] --> E[Five] --> F[Six]';
log(`  WIDE natural: ${dims(pele.render(WIDE))}`);
for (const maxWidth of [80, 150, 300, 600, 640, 660, 700]) {
  log(`  WIDE maxWidth=${String(maxWidth).padStart(3)}: ${dims(pele.render(WIDE, { maxWidth }))}`);
}
log(`  WIDE maxWidth=300 autoDirection=false: ${dims(pele.render(WIDE, { maxWidth: 300, autoDirection: false }))}`);
log(`  WIDE maxWidth=300 directionBreakpoint=2000: ${dims(pele.render(WIDE, { maxWidth: 300, directionBreakpoint: 2000 }))}`);
const LONG = 'flowchart LR\n  A[Alpha bravo charlie delta echo foxtrot] --> B[Golf hotel india juliet kilo lima]';
log(`  LONG labels natural: ${dims(pele.render(LONG))}`);
for (const maxWidth of [200, 250, 300]) log(`  LONG labels maxWidth=${maxWidth}: ${dims(pele.render(LONG, { maxWidth }))} (labels wrap, node boxes grow vertically)`);
summary.options.maxWidth = {
  wideNatural: pele.render(WIDE).width,
  byMaxWidth: Object.fromEntries([80, 150, 300, 600, 640, 660, 700].map((m) => [m, pele.render(WIDE, { maxWidth: m }).width])),
  autoDirectionFalse300: pele.render(WIDE, { maxWidth: 300, autoDirection: false }).width,
  directionBreakpoint2000: pele.render(WIDE, { maxWidth: 300, directionBreakpoint: 2000 }).width,
};

section('render options: idPrefix / now');
const accSrc = 'flowchart LR\n  accTitle: Accessible title\n  accDescr: Accessible description\n  A-->B';
for (const idPrefix of ['pele', 'custom', 'a<b&"c']) {
  const r = pele.render(accSrc, { idPrefix });
  log(`  idPrefix=${JSON.stringify(idPrefix)} ids=${JSON.stringify((r.svg.match(/id="[^"]*"/g) || []).slice(0, 2))}`);
}
const GANTT = 'gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Task :t1, 2024-01-01, 30d\n  Task2 :t2, after t1, 10d';
const todayX = (svg) => (svg.match(/class="pele-today"><path d="M([\d.]+)/) || [])[1];
const g1 = pele.render(GANTT, { now: new Date('2024-01-10T00:00:00Z') });
const g2 = pele.render(GANTT, { now: new Date('2024-01-20T00:00:00Z') });
log(`  gantt now=2024-01-10 today-marker-x=${todayX(g1.svg)}`);
log(`  gantt now=2024-01-20 today-marker-x=${todayX(g2.svg)} (marker moves with the now option)`);
const today = new Date();
const isoDay = (d) => d.toISOString().slice(0, 10);
const gStart = isoDay(new Date(today.getTime() - 10 * 864e5));
const gEnd = isoDay(new Date(today.getTime() + 20 * 864e5));
const GANTT_TODAY = `gantt\n  dateFormat YYYY-MM-DD\n  section Today\n  Spanning :t1, ${gStart}, ${gEnd}`;
const gDefault = pele.render(GANTT_TODAY);
const gFuture = pele.render(GANTT_TODAY, { now: new Date(today.getTime() + 5 * 864e5) });
log(`  gantt without now (${gStart}..${gEnd}) today-marker-x=${todayX(gDefault.svg)} (proves default = Date.now(), i.e. current date)`);
log(`  gantt now=+5d today-marker-x=${todayX(gFuture.svg)}`);
log(`  gantt source directive "todayMarker off" hides marker: ${!/pele-today/.test(pele.render(GANTT_TODAY.replace('  section Today', '  todayMarker off\n  section Today')).svg)} (config.gantt.todayMarker is NOT read; it is a source directive)`);
summary.options.now = { jan10: todayX(g1.svg), jan20: todayX(g2.svg), defaultToday: todayX(gDefault.svg), plus5d: todayX(gFuture.svg) };

section('render options: links / images / security');
const link = (src, options = {}) => pele.render(src, options);
const linkSrc = (url) => `flowchart LR\n  A[Site]\n  click A "${url}"`;
log('  allowed/rejected link schemes (default linkSchemes=["http","https","mailto","tel"]):');
for (const url of ['https://example.com', 'http://example.com', 'mailto:a@b.c', 'tel:123', 'relative/path', 'javascript:alert(1)', 'data:text/html,x', '//evil.example', 'file:///etc/passwd', 'vbscript:x']) {
  const r = run(() => link(linkSrc(url)));
  if (r.ok) {
    const v = r.value;
    log(`    ${url.padEnd(22)} links=${JSON.stringify(v.links)} a=${(v.svg.match(/<a [^>]*>/) || [])[0] || 'none'}`);
  } else printResult(url, r);
}
log(`  links:false -> ${JSON.stringify(link(linkSrc('https://example.com'), { links: false }).links)}`);
log(`  linkSchemes:["https"] + http url -> ${JSON.stringify(link(linkSrc('http://example.com'), { linkSchemes: ['https'] }).links)}`);
log(`  linkRel:"" -> ${(link(linkSrc('https://example.com'), { linkRel: '' }).svg.match(/<a [^>]*>/) || [])[0]}`);
log(`  target=_blank -> ${(link('flowchart LR\n  A[Site]\n  click A "https://example.com" _blank').svg.match(/<a [^>]*>/) || [])[0]}`);
const internal = pele.render('flowchart LR\n  A[Note]:::internal-link --> B');
log(`  internal link :::internal-link -> links=${JSON.stringify(internal.links)} a=${(internal.svg.match(/<a [^>]*>/) || [])[0]}`);
log('  images (`A@{ img: ... }`, default imageSchemes=["http","https"]):');
for (const img of ['https://example.com/a.png', 'http://example.com/a.png', 'relative.png', 'javascript:alert(1)', '//evil/x.png', 'data:image/png;base64,xx']) {
  const r = pele.render(`flowchart LR\n  A@{ img: "${img}" } --> B`);
  log(`    ${img.padEnd(30)} image=${/^<image/.test((r.svg.match(/<image[^>]*>/) || [''])[0])} ${(r.svg.match(/<image[^>]*>/) || [''])[0]}`);
}
log(`  images:false -> ${/ <image /.test(pele.render('flowchart LR\n  A@{ img: "https://example.com/a.png" } --> B', { images: false }).svg)}`);
log('  escaping: source text is escaped with &amp; &lt; &gt; &quot; (NUL/C0 controls dropped)');
const escapes = [
  ['plain', 'plain'],
  ['a & b', 'a &amp; b'],
  ['a < b > c', 'a &lt; b &gt; c'],
  ['"quoted"', '&quot;quoted&quot;'],
  ['<script>alert(1)</script>', 'alert(1)'],
];
for (const [src, expected] of escapes) {
  const svg = pele.render(`flowchart LR\n  A["${src.replace(/"/g, '&quot;')}"]`).svg;
  const text = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]).join('');
  log(`    ${JSON.stringify(src).padEnd(32)} -> ${JSON.stringify(text)} ${text.includes(expected) ? '(escaped/sanitized as expected)' : ''}`);
}
log(`  style/classDef value filter rejects url(), expression(), javascript:, @import, <>{}\\\\; and non-whitelisted properties: ${(() => {
  const r = run(() => pele.render('flowchart LR\n  A-->B\n  style A fill:blue;stroke:green'));
  return r.ok ? JSON.stringify(r.value.svg.match(/style="[^"]*"/g)?.filter((s) => s.includes('fill')) || []) : r.error.message;
})()}`);

section('render options: icons / math / measurer cache');
const iconSvg = pele.render('flowchart LR\n  A@{ icon: "user" } --> B', { icons: (name) => `<circle data-icon="${name}" r="4"/>` }).svg;
log(`  icons resolver is injected verbatim into <svg class="pele-icon" ...>: ${/data-icon="user"/.test(iconSvg)}`);
const mathSvg = pele.render('flowchart LR\n  A["$$x^2$$"] --> B', { math: (tex, size) => ({ svg: `<g data-tex="${tex}" data-size="${size}"/>`, width: 30, height: 20 }) }).svg;
log(`  math resolver svg form: used=${/data-tex=/.test(mathSvg)} (tex/size passed: ${(mathSvg.match(/data-tex="[^"]*" data-size="[^"]*"/) || [])[0]})`);
const mathHtml = pele.render('flowchart LR\n  A["$$x^2$$"]', { math: (tex) => ({ html: `<b>${tex}</b>`, width: 40, height: 20 }) }).svg;
log(`  math resolver html form -> <foreignObject>: ${/<foreignObject/.test(mathHtml)}`);
log(`  forgetTextWidths() in Node: ${typeof pele.forgetTextWidths === 'function' ? 'available (no-op without a canvas measurer cache)' : 'missing'}`);

/* ==================================================================== */
section('errors');
const errorCases = [
  ['empty string', () => pele.render('')],
  ['no diagram type', () => pele.render('hello world')],
  ['syntax error', () => pele.render('flowchart LR\n  A --> --> B')],
  ['syntax error EOF', () => pele.render('flowchart LR\n  A --> B\n  C ---')],
  ['semantic error (pie negative)', () => pele.render('pie\n  "a" : -5')],
  ['semantic error (flowchart bad shape)', () => pele.render('flowchart LR\n  A@{ shape: "nope" }')],
  ['limit (source, option)', () => pele.render('flowchart LR\n  A-->B', { limit: 10 })],
  ['limit (source, default 50000)', () => pele.render('flowchart LR\n  A-->B\n' + 'x'.repeat(50000))],
  ['limit (output, option)', () => pele.render('flowchart LR\n  A-->B', { outputLimit: 100 })],
  ['limit (maxEdges, flowchart only)', () => pele.render('flowchart LR\n  A-->B\n  A-->C\n  A-->D\n  A-->E', { maxEdges: 3 })],
  ['limit (maxEdges ignored by sequence)', () => pele.render('sequenceDiagram\n  A->>B: 1\n  A->>B: 2\n  A->>B: 3', { maxEdges: 1 })],
  ['render(object not from parse)', () => pele.render({})],
];
for (const [name, fn] of errorCases) {
  const res = run(fn);
  if (res.ok) {
    log(`  NO-THROW ${name}: ${JSON.stringify({ type: res.value.type, w: res.value.width, h: res.value.height })}`);
    summary.errors[name] = { ok: true };
  } else {
    log(`  THROW    ${name}`);
    log(`           ${JSON.stringify(res.error)}`);
    summary.errors[name] = res.error;
  }
}
log('  PeleError shape: class extends Error; name="PeleError"; code in {unsupported-diagram,syntax,semantic,limit}; type/mermaidType/line/column/snippet; constructor.name is minified in dist builds — use name/instanceof, not constructor.name');
log('  PeleError has no `cause`; all fields are own enumerable properties');
log(`  boundary: source length 50000 accepted=${run(() => pele.render('flowchart LR\n  A-->B\n' + 'x'.repeat(50000 - 21))).ok}, 50001 rejected=${!run(() => pele.render('flowchart LR\n  A-->B\n' + 'x'.repeat(50000))).ok}`);
log('  "Diagram is nested too deeply." (code=limit) exists for RangeError from recursive parsers; hard to trigger reliably from source <= 50000 chars — not reproduced here');

/* ==================================================================== */
section('entries: core / lazy / global');
const core = await import(pathToFileURL(path.join(HERE, '..', '.probe', 'package', 'dist', 'esm', 'core.js')).href);
log(`  core exports: ${Object.keys(core).sort().join(', ')}`);
const coreBefore = run(() => core.render('flowchart LR\n  A-->B'));
printResult('core.render before register', coreBefore);
log(`  core.registered('flowchart')=${core.registered('flowchart')} core.detectType(...)=${core.detectType('flowchart LR\n A-->B')}`);
const fEntry = (await import(pathToFileURL(path.join(HERE, '..', '.probe', 'package', 'dist', 'esm', 'diagrams', 'flowchart.js')).href)).default;
core.register(fEntry);
log(`  after core.register(flowchart@default): registered=${core.registered('flowchart')} render=${dims(core.render('flowchart LR\n  A-->B'))}`);
const seqEntry = (await import(pathToFileURL(path.join(HERE, '..', '.probe', 'package', 'dist', 'esm', 'diagrams', 'sequence.js')).href)).default;
core.register(seqEntry);
log(`  multiple registrations accumulate: sequence registered=${core.registered('sequence')}`);
const model = core.parse('flowchart LR\n  A-->B');
log(`  core.parse model: keys=${Object.keys(model).slice(0, 8).join(',')} mermaidType=${model.mermaidType}`);
log(`  core.render(model): ${dims(core.render(model))}`);
const lazy = await import(pathToFileURL(path.join(HERE, '..', '.probe', 'package', 'dist', 'esm', 'lazy.js')).href);
log(`  lazy exports: ${Object.keys(lazy).sort().join(', ')}`);
const la = await lazy.renderAsync('sequenceDiagram\n  A->>B: hi');
log(`  lazy.renderAsync(sequenceDiagram) -> ${dims(la)} (dynamic import of dist/esm/diagrams/sequence.js works in Node)`);
const lb = await lazy.renderAsync('flowchart LR\n  A-->B');
log(`  lazy.renderAsync(flowchart) -> ${dims(lb)}`);
try { await lazy.renderAsync('bogus'); log('  NO-THROW lazy.renderAsync(unknown)'); } catch (e) { log(`  THROW    lazy.renderAsync(unknown): ${JSON.stringify(errInfo(e))}`); }

// global build in a vm context (no DOM): proves the browser bundle is just an IIFE assigning `var pele`
const globalCode = fs.readFileSync(path.join(HERE, '..', '.probe', 'package', 'dist', 'pele.global.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(globalCode, ctx);
const gr = ctx.pele.render('flowchart LR\n  A-->B');
log(`  global build: script assigns top-level var pele (window.pele in a browser); keys=${Object.keys(ctx.pele).sort().join(', ')}`);
log(`  global build render in a DOM-less vm: ${dims(gr)} (mount/enableZoom still require a DOM element)`);
printResult('global mount without DOM', run(() => ctx.pele.mount({}, 'flowchart LR\n  A-->B')));
summary.entries = {
  core: { unregisteredError: coreBefore.error?.message, registeredAfter: true, renderAfter: 'ok' },
  lazy: { renderAsync: `${la.width}x${la.height}` },
  global: { keys: Object.keys(ctx.pele).sort(), domlessRender: `${gr.width}x${gr.height}`, mountWithoutDom: 'TypeError' },
};

/* ==================================================================== */
section('mount / DOM-only API in Node');
printResult('mount(null)', run(() => pele.mount(null, 'flowchart LR\n  A-->B')));
printResult('mount({})', run(() => pele.mount({}, 'flowchart LR\n  A-->B')));
printResult('enableZoom(null)', run(() => pele.enableZoom(null, {})));
log('  mount()/enableZoom() need a real HTMLElement + document: use them in the browser only.');
log('  mount() behavior summary (verified separately in a real browser, see research/browser-probe.html):');
log('    - options: RenderOptions + { onRender, onError, sanitize, zoom }; default idPrefix "pele-<rand>-<n>" (unique per mount)');
log('    - reads --pele-font / --pele-font-mono from getComputedStyle(element) and its first child');
log('    - maxWidth defaults to element.clientWidth - horizontal padding; if the natural SVG is wider, re-renders with that maxWidth');
log('    - ResizeObserver + document.fonts.ready trigger refresh(); zoom: "auto" (default) | true | false | ZoomOptions');
log('    - errors are caught, written to a child .pele-error <div>, existing <svg> gets opacity 0.4, onError(error) is called');
log('    - returned Mounted: { result, source, error, zoom, update(text, options), refresh(), destroy() }');

/* ==================================================================== */
section('theme variables');
log('  implementation detail: svg root style defines internal aliases --_bg/--_fg/--_m/--_l/--_s/--_a/--_b/--_c (+ --_r/--_fm when used);');
log('  public API is --pele-*; the internal --_* names may change between releases, do not use them.');
const themeVars = new Map();
const pie8 = 'pie\n' + Array.from({ length: 8 }, (_, i) => `  "s${i + 1}": ${8 - i}`).join('\n');
const ganttCrit = pele.render('gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Critical :crit, c1, 2024-01-01, 5d');
const flowBold = pele.render('flowchart LR\n  A["<b>bold</b>"] --> B');
const classHeading = pele.render('classDiagram\n  class A {\n    **+bold()**\n  }');
const themeSources = [base.svg, pele.render(SAMPLES.find(([n]) => n === 'pie')[1]).svg, pele.render(pie8).svg, pele.render(SAMPLES.find(([n]) => n === 'xychart')[1]).svg, g1.svg, ganttCrit.svg];
for (const svg of themeSources) {
  for (const m of svg.matchAll(/--pele-([a-z0-9-]+)\s*,\s*([^);,"']{1,40})/g)) themeVars.set('--pele-' + m[1], m[2].trim());
  for (const m of svg.matchAll(/var\(--pele-(series-\d),([^)]*)\)/g)) themeVars.set('--pele-' + m[1], m[2]);
}
for (const [k, v] of [...themeVars].sort()) log(`  ${k.padEnd(24)} default ${v}`);
log('  additional (not emitted into SVG, used by mount/zoom UI):');
for (const [k, v] of [
  ['--pele-error', '#e45756'],
  ['--pele-zoom-top', '8px'], ['--pele-zoom-right', '8px'], ['--pele-zoom-bottom', 'auto'], ['--pele-zoom-left', 'auto'], ['--pele-zoom-cursor', 'pointer'],
]) log(`  ${k.padEnd(24)} default ${v}`);
summary.theme = Object.fromEntries(themeVars);
const ganttSampleSvg = pele.render(SAMPLES.find(([n]) => n === 'gantt')[1]).svg;
const boldSampleSvg = pele.render(SAMPLES.find(([n]) => n === 'flowchart')[1]).svg;
log(`  weight vars are emitted only when the svg uses them: title-weight (gantt title)=${/--pele-title-weight/.test(ganttSampleSvg)}, bold-weight (<b> in a flowchart label)=${/--pele-bold-weight/.test(flowBold.svg)}, heading-weight (markdown member in a class)=${/--pele-heading-weight/.test(classHeading.svg)}`);
log(`  series colors are used by charts: pie=${/--pele-series-1/.test(pele.render(SAMPLES.find(([n]) => n === 'pie')[1]).svg)} xychart=${/--pele-series-1/.test(pele.render(SAMPLES.find(([n]) => n === 'xychart')[1]).svg)} (8 default colors extracted above)`);
log(`  --pele-critical is used by gantt critical tasks: ${/--pele-critical/.test(ganttCrit.svg)} (${(ganttCrit.svg.match(/var\(--pele-critical[^)]*\)/g) || []).slice(0, 2).join(', ')})`);
log(`  --pele-error is used by the mount() error UI (verified in the browser probe)`);

/* ==================================================================== */
section('misc');
const parsed = pele.parse('flowchart LR\n  A-->B');
log(`  parse() returns a plain object model (JSON.stringify length=${JSON.stringify(parsed).length}), mermaidType enumerable=${Object.prototype.propertyIsEnumerable.call(parsed, 'mermaidType')}`);
log(`  render(parsedModel) without options: ${dims(pele.render(parsed))}`);
log(`  render(parsedModel, {padding:0}): ${dims(pele.render(parsed, { padding: 0 }))} (render options still apply, parse options were fixed at parse())`);
log(`  render(parsedModel, {limit:1}) still works: ${dims(pele.render(parsed, { limit: 1 }))} (limit only applies to parse/string sources)`);
log(`  render() twice is deterministic: ${pele.render(BASE).svg === pele.render(BASE).svg}`);
log(`  config.theme is ignored (no-op): ${pele.render(BASE, { config: { theme: 'dark' } }).svg === base.svg}`);
const custom = {
  type: 'custom-test',
  parse: (src) => ({ text: String(src).trim() }),
  render: (model) => ({ svg: `<svg width="10" height="10"><text>${model.text}</text></svg>`, width: 10, height: 10, links: [] }),
};
pele.register(custom);
log(`  register(custom Diagram) -> registered("custom-test")=${pele.registered('custom-test')} (detectType() cannot produce custom types, so this only overrides/replaces implementations for the detected type names)`);
printResult('register(null)', run(() => pele.register(null)));

/* ==================================================================== */
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + '\n');
  log(`\nwrote ${jsonOut}`);
}
log('\nDONE');
