// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BinaryService } from '../src/binary/binary-service';
import { VaultFsService } from '../src/fs/fs-service';
import { parseXlsxToModel } from '../src/binary/xlsx-convert';
import { parseXmindToModel } from '../src/binary/xmind-convert';
import { readDocxToHtml } from '../src/binary/docx-semantic';
import { createHash } from 'node:crypto';

/** DEV-084：binary:create 在 vault 内创建空白 docx / xlsx / xmind。 */
describe('BinaryService.createEmpty (DEV-084 ticket spec)', () => {
  let root: string;
  let fs: VaultFsService;
  let service: BinaryService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'nexnote-binary-create-'));
    fs = new VaultFsService(() => root);
    service = new BinaryService(fs, () => root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('空白 docx 可被 readDocxToHtml 解析', async () => {
    const { path: created } = await service.createBinary('docx', { title: '空白文档' });
    expect(created.endsWith('.docx')).toBe(true);
    expect(existsSync(path.join(root, created))).toBe(true);
    // 落盘字节应当至少包含若干字节（最小 docx 包含 [Content_Types].xml 等）
    const buf = readFileSync(path.join(root, created));
    expect(buf.length).toBeGreaterThan(100);
    // 解析往返
    const { html } = await readDocxToHtml(buf);
    expect(typeof html).toBe('string');
  });

  it('空白 xlsx 含 1 个空 sheet，模型可读回', async () => {
    const { path: created } = await service.createBinary('xlsx', { title: '空白表格' });
    expect(created.endsWith('.xlsx')).toBe(true);
    const buf = readFileSync(path.join(root, created));
    const { sheets } = parseXlsxToModel(buf);
    expect(Array.isArray(sheets)).toBe(true);
    expect(sheets.length).toBe(1);
  });

  it('空白 xmind 含单根节点，模型可读回', async () => {
    const { path: created } = await service.createBinary('mindmap', { title: '空白导图' });
    expect(created.endsWith('.xmind')).toBe(true);
    const buf = readFileSync(path.join(root, created));
    const { model } = await parseXmindToModel(buf);
    expect(model).toBeTruthy();
    expect(model.data?.text).toBe('空白导图');
  });

  it('命名冲突自动追加 " 2" / " 3" 等后缀', async () => {
    const first = await service.createBinary('xlsx', { title: 'report' });
    const second = await service.createBinary('xlsx', { title: 'report' });
    const third = await service.createBinary('xlsx', { title: 'report' });
    expect(first.path).toMatch(/report\.xlsx$/);
    expect(second.path).toMatch(/report 2\.xlsx$/);
    expect(third.path).toMatch(/report 3\.xlsx$/);
  });

  it('写入 sidecar metadata，format 与 sha256 正确', async () => {
    const { path: created, sha256 } = await service.createBinary('xlsx', { title: 'meta' });
    // metadata 路径由 base64url(documentPath) 派生
    const encoded = Buffer.from(created).toString('base64url');
    const sidecarPath = path.join(root, '.nexnote', 'metadata', `${encoded}.json`);
    expect(existsSync(sidecarPath)).toBe(true);
    const meta = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    expect(meta.format).toBe('xlsx');
    expect(meta.sourceSha256).toBe(sha256);
    // sha256 与磁盘字节一致
    const actual = createHash('sha256').update(readFileSync(path.join(root, created))).digest('hex');
    expect(actual).toBe(sha256);
  });

  it('sanitizeBaseName 清理路径分隔符与控制字符', async () => {
    const { path: created } = await service.createBinary('xlsx', { title: 'foo/bar:baz*' });
    // / 替换为 _，: 和 * 同样替换
    expect(created).toMatch(/foo_bar_baz_\.xlsx$/);
  });
});