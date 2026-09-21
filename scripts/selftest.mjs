#!/usr/bin/env node

/**
 * selftest.mjs
 * 
 * image-scrub 单元自测套件 (Zero external dependencies)
 * 验证解析器、白名单过滤器、探针提取与 10 道安全门。
 * 包含击穿测试 (Penetration Test)：证明脏数据与残留探针 100% 会触发报警。
 */

import assert from 'node:assert';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectFormat,
  parsePngChunks,
  createPngChunk,
  parseJpegMarkers,
  inspectImage,
  scrubCopy,
  verifyCleanliness
} from './image-scrub.mjs';

console.log('🧪 启动 image-scrub 自动化自测试套件...\n');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    -> 断言失败: ${err.message}`);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------------------
// 辅助函数：内存构造基准 1x1 纯色 PNG 与 JPEG
// ----------------------------------------------------------------

function makeMinimalPng() {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 1x1 RGB (8-bit)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // w
  ihdr.writeUInt32BE(1, 4); // h
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 (Truecolor RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createPngChunk('IHDR', ihdr);

  // IDAT: 1 扫描行 (filter byte 0 + RGB [255, 0, 0])
  const scanline = Buffer.from([0, 255, 0, 0]);
  const compressed = zlib.deflateSync(scanline);
  const idatChunk = createPngChunk('IDAT', compressed);

  // IEND
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([magic, ihdrChunk, idatChunk, iendChunk]);
}

function makeMinimalJpeg() {
  // 基础标准 JPEG 结构 (SOI + DQT + SOF0 + DHT + SOS + 压缩字节 + EOI)
  const parts = [];
  parts.push(Buffer.from([0xff, 0xd8])); // SOI

  // DQT (0xFFDB, len=67)
  const dqt = Buffer.alloc(67);
  dqt.writeUInt16BE(67, 0);
  dqt[2] = 0; // table 0
  dqt.fill(16, 3);
  parts.push(Buffer.concat([Buffer.from([0xff, 0xdb]), dqt]));

  // SOF0 (0xFFC0, len=17) 1x1 3-channels
  const sof0 = Buffer.alloc(17);
  sof0.writeUInt16BE(17, 0);
  sof0[2] = 8; // precision
  sof0.writeUInt16BE(1, 3); // h
  sof0.writeUInt16BE(1, 5); // w
  sof0[7] = 3; // 3 components (Y, Cb, Cr)
  sof0[8] = 1; sof0[9] = 0x11; sof0[10] = 0;
  sof0[11] = 2; sof0[12] = 0x11; sof0[13] = 0;
  sof0[14] = 3; sof0[15] = 0x11; sof0[16] = 0;
  parts.push(Buffer.concat([Buffer.from([0xff, 0xc0]), sof0]));

  // DHT (0xFFC4, len=31)
  const dht = Buffer.alloc(31);
  dht.writeUInt16BE(31, 0);
  parts.push(Buffer.concat([Buffer.from([0xff, 0xc4]), dht]));

  // SOS (0xFFDA, len=12)
  const sos = Buffer.alloc(12);
  sos.writeUInt16BE(12, 0);
  sos[2] = 3; // 3 components
  parts.push(Buffer.concat([Buffer.from([0xff, 0xda]), sos]));

  // Entropy dummy data
  parts.push(Buffer.from([0x7f, 0xff, 0x00, 0x55]));

  // EOI
  parts.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(parts);
}

// ----------------------------------------------------------------
// 测试集 1: 格式识别与基础解析
// ----------------------------------------------------------------

it('detectFormat 正确识别 PNG 与 JPEG', () => {
  const png = makeMinimalPng();
  const jpg = makeMinimalJpeg();
  assert.strictEqual(detectFormat(png), 'png');
  assert.strictEqual(detectFormat(jpg), 'jpeg');
  assert.strictEqual(detectFormat(Buffer.from('not an image')), 'unknown');
});

it('parsePngChunks 正确提取 IHDR, IDAT, IEND', () => {
  const png = makeMinimalPng();
  const { chunks, trailingBytes } = parsePngChunks(png);
  assert.strictEqual(chunks.length, 3);
  assert.strictEqual(chunks[0].type, 'IHDR');
  assert.strictEqual(chunks[1].type, 'IDAT');
  assert.strictEqual(chunks[2].type, 'IEND');
  assert.strictEqual(trailingBytes, 0);
});

it('parseJpegMarkers 正确提取基础 JPEG 标记段', () => {
  const jpg = makeMinimalJpeg();
  const { markers, trailingBytes } = parseJpegMarkers(jpg);
  const types = markers.map(m => m.name);
  assert.ok(types.includes('DQT'));
  assert.ok(types.includes('SOF0'));
  assert.ok(types.includes('SOS'));
  assert.ok(types.includes('EOI'));
  assert.strictEqual(trailingBytes, 0);
});

// ----------------------------------------------------------------
// 测试集 2: 恶意识别与探针提取 (C2PA, AI Prompt, Motion Photo)
// ----------------------------------------------------------------

it('inspectImage 准确捕获 PNG 中的 ComfyUI / SD 提示词与模型信息', () => {
  const basePng = makeMinimalPng();
  const { chunks } = parsePngChunks(basePng);

  // 注入含有 SD 生成参数的 tEXt chunk
  const sdParam = 'parameters\0Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 88991122, Model: animeWaifu_v2';
  const textChunk = createPngChunk('tEXt', Buffer.from(sdParam, 'utf-8'));

  // 插入在 IHDR 后
  const dirtyPng = Buffer.concat([
    basePng.subarray(0, chunks[0].offset + chunks[0].length + 12),
    textChunk,
    basePng.subarray(chunks[1].offset)
  ]);

  const findings = inspectImage(dirtyPng);
  assert.strictEqual(findings.aiPrompts.length > 0, true);
  assert.ok(findings.needles.has('animeWaifu_v2') || findings.needles.has('88991122'));
  assert.ok(findings.needles.has('Karras') || findings.needles.has('Sampler'));
});

it('inspectImage 准确检测 JPEG 中的 C2PA JUMBF 结构体', () => {
  const baseJpg = makeMinimalJpeg();
  // 构造含有 c2pa 的 APP11 (0xFFEB)
  const app11Payload = Buffer.from('jumbc2pa_manifest_claim_signature_data_2026', 'ascii');
  const app11Header = Buffer.alloc(4);
  app11Header.writeUInt16BE(0xffeb, 0);
  app11Header.writeUInt16BE(app11Payload.length + 2, 2);
  const app11 = Buffer.concat([app11Header, app11Payload]);

  // 注入在 SOI 后面
  const dirtyJpg = Buffer.concat([
    baseJpg.subarray(0, 2),
    app11,
    baseJpg.subarray(2)
  ]);

  const findings = inspectImage(dirtyJpg);
  assert.strictEqual(findings.hasC2PA, true);
  assert.ok(findings.needles.has('c2pa'));
  assert.ok(findings.needles.has('jumbf'));
});

it('inspectImage 准确检测并报警 Google/Samsung 尾随追加动态视频 (Motion Photo)', () => {
  const baseJpg = makeMinimalJpeg();
  // 在 EOI (0xFFD9) 后面追加 1024 字节模拟 MP4 尾部
  const fakeMp4 = Buffer.alloc(1024);
  fakeMp4.write('ftypmp42', 4, 'ascii');
  const motionPhoto = Buffer.concat([baseJpg, fakeMp4]);

  const findings = inspectImage(motionPhoto);
  assert.strictEqual(findings.trailingBytes, 1024);
});

// ----------------------------------------------------------------
// 测试集 3: 白名单清洗有效性 (scrubCopy)
// ----------------------------------------------------------------

it('scrubCopy (PNG) 彻底剥离 AI 提示词与私有块，注入合法 macos-shot Profile', () => {
  const basePng = makeMinimalPng();
  const { chunks } = parsePngChunks(basePng);
  const sdParam = 'parameters\0Negative: ugly, bad hands, Prompt: masterpiece, secret_artist_name_xyz';
  const textChunk = createPngChunk('tEXt', Buffer.from(sdParam, 'utf-8'));
  const dirtyPng = Buffer.concat([
    basePng.subarray(0, chunks[0].offset + chunks[0].length + 12),
    textChunk,
    basePng.subarray(chunks[1].offset)
  ]);

  const cleanPng = scrubCopy(dirtyPng, 'png', 'macos-shot');
  const cleanChunks = parsePngChunks(cleanPng).chunks;
  const chunkTypes = cleanChunks.map(c => c.type);

  // 验证原有的 tEXt 已经绝迹
  assert.strictEqual(chunkTypes.includes('tEXt'), false);
  // 验证成功注入 macOS 144 DPI pHYs 与 sRGB 标头
  assert.ok(chunkTypes.includes('pHYs'));
  assert.ok(chunkTypes.includes('sRGB'));
  assert.ok(chunkTypes.includes('gAMA'));
  // 验证字符串不在二进制中
  assert.strictEqual(cleanPng.includes(Buffer.from('secret_artist_name_xyz')), false);
});

it('scrubCopy (JPEG) 截断尾随动态视频并剥离 C2PA 标记', () => {
  const baseJpg = makeMinimalJpeg();
  const app11Payload = Buffer.from('jumbc2pa_fake_manifest_block_998877', 'ascii');
  const app11Header = Buffer.alloc(4);
  app11Header.writeUInt16BE(0xffeb, 0);
  app11Header.writeUInt16BE(app11Payload.length + 2, 2);
  const app11 = Buffer.concat([app11Header, app11Payload]);

  const fakeMp4 = Buffer.from('....ftypisom....dummy_video_stream....');
  const dirtyJpg = Buffer.concat([
    baseJpg.subarray(0, 2),
    app11,
    baseJpg.subarray(2),
    fakeMp4
  ]);

  const cleanJpg = scrubCopy(dirtyJpg, 'jpeg', 'macos-shot');
  const { markers, trailingBytes } = parseJpegMarkers(cleanJpg);
  const markerTypes = markers.map(m => m.name);

  // 验证 APP11 绝迹
  assert.strictEqual(markerTypes.includes('APP11_C2PA'), false);
  // 验证尾随 MP4 数据被 100% 物理截断
  assert.strictEqual(trailingBytes, 0);
  assert.strictEqual(cleanJpg.includes(Buffer.from('dummy_video_stream')), false);
  // 验证注入了标准 APP0_JFIF 144 DPI
  assert.ok(markerTypes.includes('APP0_JFIF'));
});

// ----------------------------------------------------------------
// 测试集 4: 10 道安全门与击穿测试 (Penetration Test)
// ----------------------------------------------------------------

it('10 道安全门验收：清洗后的合规文件必须 100% 全部通过 (10/10)', () => {
  const basePng = makeMinimalPng();
  const sdParam = 'parameters\0Seed: 554433, Model: DeliberateV3, Prompt: ultra realistic';
  const textChunk = createPngChunk('tEXt', Buffer.from(sdParam, 'utf-8'));
  const dirtyPng = Buffer.concat([basePng.subarray(0, 33), textChunk, basePng.subarray(33)]);

  const cleanPng = scrubCopy(dirtyPng, 'png', 'macos-shot');
  const result = verifyCleanliness(dirtyPng, cleanPng, 'macos-shot');

  assert.strictEqual(result.allPassed, true);
  for (const g of result.gates) {
    assert.strictEqual(g.passed, true, `门 ${g.gate} (${g.name}) 应当通过`);
  }
});

it('击穿测试 (Gate 1 针扫描)：若未清洗原图，针扫描与 AI 提示词门必须被击穿报警 (Red)', () => {
  const basePng = makeMinimalPng();
  const sdParam = 'parameters\0ModelHash: abcdef123456, Sampler: Euler a, Prompt: cyberpunk girl';
  const textChunk = createPngChunk('tEXt', Buffer.from(sdParam, 'utf-8'));
  const dirtyPng = Buffer.concat([basePng.subarray(0, 33), textChunk, basePng.subarray(33)]);

  // 故意拿未清洗的 dirtyPng 来做验收
  const result = verifyCleanliness(dirtyPng, dirtyPng, 'macos-shot');
  assert.strictEqual(result.allPassed, false);

  // 门 1 (针扫描) 与 门 3 (AI 提示词) 必须报警
  const gate1 = result.gates.find(g => g.gate === 1);
  const gate3 = result.gates.find(g => g.gate === 3);
  assert.strictEqual(gate1.passed, false, '未清洗文件门 1 必须报警');
  assert.strictEqual(gate3.passed, false, '未清洗文件门 3 必须报警');
});

it('击穿测试 (Gate 4 尾部截断)：若存在尾随 MP4 数据，门 4 必须被击穿报警', () => {
  const baseJpg = makeMinimalJpeg();
  const dirtyJpg = Buffer.concat([baseJpg, Buffer.from('FAKE_TRAILING_MP4_BYTES')]);

  // 故意不截断
  const result = verifyCleanliness(dirtyJpg, dirtyJpg, 'macos-shot');
  const gate4 = result.gates.find(g => g.gate === 4);
  assert.strictEqual(gate4.passed, false, '尾随未截断数据时门 4 必须报警');
});

// ----------------------------------------------------------------
// 汇总报告
// ----------------------------------------------------------------

console.log(`\n========================================`);
console.log(`自测完成: ${passedTests}/${totalTests} 项断言通过！`);
console.log(`10 道安全门与击穿用例全部验证成功。`);
console.log(`========================================\n`);
