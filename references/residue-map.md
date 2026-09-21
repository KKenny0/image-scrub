# 图像残留与 AIGC 指纹地图 (Residue Map)

清洗图片远不止运行一次 `exiftool -all=`。对于旨在**消除 AI 生成痕迹、防平台算法降权**的场景，传统工具往往在关键关卡全盘皆输：不仅无法清除新型 C2PA 加密凭证，更无法防御平台的频域频谱检测，甚至因误删元数据导致照片翻转横置、色彩褪色变灰。

以下记录了各类图像格式中暗藏的 7 处关键残留位置与实测处理对策。

---

## 1. C2PA 内容凭据 (Content Credentials) —— 平台贴标的第一来源
* **出处**：DALL-E 3、Adobe Firefly、Microsoft Designer、Google 等主流模型默认内嵌。
* **物理位置**：
  * **JPEG**：存储于 `APP11` (Marker `0xFFEB`)，其结构为 JUMBF (ISO/IEC 19566-5) 超级格式，声明了 `c2pa` 声明、签名证书链与生成历史。
  * **PNG**：存储于自定义 Chunk `c2pa`。
  * **WebP**：存储于 RIFF 下的扩展 Chunk。
* **平台检测机制**：
  * TikTok、Meta (Instagram/Facebook)、YouTube、小红书等平台在图片上传时，首道机审就是扫描是否存在合法的 C2PA JUMBF Manifest。一旦验签通过，系统**毫秒级自动给帖子打上「AI 生成」标签或调低初始推荐权重**。
* **传统工具的坑**：
  * 许多常规 EXIF 清除器只针对 `APP1` 进行抹除，完全忽略了 `APP11`，导致 C2PA 完整幸存。
* **堵法**：
  * 绝不使用枚举黑名单，采用**白名单标记过滤**：JPEG 仅放行图像解码必需段，`APP11` 在结构上根本没有进入输出文件的通道。

---

## 2. AI 提示词与节点图 (PNG Text Chunks & WebP XMP)
* **出处**：Midjourney、Stable Diffusion (WebUI)、ComfyUI、Fooocus、NovelAI。
* **物理位置**：
  * **PNG 辅助块**：`tEXt`、`zTXt`（压缩文本）、`iTXt`（国际 UTF-8 文本）。
* **具体残留示例**：
  * **Stable Diffusion**：`parameters` 键值中包含完整的 `Prompt`, `Negative prompt`, `Steps`, `Sampler`, `CFG scale`, `Seed`, `Size`, `Model hash`。
  * **ComfyUI**：包含两个庞大的 JSON 块：`prompt`（API 级图执行流）和 `workflow`（完整的 UI 节点拓扑，甚至包含用户电脑上的本地文件绝对路径）。
  * **Midjourney**：`Description` 包含 `--ar 16:9 --v 6.0` 等专有控制指令。
* **堵法**：
  * PNG 白名单只放行关键数据块：`IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND` 以及合法的色彩配置块，所有文本块一律物理丢弃。

---

## 3. 扩散模型频域指纹 (Diffusion Frequency Artifacts)
* **出处**：几乎所有基于 U-Net 或 DiT 架构的扩散模型（SD1.5, SDXL, Flux, Midjourney）。
* **机理**：
  * 神经网络反卷积（Transposed Convolution）或上采样操作在生成高频细节时，会在图像的二维傅里叶变换（2D-FFT）频谱图上留下明显的**高频周期性网格伪影（Checkerboard Artifacts）**与异常的高频平滑曲线。
  * 现代商用 AI 检测器（Hive Moderation, Sightengine, Optic 等）利用卷积神经网络对这些频域特征极其敏感。
* **仅用 copy 模式的局限**：
  * 仅剥离元数据只能防住文本层机审，无法防御像素级频域分类模型。
* **堵法（`--mode capture` 截屏仿真）**：
  * **物理微扰重采样**：引入 0.05% 的轻微尺寸微调或 1 像素物理偏移，破坏原有的固定周期网格；
  * **防条带空间抖动 (Spatial Dithering / Micro Grain)**：在重编码过程中注入人眼几乎不可觉察的泊松微噪点，平滑高频异常能量峰，将图像特征拉回到自然成像（CCD/CMOS 传感器光电噪点）的统计分布区间，保持 SSIM > 0.985。

---

