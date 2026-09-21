# image-scrub

> **AI 图像去痕与截屏仿真清洗工具** —— 阻断 AIGC 标识与频域指纹，模拟自然截屏防平台降权。

参考 [`video-scrub`](https://github.com/eternityspring/reelbench-skills/tree/main/skills/video-scrub) 核心设计哲学打造，专为消除社交平台（小红书、抖音、TikTok、Instagram）对 AI 生成图像（Midjourney, Stable Diffusion, ComfyUI, DALL-E 3, Flux 等）的算法识别与流量降权风险而设计。

---

## 核心痛点与攻防哲学

普通工具使用 `exiftool -all=` 仅仅是在做**黑名单枚举**，在实际反作弊对抗中存在三大致命缺陷：

1. **漏防 C2PA 加密凭据**：DALL-E 3、Adobe Firefly 内嵌的 C2PA 凭据存储于 `APP11` (JUMBF 格式)，常规去 EXIF 工具根本不碰 `APP11`，导致平台一秒识破并强制打标；
2. **频域伪影被捕获**：扩散模型特有的高频棋盘格周期伪影与不可见水印（SynthID/DWT），不经光栅化重构无法抹除；
3. **裸奔图引来强风控**：完全没有元数据的「三无裸奔图」属于异常文件。全网 99.9% 正常素材要么来自手机/电脑截屏，要么来自 Photoshop/醒图/Canva 导出。

### `image-scrub` 的解决方案

* **白名单结构重构**：不枚举要删什么，只说带什么过去（图像必需解码段），C2PA、Prompt、本地路径根本没有进入输出文件的物理通道；
* **截屏仿真模式 (`capture`)**：物理模拟用户在 macOS/iOS 屏幕截屏的过程，通过微扰重采样（0.05% 微缩放 + 抖动）粉碎扩散模型频域特征；
* **合法身份伪装 (`profile`)**：模拟主流创作者的高频出图通道（Mac 截屏、iPhone 截屏、Photoshop Web 导出、Canvas 画布导出）；
* **10 道安全门与探针反向扫描**：提取原图所有特征词在输出中穷举扫描，扎中一根立即报红拒签。

---

## 运行模式对比

| 模式 | 核心机理 | 典型耗时 | 推荐场景 | 防降权能力 |
| :--- | :--- | :--- | :--- | :--- |
| **`capture`**（默认推荐） | **模拟系统截屏**：光栅化重构 + 微扰重采样 + 标准量化重编 + Profile 注入 | ~0.1 - 0.5s | **核心主力**：防平台 AIGC 机审与频域模型检测 | ⭐️⭐️⭐️⭐️⭐️ |
| **`copy`** | **极速二进制白名单**：纯 Chunk/Marker 剥离，逐字节保留原图像素 | <10ms | 要求 100% 原始像素逐位不变、纯净去元数据 | ⭐️⭐️⭐️ |

---

## 五大伪装 Profile

* **`macos-shot`**（默认）：模拟 macOS 原生截图（`Cmd+Shift+4`）或 Shottr 导出。PNG 注入标准 144 DPI `pHYs`、`sRGB` (Perceptual) 与 `gAMA` (45455)；JPEG 注入标准 144 DPI JFIF。
* **`ios-shot`**：模拟 iPhone 移动端截图，注入规范化 Display P3 描述，匹配移动端生活博主发帖场景。
* **`ps-web`**：模拟 Adobe Photoshop「存储为 Web 所用格式 (Legacy)」，注入标准 sRGB IEC61966-2.1。
* **`canvas`**：模拟前端 `<canvas>.toDataURL()` 导出的纯净通用图像。
* **`bare`**：极客裸流档，除了解码必需段外不含任何标识。

---

## 快速安装与依赖

本项目基于 **Node.js ESM 标准库开发，零外部 npm 依赖**。
只需确保系统安装了 `node` (>=18) 与 `ffmpeg`。

```bash
# 验证环境就绪
node -v
ffmpeg -version
```

---

## CLI 命令与使用范例

### 1. 深度嗅探检查 (`inspect`)
全面分析图片中暗藏的 C2PA、Prompt、尾随动态照片（MP4）与探针总数：
```bash
node scripts/image-scrub.mjs inspect input.png
```

### 2. 执行清洗与截屏仿真 (`scrub`)
```bash
# 默认模式：截屏仿真 + macOS 截图伪装
node scripts/image-scrub.mjs scrub input.png -o clean.png

# 极速无损白名单模式
node scripts/image-scrub.mjs scrub input.jpg -o clean.jpg --mode copy

# 伪装为 Photoshop 导出
node scripts/image-scrub.mjs scrub input.png -o clean.png --profile ps-web
```

### 3. 严格验收 (`verify`)
运行 10 道安全门与字节级探针扫描：
```bash
node scripts/image-scrub.mjs verify input.png clean.png
```

### 4. 一体化流水线 (`run` - 日常推荐)
一键串联 `inspect` -> `scrub` -> `verify`：
```bash
node scripts/image-scrub.mjs run input.png -o clean.png
```

---

## 真实实测案例 (Showcase)

以一张真实的 **AI 生成中文营销海报 (`768 × 1024`)** 为例，运行一体化清洗仿真流水线：

```bash
node scripts/image-scrub.mjs run examples/officecli-poster.jpg -o examples/officecli-clean.jpg
```

### 1. 处理前后实测对照

| 测量维度 | 原图 (`examples/officecli-poster.jpg`) | 清洗后 (`examples/officecli-clean.jpg`) | 效果与意义 |
| :--- | :--- | :--- | :--- |
| **文件大小** | 405.7 KB | **154.4 KB** | **体积减少 61.9%**，消除无效压缩冗余 |
| **分辨率** | `768 × 1024` | `768 × 1024` | **1:1 精确保持**，无拉伸裁切 |
| **JPEG 标记段** | `APP0, APP2 (ICC), DQT*2, SOF0, DHT*4, SOS, EOI` | `APP0, DQT, DHT, SOF0, SOS, EOI` | 阻断携带私有参数的 `APP2` 描述块 |
| **视觉保真度** | 基准 | **PSNR: 41.05 dB** / **SSIM: 0.978** | **达到工业级人眼无损标准**，文字边缘平滑锐利 |
| **伪装 Profile** | 原始生成器特征 | **`macos-shot`** (标准 144 DPI JFIF) | 机器识别为「Mac 高分屏截屏产物」 |
| **特征探针残留** | 检出 `mntrRGB`、`-para` 探针 | **0 残留 (100% 清空)** | 字节级探针扫描全部通过 |

### 2. 10 道防降权安全门实测输出

```text
门 01 [✓] 字节级针扫描 (Needle Scan)       : 扫描 2 根特征探针，0 残留
门 02 [✓] C2PA 凭据彻底消除                : 未发现 JUMBF / c2pa 签名声明
门 03 [✓] AI 提示词/工作流清零               : 未发现 parameters / workflow / Prompt 块
门 04 [✓] 尾部追加/动态照片截断                : 文件严格在图像结束符截断，0 尾随字节
门 05 [✓] 次级缩略图与多图隔绝                 : 无次级预览图与 MPF 深度图
门 06 [✓] 通用 EXIF/XMP 标签清零           : APP1 / eXIf / XMP 区域完全清空
门 07 [✓] Profile 伪装指纹合规             : 符合 macos-shot 144 DPI 规范
门 08 [✓] 色彩与直方图健康                   : 像素通道与直方图基准健康
门 09 [✓] 防降权微扰动有效性                  : 二进制哈希重塑完成，频域周期伪影已破坏
门 10 [✓] 文件格式合法可解码                  : 标准 JPEG 图像结构完整
--------------------------------------------------------
验收判定: ✅ 完美通过 (SAFE TO PUBLISH)
```

---

## 10 道防降权安全门体系

| 门编号 | 门名称 | 判定标准 |
| :--- | :--- | :--- |
| **门 01** | **字节级针扫描 (Needle Scan)** | 原图抓取的所有特征串（≥5 字节）在输出二进制中出现 0 次 |
| **门 02** | **C2PA 凭据彻底消除** | 严查 `c2pa`、`jumbf`、`Content Credentials`，任何残留立即拒签 |
| **门 03** | **AI 提示词/工作流清零** | 绝对不允许存在 `parameters`, `workflow`, `negative_prompt`, `ComfyUI` 等块 |
| **门 04** | **尾部追加/动态照片截断** | 输出文件大小严格等于有效图像结束符截断字节，无任何尾随数据 (如 MP4) |
| **门 05** | **次级缩略图与多图隔绝** | 绝对禁止存在次级 IFD1、预览 JPEG，杜绝打码原图泄漏 |
| **门 06** | **通用 EXIF/XMP 标签清零** | APP1 / eXIf / XMP 区域完全清空 |
| **门 07** | **Profile 伪装指纹合规** | 检查输出文件的标记段和 Chunk 构成，必须与声明的 Profile 完全吻合 |
| **门 08** | **色彩与直方图健康** | 验证像素通道与直方图基准健康，杜绝偏色变灰 |
| **门 09** | **防降权微扰动有效性** | 验证频域重构与微扰已生效，二进制哈希已重塑 |
| **门 10** | **文件格式合法可解码** | 输出文件能被标准解码器解析，尺寸与通道数符合预期 |

---

## 运行单元自测

内置 11 项全自动化断言，包含 C2PA 伪造样本、ComfyUI 恶意工作流注入、尾随 MP4 数据等多道门击穿用例：

```bash
npm test
# 或
node scripts/selftest.mjs
```

---

## 开源协议

本项目采用 [Apache-2.0](LICENSE) 协议。
