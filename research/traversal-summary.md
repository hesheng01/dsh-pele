# Pele 33 种 Mermaid 图表遍历摘要

- 生成方式：`node scripts/build-traversal-report.mjs`（与 `pele_draw` 工具同一渲染链路 `plugin/render.js`）。
- 渲染器：vendored pele **1.12.0**，Node v22.15.0。
- 遍历结果：**33/33 成功**，失败 0 项；SVG 已写入 `research/samples/`。
- 字节数取自实际 SVG 文件，尺寸取自渲染结果。

| 名称 | 是否成功 | 类型 | 尺寸 | 体积 |
| --- | --- | --- | --- | --- |
| flowchart | ✅ | flowchart-v2 | 635×152 | 3.5 KB (3632 B) |
| sequence | ✅ | sequence | 416×321 | 5.3 KB (5384 B) |
| class | ✅ | classDiagram | 178×423 | 3.4 KB (3465 B) |
| state | ✅ | stateDiagram | 288×457 | 5.1 KB (5270 B) |
| er | ✅ | er | 333×446 | 5.2 KB (5351 B) |
| gantt | ✅ | gantt | 800×227 | 3.7 KB (3821 B) |
| pie | ✅ | pie | 392×296 | 3.2 KB (3244 B) |
| xychart | ✅ | xychart | 700×500 | 3.2 KB (3230 B) |
| mindmap | ✅ | mindmap | 629×156 | 4.1 KB (4243 B) |
| timeline | ✅ | timeline | 800×221 | 4.8 KB (4912 B) |
| journey | ✅ | journey | 808×327 | 6.0 KB (6164 B) |
| gitgraph | ✅ | gitGraph | 292×141 | 3.9 KB (3976 B) |
| quadrant | ✅ | quadrantChart | 500×500 | 3.1 KB (3223 B) |
| requirement | ✅ | requirement | 300×378 | 3.9 KB (4038 B) |
| c4 | ✅ | c4 | 904×144 | 3.5 KB (3617 B) |
| sankey | ✅ | sankey | 616×416 | 3.7 KB (3829 B) |
| block | ✅ | block | 426×124 | 2.3 KB (2378 B) |
| packet | ✅ | packet | 1035×164 | 2.1 KB (2189 B) |
| kanban | ✅ | kanban | 640×105 | 2.7 KB (2745 B) |
| architecture | ✅ | architecture | 302×148 | 3.6 KB (3636 B) |
| radar | ✅ | radar | 498×387 | 2.7 KB (2741 B) |
| treemap | ✅ | treemap | 656×416 | 2.6 KB (2621 B) |
| info | ✅ | info | 105×40 | 1.0 KB (1046 B) |
| agentflow | ✅ | agentflow | 784×64 | 2.8 KB (2911 B) |
| usecase | ✅ | usecase | 280×255 | 3.1 KB (3126 B) |
| railroad | ✅ | railroadEbnf | 324×307 | 4.0 KB (4075 B) |
| treeview | ✅ | treeView | 120×184 | 1.9 KB (1962 B) |
| venn | ✅ | venn | 504×351 | 1.9 KB (1983 B) |
| cynefin | ✅ | cynefin | 656×492 | 7.3 KB (7502 B) |
| wardley | ✅ | wardley | 846×610 | 3.6 KB (3719 B) |
| swimlane | ✅ | swimlane | 313×208 | 2.5 KB (2577 B) |
| ishikawa | ✅ | ishikawa | 630×236 | 3.4 KB (3436 B) |
| eventmodeling | ✅ | eventmodeling | 454×227 | 4.4 KB (4473 B) |
