# pele vs mermaid.js · 渲染过程演示

本目录的图片全部由 **pele 1.10.0** 真实渲染（与 `dsh-pele` 插件的 Host 半身使用同一份 vendored pele 与渲染参数）。

| 文件 | 内容 |
| --- | --- |
| `compare.png` | 用三张 pele 图表解释 pele 与 mermaid.js 的区别：① 同一份 Mermaid 语法的两条渲染路线（flowchart）② 打包体积（xychart：bar=原始 / line=gzip）③ 定位取舍（quadrantChart），底部附差异对照表 |
| `process.png` | 一张图的渲染过程逐层揭示：源码 → 形状骨架（解析+布局）→ 连边 → 文字完成 → 换 CSS 变量得到深色主题（不重渲染） |
| `render-process.gif` | 上面过程的动图版（1100×350，可循环播放） |
| `1-flowchart.svg` / `2-xychart.svg` / `3-quadrant.svg` | 三张图的原始 SVG（pele 直接输出） |
| `../effect-diagrams.png` / `../effect-download.png` | 真实 DSH 会话里的卡片效果与下载菜单截图 |

## 实测数据

- pele 1.10.0 bundle：705,014 B（gzip 263,423 B，约 689 KB / 257 KB）
- mermaid.js 11.17.2 bundle：3,572,661 B（gzip 980,422 B，约 3.4 MB / 958 KB）
- 本机 pele 渲染探针（同一张图，30 次取最小/中位）：
  - `parse()` ≈ 0.04 ms（中位 0.06 ms）
  - `render()` ≈ 0.24 ms（中位 0.39 ms）
  - 输出 SVG：1302×370、5.5 KB

## 复跑

```bash
node scripts/build-render-demo.mjs   # 生成 .probe/demo 下的对比/过程页面
# 用本机 http 服务打开 .probe/demo/{compare,process}.html 即可查看
```