## 4. 画面方向反转陷阱 (EXIF Orientation Trap)
* **出处**：手机拍摄照片、部分摄影类 AI 生成器。
* **物理机制**：
  * 图像数据本身以未旋转的原始物理扫描顺序存储，而通过 EXIF Tag `0x0112` (Orientation) 指定显示旋转（例如 6 代表顺时针旋转 90 度，8 代表逆时针 90 度）。
* **常见恶果**：
  * 若直接粗暴抹除 EXIF，所有现代排版软件和浏览器失去旋转参考，图片会**横向翻转或颠倒**。
* **堵法**：
  * **`copy` 模式**：先检测 EXIF 中的 Orientation 值；若不为 1，必须执行 **无损 DCT 块转置（Lossless DCT Transposition）** 将像素矩阵物理转正，然后再抹除 Orientation 标签；
  * **`capture` 模式**：解码时物理完成像素级旋转归一化，直接输出正立无畸变图像。

---

## 5. 色彩褪色陷阱 (Display P3 / AdobeRGB Washout)
* **出处**：iPhone、iPad、Mac 屏幕截图、Midjourney 宽色域导出。
* **物理机制**：
  * 广色域图像依赖 `APP2` (ICC Profile) 或 PNG `iCCP` 块来指示颜色映射空间。ICC 文件中常夹杂设备唯一名称、校准时间、作者版权。
* **常见恶果**：
  * 盲目清空 ICC 会导致浏览器将其回退到窄色域 sRGB 解释，红色和肤色瞬间发暗、惨白褪色。
* **堵法**：
  * **拒绝裸奔**：采用 `macos-shot` 或 `web` Profile 时，剔除设备专属私有 ICC，注入标准化、中立且纯净的规范化 sRGB / Display P3 标头，既不漏设备标识，又保证色彩饱满不偏色。

---

## 6. 僵尸缩略图 (EXIF IFD1 Thumbnail Leak)
* **出处**：单反相机、手机相机、部分桌面图像编辑工具。
* **物理机制**：
  * EXIF 的 IFD1 区域包含一张极低分辨率的预览 JPEG。当用户使用普通软件打马赛克、裁剪掉敏感人脸或银行卡信息时，很多软件只更新了主图像，**遗漏了 IFD1 缩略图**。
* **泄密风险**：
  * 审查方可直接提取 IFD1 还原未裁剪的敏感全貌。
* **堵法**：
  * 白名单绝不放行 IFD1 任何片段。

---

## 7. 尾部追加伪装与动态照片 (Motion Photos / Trailing Payloads)
* **出处**：Google Pixel / 三星 Galaxy 动态照片，或人为制作的图种（Polyglot Files）。
* **物理机制**：
  * JPEG 文件规范中 `0xFFD9` (EOI) 代表图像结束。Android 动态照片直接在 `0xFFD9` 之后追加了 10~30MB 的完整 MP4 视频流（录下了按下快门前后 1.5 秒的现场音频和画面）。
* **泄密风险**：
  * 后缀改为 `.mp4` 即可直接播放视频，文件体积巨大容易引发审查。
* **堵法**：
  * 字节级扫描定位到首个合法 `EOI` / `IEND` 后，**强制截断后续所有字节**，坚决不带走任何尾随数据。

---

## 8. 四大合法伪装 Profile 的外观指纹对照表

| Profile 标识 | 伪装身份 | 适用场景 | 关键注入指纹 |
| :--- | :--- | :--- | :--- |
| **`macos-shot`**（默认） | Mac 原生系统截屏 | 电脑端创作者素材、教程博主、自媒体工作流 | PNG: `pHYs` 144 DPI, 标准 `sRGB` (Perceptual), `gAMA` 45455; JPEG: 规范化 JFIF 144 DPI |
| **`ios-shot`** | iPhone 移动端截屏 | 小红书/抖音等移动端短图分享 | 移动端分辨率规范，规范化 Display P3 色彩描述 |
| **`ps-web`** | Photoshop 存储为 Web | 设计师修图交付物 | 标准 sRGB IEC61966-2.1，经典高质量压缩量化表 (Quality 88~92) |
| **`canvas`** | 浏览器前端导出 | 网页应用在线工具生成 | 极简规范化 JFIF / sRGB，零任何私有块，全网基础通量最大 |
| **`bare`** | 纯裸流 | 极客与对体积极端敏感场景 | 无任何额外标识，仅保留解码所必需的最小数据段 |
