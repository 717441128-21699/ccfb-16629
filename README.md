# 玻眼 StressVision — 玻璃瓶残余应力视觉质检

双偏光片 + 工业相机方案的纯前端/TypeScript 原型。系统从偏光干涉彩色图像中分割瓶体与
**瓶口、瓶身、瓶底、瓶底中心**，用校准后的 Michel-Lévy/等色线 LUT 把 RGB 颜色反演为
光程差 Δ（nm），再按

\[
\sigma_1-\sigma_2=\frac{\Delta}{C\,t}
\]

计算主应力差/等效残余应力，按 GB/T 4545、ASTM C148 Apparent Temper Number 或工厂加严表
分级，标记超标像素位置，并按模具号、模腔、退火炉区和左/中/右位置做批次归因。

## 快速开始

```powershell
npm install
npm run dev
```

浏览器打开 Vite 输出的 `http://127.0.0.1:5173`。

生产构建：

```powershell
npm run build
npm run preview
```

合成真值验收：

```powershell
npm run validate
```

## 已实现页面

1. **拍摄校准页**
   - 0–320 nm 等色线校准楔块；
   - 普白、琥珀/茶色、青绿三种玻璃的通道吸收/白平衡补偿；
   - 暗场、平场、空间分辨率 mm/px、应力光学系数 \(C\)、厚度和标准阈值配置；
   - Web Worker 批量运行三种料色的 ≤10 nm 校准检查。

2. **单瓶应力页**
   - 4 种瓶型：500 mL 啤酒瓶、750 mL 葡萄酒瓶、350 mL 宽口酱料瓶、100 mL 口服液瓶；
   - 8 类退火/模具缺陷：正常、瓶底中心/四叶草、瓶跟环、瓶口、瓶身板、合模缝、炉温梯度、复合缺陷；
   - 自动轮廓、最大连通域、行区间填充、瓶底/瓶身/瓶口几何分区；
   - 等色线 RGB → Δ、厚度图 → MPa、P98 稳健峰值定级；
   - Canvas 原图/区域图/应力热力图和超标圆圈、坐标、级别、数值；
   - 支持上传真实相机帧。

3. **模具统计页**
   - 确定性合成 168 只批次，Worker 逐瓶分析并回报进度；
   - 模具拒检率柱状图、退火炉区 × 左/中/右拒检热力图；
   - 模具缺陷签名、Dominant defect、炉区横向温差归因；
   - 一键 CSV 导出，点击模具行筛选明细。

4. **质检报告页**
   - 样品、模具、炉区、校准、标准、分区 Δ/MPa/级别；
   - 偏光原图、区域分割、应力热力图三类图像证据；
   - 超标位置与处置建议；
   - 浏览器打印/另存 PDF，导出 JSON 结论。

## Web Worker 与渲染

`src/workers/analysis.worker.ts` 负责合成、分割、颜色反演、应力计算和批次循环；UI 线程只负责
DOM/Canvas。Worker 客户端见 `src/workerClient.ts`，使用 Vite 的

```ts
new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), { type: 'module' })
```

打包后会生成独立 `analysis.worker-*.js`。

## 合成真值

`src/core/synthetic.ts` 不是简单贴滤镜，而是：

- 参数化瓶型轮廓和局部行宽；
- 生成瓶口、瓶身双壁/切线路径、瓶底跟部和中心厚度图；
- 用 \(C=3.2\times10^{-12}\ \mathrm{Pa^{-1}}\) 将应力场转成 Δ；
- 在 400–700 nm 波长上积分相机 RGB QE、光源和
  \(\sin^2(\pi\Delta/\lambda)\) 偏光干涉项；
- 对琥珀/青绿玻璃做 Beer–Lambert 通道吸收；
- 加入 gamma、读出噪声、少量热/死像素；
- 输出像素级 Δ、MPa、区域和厚度真值，以及标准人工级别。

## 最近一次合成验收结果

运行环境：Windows / Node 24 / `tsx`，命令 `npm run validate`，退出码 0。

| 验收项 | 结果 |
|---|---:|
| 普白楔块最大 OPD 误差 | 5.26 nm |
| 琥珀楔块最大 OPD 误差 | 8.51 nm |
| 青绿楔块最大 OPD 误差 | 6.18 nm |
| 密集 ROI OPD P95 误差 | 8.86 nm |
| 关键区峰值 MAE | 3.82 nm |
| 分割 IoU | 1.00（合成几何） |
| 精确级别一致率 | 96.9% |
| 相邻一级一致率 | 100.0% |
| 合格/不合格结论一致率 | 100.0% |
| 预热后核心+热力图基准 | 约 52–82 ms/瓶，12–19 瓶/s（随机器负载） |

这些数字证明算法和合成数据闭环达到了题设的合成验收目标；真实产线仍需用已知光程差补偿片/
标准应力盘做相机级 GR&R，并用超声/测厚数据替换默认厚度模型。

## 关键目录

```text
src/core/
  analysis.ts          # Worker 中运行的主分析管线
  bottleGeometry.ts    # 瓶型轮廓、区域和厚度模型
  colorLut.ts          # 光谱 LUT、RGB→OPD、gamma 工具
  synthetic.ts         # 带真值的偏光瓶图合成器
  segmentation.ts      # 背景估计、Otsu、连通域、分区、厚度估计
  standards.ts         # GB/T 4545 / ASTM C148 / 加严内控阈值
  stats.ts             # 模具、炉区统计和归因
  batch.ts             # 确定性生产批次规格
src/ui/pages/          # 四个页面
src/workers/           # Web Worker
scripts/validate.ts    # 合成真值、精度、分级一致性、吞吐验收
```

## 物理落地注意事项

- 偏光片正交位置、光源均匀性、相机白平衡和曝光锁定必须在校准页固定。
- 有色瓶会显著吸收短波长；琥珀瓶应避免蓝通道欠曝，必要时使用单色/近红外补偿或多曝光。
- 单张 RGB 只能反演等色线 retardation；主应力方向/等倾线需要旋转检偏器或圆偏光/相移采集。
- \(\Delta=Ct(\sigma_1-\sigma_2)\) 测的是主应力差；若要拆成轴向/周向应力，需要瓶型几何和
  多个偏振方向。
- ASTM C148 和 GB/T 4545 是试验方法标准，不规定所有瓶型的唯一接收限值；`standards.ts`
  中的接收级别是透明、可修改的工厂默认值，正式仲裁应以标准原文和客户/瓶型规范为准。

## 参考

- [GB/T 4545-2007 玻璃瓶罐内应力试验方法](https://img.antpedia.com/standard/files/pdfs_ora/CN-GB/efc/GB_T%204545-2007_923.pdf)
- [ASTM C148 Standard Test Methods for Polariscopic Examination of Glass Containers](https://store.astm.org/standards/c148)
- [PTC: How to Use a Polarimeter to Measure Annealing Degree in Glass Container Bottom](https://www.ptc-stress.com/how-to-use-a-polarimeter-to-measure-annealing-degree-in-glass-container-bottom/)
- [Strain Optics: ASTM C148 Strain Disks for Glass Containers (PDF)](https://www.strainoptics.com/wp-content/uploads/2017/07/Strain-Disks-for-Glass-Containers-ASTM-C148.pdf)
