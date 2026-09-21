---
name: image-scrub
version: 1.0.0
description: |
  彻底洗掉图片中的 AI 生成痕迹与敏感元数据，消除社交平台对 AIGC 的识别与降权风险。
  核心哲学对标 video-scrub：坚持白名单而非黑名单，通过结构性重构切断所有元数据通道。
  重点攻坚隐蔽杀手：阻断 DALL-E/Adobe 的 C2PA 凭据、剥离 SD/ComfyUI 的 Prompt 与 Workflow 块、
  截断手机 Motion Photo 尾部追加的数十兆 MP4 视频、防止打码后 EXIF 缩略图泄漏。
  提供两大核心模式：
  1. 默认 `--mode capture`：模拟真实系统截屏，通过光栅化重构与 0.05% 微扰动破坏扩散模型频域特征与弱水印，
     输出伪装为合规的系统截图（macos-shot、ios-shot）或设计软件导出（ps-web），从根本上防算法降权；
  2. `--mode copy`：纯二进制白名单过滤与无损 DCT 方向回正，画面零质量损失，毫秒级完成。
  验收拒绝自嗨：提取源图所有提示词与标识作为探针进行字节级全量扫描，10 道安全门严防死守。
  零 npm 依赖，开箱即用。
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
triggers:
  - image-scrub
  - 图片去痕
  - 去 AI 痕迹
  - 消除生成痕迹
  - 防降权
  - 去元数据
  - 图片隐私
  - 截屏仿真
  - scrub image
  - strip image metadata
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node      # >= 18，只用标准库，无 npm 依赖
      - ffmpeg    # 负责截屏仿真渲染、像素微扰与无损方向归一化
  runtimes:
    - claude-code
    - codex
    - antigravity
---

把一张图片重建成「纯净且合规」的视觉资产：**机器抓不到任何 AI 凭证，频域特征恢复自然，外观完全如同自然截屏或设计软件导出。**

`{baseDir}` = 本技能所在目录。核心脚本 `{baseDir}/scripts/image-scrub.mjs`，零外部依赖，`node` 直接运行。

---

### 原理：白名单阻断 + 截屏仿真伪装

在针对社交平台（小红书、抖音、TikTok、Instagram）防 AIGC 降权的攻防战中，传统黑名单（`exiftool -all=`）必败无疑：

| 对比维度 | 传统黑名单工具 | `image-scrub` 方案 |
| :--- | :--- | :--- |
| **元数据处理** | 枚举已知 tag 删除（漏掉 APP11 C2PA、PNG 私有块） | **白名单**：只保留解码必需段，C2PA 与 Prompt 结构上根本进不来 |
| **频域与水印** | 完全无能为力（扩散模型高频棋盘格伪影依然被机审识别） | **截屏仿真（`capture`）**：光栅化重构 + 微扰动，彻底破坏 AI 特征 |
| **平台审查眼光** | 纯裸流无标记，被视为「高度异常样本」复审 | **合法伪装（Profile）**：模拟真实的 Mac/iOS 截屏或 Photoshop Web 导出 |
| **画面翻转** | 粗暴删 EXIF 导致手机照片翻转 90 度倒立 | **无损归一化**：自动物理回正，无需元数据即可正向显示 |
| **验收机制** | 仅凭命令返回码声明成功 | **探针扫描 + 10 道安全门**，字节级证明真的没了 |

---

### 两种运行模式

| 模式 | 核心机理 | 适用场景 | 防降权能力 |
| :--- | :--- | :--- | :--- |
| **`capture`**（默认推荐） | **模拟系统物理截屏**：光栅化解码、微扰重采样 (0.05%)、注入微量抖动、注入合规 Profile | **防平台 AIGC 审核王牌**：破坏生成模型频域伪影与弱隐写，重塑标准量化表 | ⭐️⭐️⭐️⭐️⭐️ |
| **`copy`** | **极速二进制白名单**：仅做 Marker / Chunk 物理剥离与无损 DCT 旋转，不重新压制像素 | 追求 100% 原始像素逐位不变、纯净去元数据、毫秒级响应 | ⭐️⭐️⭐️ |

---

### 四大伪装 Profile

| Profile | 伪装目标 | 输出特征 |
| :--- | :--- | :--- |
| **`macos-shot`**（默认） | macOS 原生系统截图 | PNG: 注入 144 DPI `pHYs`、标准 `sRGB` 与 `gAMA`；JPEG: 标准 144 DPI JFIF |
| **`ios-shot`** | iPhone 移动端截图 | 匹配移动端博主发帖场景，规范化 Display P3 描述 |
| **`ps-web`** | Photoshop 存储为 Web | 经典高质量基准量化表，标准 sRGB 空间 |
| **`canvas`** | 浏览器前端导出 | 模拟 `<canvas>.toDataURL()`，全网通量最大的中立格式 |
| **`bare`** | 纯裸流 | 仅保留解码所必需的最小数据段，不带任何可证伪声明 |

---

### 快速上手四步法

#### Step 0 — 查看图片暗藏了什么
```bash
node {baseDir}/scripts/image-scrub.mjs inspect <input_image>
```
一屏看尽：是否存在 C2PA 凭据、AI Prompt / Workflow 块、方向旋转状态、色域配置、以及尾部是否绑着动态照片（MP4）。末尾会打印验收探针总数。

#### Step 1 — 执行清洗与仿真
```bash
node {baseDir}/scripts/image-scrub.mjs scrub <input_image> -o clean.png
```
默认采用 `--mode capture --profile macos-shot`。常用控制参数：
```bash
--mode copy              # 切换为无损二进制快速模式
--profile ps-web         # 伪装为 Photoshop 导出
--profile bare           # 极客裸流
--quality 92             # capture 模式下的质量因子 (默认 92)
```

#### Step 2 — 验收 ⛔（决不凭声称，用针扫描证明）
```bash
node {baseDir}/scripts/image-scrub.mjs verify <source_image> <clean_image>
```
把原图所有的提示词、软件名、模型 Hash 抓出来当「针」，在输出二进制中遍历。扎中一根立即报红。

#### 一体化流水线（日常推荐使用）
```bash
node {baseDir}/scripts/image-scrub.mjs run <input_image> -o clean.png
```
自动串联 `inspect` -> `scrub` -> `verify`，一步到位输出洁净合规图像并展示验收报告。

---

### 10 道防降权安全门

| 门编号 | 门名称 | 拦截目标与判定标准 |
| :--- | :--- | :--- |
| **门 1** | **字节级针扫描 (Needle Scan)** | 原图抓取的所有特征串（≥5 字节）在输出二进制中出现次数必须为 0 |
| **门 2** | **C2PA 绝对绝迹** | 严查 `c2pa`、`jumbf`、`Content Credentials` 标识，任何残留直接拒签 |
| **门 3** | **AI 提示词/工作流清零** | 绝对不允许存在 `parameters`, `workflow`, `negative_prompt`, `ComfyUI` 等块 |
| **门 4** | **动态照片/尾部追加截断** | 输出文件大小必须严格等于有效格式头至结束符（EOI/IEND）的字节数 |
| **门 5** | **僵尸缩略图隔绝** | 绝对禁止存在次级 IFD1、预览 JPEG，杜绝打码敏感原图泄漏 |
| **门 6** | **方向物理回正 (Orientation)** | 画面物理朝向必须为正（Top-Left / 1），不依赖任何元数据标签 |
| **门 7** | **Profile 伪装合规** | 检查输出文件的标记段和 Chunk 构成，必须与声明的 Profile 完全吻合 |
| **门 8** | **色彩保真度验证** | 验证直方图均值与色域映射正常，杜绝抹除元数据引发的色彩泛灰变惨 |
| **门 9** | **频域扰动度检查 (`capture`)** | 在截屏仿真模式下，验证微扰已生效且 SSIM 处于 >0.985 的超高保真区间 |
| **门 10** | **合法可解码性** | 输出文件必须能被标准解码器正常解析，尺寸与通道数符合预期 |

---

### 自动化自测试
```bash
node {baseDir}/scripts/selftest.mjs
```
内置包含 C2PA 伪造样本、ComfyUI 恶意工作流注入、尾随 MP4 数据、反向旋转等 10 道门全量击穿用例。
改完代码随时跑此命令检验防御有效性。
