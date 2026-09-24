import JSZip from 'jszip';

/**
 * DEV-074 code-review 修复：只读保留区（xlsx 宏 / 图表 / 透视表、xmind 外框 / 关联线 / 图片资源）
 * 在保存时原字节不丢失（ADR-0015 Decision 4「不支持内容绝不悄悄丢弃」）。
 *
 * 策略：以重建包为基座，从原包回填重建包中缺失的 zip 条目（内容字节原样复制，不做二次转换），
 * 并对两个按名重建的元数据文件（xlsx 的 [Content_Types].xml / *.rels、xmind 的 manifest.json）
 * 做结构化合并，使回填部件仍被 OpenXML / XMind 的关系与清单引用到。
 *
 * 注意：回填的是 entry 内容字节；zip 容器层的压缩参数可能由 JSZip 重写，但应用层承诺的
 * 「原始字节不丢失」以 entry 内容为准，单元测试直接断言内容字节一致。
 */
async function loadZip(bytes: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

function entryNames(zip: JSZip): Set<string> {
  const names = new Set<string>();
  zip.forEach((relativePath, file) => {
    if (!file.dir) names.add(relativePath);
  });
  return names;
}

/**
 * 把 original 中 rebuilt 缺失的 entry 原样补回 rebuilt（xlsx / xmind 通用）。
 * 仅缺失名会被添加；同名条目以 rebuilt（模型输出）为准，防止旧模型数据覆盖新编辑。
 */
async function fillMissingEntries(
  original: JSZip,
  rebuilt: JSZip,
  shouldPreserve: (name: string) => boolean,
): Promise<Set<string>> {
  const rebuiltNames = entryNames(rebuilt);
  const restored = new Set<string>();
  for (const [name, file] of Object.entries(original.files)) {
    if (file.dir || rebuiltNames.has(name) || !shouldPreserve(name)) continue;
    const data = await file.async('nodebuffer');
    rebuilt.file(name, data);
    restored.add(name);
  }
  return restored;
}

function isXlsxReadonlyPart(name: string): boolean {
  return (
    /^xl\/vbaProject\.bin$/i.test(name) ||
    /^xl\/(?:charts|drawings|pivotCache|pivotTables|slicers|slicerCaches|externalLinks|embeddings)\//i.test(name)
  );
}

function isXmindReadonlyPart(name: string): boolean {
  return name === 'content.xml' || /^resources\//i.test(name) || /^attachments\//i.test(name);
}

/**
 * 合并原包里 rebuilt 缺失的 Override / Default 条目（OpenXML 内容类型表）。
 * 只做标签级的「原包有、重建包没有」补回；XML 属性原文保留。
 */
function mergeXmlDefinitions(
  originalXml: string,
  rebuiltXml: string,
  tag: 'Override' | 'Default',
): string {
  const collect = (xml: string): Map<string, string> => {
    const found = new Map<string, string>();
    const pattern = new RegExp(`<${tag}\\b[^>]*(?:\\/>|><\\/${tag}>)`, 'g');
    for (const match of xml.matchAll(pattern)) {
      const attr =
        tag === 'Override'
          ? /PartName="([^"]*)"/.exec(match[0])?.[1]
          : /Extension="([^"]*)"/.exec(match[0])?.[1];
      if (attr) found.set(attr, match[0]);
    }
    return found;
  };
  const originalDefs = collect(originalXml);
  const rebuiltDefs = collect(rebuiltXml);
  const missing = [...originalDefs.entries()].filter(([key]) => !rebuiltDefs.has(key));
  if (missing.length === 0) return rebuiltXml;
  const inserted = missing.map(([, tagText]) => tagText).join('');
  const anchor = rebuiltXml.lastIndexOf('</Types>');
  if (anchor < 0) return rebuiltXml;
  return rebuiltXml.slice(0, anchor) + inserted + rebuiltXml.slice(anchor);
}

function mergeRelationships(originalXml: string, rebuiltXml: string): string {
  const collect = (xml: string): Map<string, string> => {
    const found = new Map<string, string>();
    for (const match of xml.matchAll(/<Relationship\b[^>]*(?:\/>|><\/Relationship>)/g)) {
      const id = /Id="([^"]*)"/.exec(match[0])?.[1];
      if (id) found.set(id, match[0]);
    }
    return found;
  };
  const originalRels = collect(originalXml);
  const rebuiltRels = collect(rebuiltXml);

  // 步骤 1：把原包中所有 Id 都纳入「保留候选」（无论 rebuilt 是否同名）。
  // 步骤 2：处理 Id 冲突。重建端通常会给 styles/sharedStrings/themes/worksheets 分配 rId1..rIdN；
  // 原包可能把这些 Id 复用于保留部件（vbaProject、charts、externalLinks 等）。
  // OpenXML 引用方写死的是原 Id，**绝对不能改名**——否则原部件的 Target 找不到。
  // 因此冲突时丢弃重建端的同 Id 关系项（保留原包关系，由原包指向原 Target）。
  // 实践上极少需要丢弃重建端关系（styles/sharedStrings/themes 都是模型生成的），
  // 但极端情况下（保留部件占用了 styles Id）必须保证 OpenXML 解析稳定。
  const conflictingRebuiltIds: string[] = [];
  for (const id of rebuiltRels.keys()) {
    if (originalRels.has(id)) conflictingRebuiltIds.push(id);
  }
  let mergedXml = rebuiltXml;
  if (conflictingRebuiltIds.length > 0) {
    const escaped = conflictingRebuiltIds.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const dropPattern = new RegExp(
      `<Relationship\\b[^>]*Id="${escaped.join('|')}"[^>]*(?:\\/>|><\\/Relationship>)`,
      'g',
    );
    mergedXml = mergedXml.replace(dropPattern, '');
  }

  // 步骤 3：原包所有 Id 都应出现在合并结果中。rebuilt 中存在的 Id 已被步骤 2 处理（冲突丢弃，
  // 非冲突保留）；原包中剩余 Id 直接追加到合并 rels 中（无论 rebuilt 是否同名——同名时已被步骤 2 丢弃）。
  const rebuiltIdsAfterDrop = new Set<string>();
  for (const match of mergedXml.matchAll(/<Relationship\b[^>]*(?:\/>|><\/Relationship>)/g)) {
    const id = /Id="([^"]*)"/.exec(match[0])?.[1];
    if (id) rebuiltIdsAfterDrop.add(id);
  }
  const toAdd: string[] = [];
  for (const [id, raw] of originalRels.entries()) {
    if (!rebuiltIdsAfterDrop.has(id)) toAdd.push(raw);
  }
  if (toAdd.length === 0) return mergedXml;
  const anchor = mergedXml.lastIndexOf('</Relationships>');
  if (anchor < 0) return mergedXml;
  return mergedXml.slice(0, anchor) + toAdd.join('') + mergedXml.slice(anchor);
}

/**
 * XLSX 只读保留区回填：
 * 1) 缺失的 zip entry（xl/vbaProject.bin、xl/charts/*、pivotCache/* 等）原样补回；
 * 2) [Content_Types].xml 补回对应 Override/Default；
 * 3) 关系文件（_rels/.rels、xl/_rels/workbook.xml.rels 等）补回原 Relationship。
 */
export async function preserveXlsxReadonly(originalBytes: Buffer, rebuiltBytes: Buffer): Promise<Buffer> {
  const original = await loadZip(originalBytes);
  const rebuilt = await loadZip(rebuiltBytes);
  await fillMissingEntries(original, rebuilt, isXlsxReadonlyPart);

  const contentTypes = rebuilt.file('[Content_Types].xml');
  const originalContentTypes = original.file('[Content_Types].xml');
  if (contentTypes && originalContentTypes) {
    const originalXml = await originalContentTypes.async('string');
    const rebuiltXml = await contentTypes.async('string');
    const merged = mergeXmlDefinitions(originalXml, rebuiltXml, 'Override');
    rebuilt.file('[Content_Types].xml', mergeXmlDefinitions(originalXml, merged, 'Default'));
  }

  for (const [name, file] of Object.entries(original.files)) {
    if (file.dir || !name.endsWith('.rels')) continue;
    const rebuiltRels = rebuilt.file(name);
    if (!rebuiltRels) continue; // fillMissingEntries 已经带回了整个关系文件
    const originalXml = await file.async('string');
    const rebuiltXml = await rebuiltRels.async('string');
    rebuilt.file(name, mergeRelationships(originalXml, rebuiltXml));
  }

  return rebuilt.generateAsync({ type: 'nodebuffer' });
}

/**
 * XMind 只读保留区回填：缺失 entry（resources/、content.xml 占位、theme 等）补回，
 * 并把原 manifest.json 的 file-entries 合并进重建 manifest（同名 key 以重建为准）。
 *
 * 此外，对 `content.json` 的第一个 sheet 做字段级合并：xmind sheet 可携带
 * boundaries / relationships / theme / skeleton 等多版本字段，simple-mind-map
 * 不实现这些字段的解析，必须原样回填以避免保存后丢失（ADR-0015 Decision 4）。
 * 编辑涉及的字段（id/class/title/rootTopic/children/summaries/extensions）以重建为准。
 */
export async function preserveXmindReadonly(originalBytes: Buffer, rebuiltBytes: Buffer): Promise<Buffer> {
  const original = await loadZip(originalBytes);
  const rebuilt = await loadZip(rebuiltBytes);
  await fillMissingEntries(original, rebuilt, isXmindReadonlyPart);

  const originalContent = original.file('content.json');
  const rebuiltContent = rebuilt.file('content.json');
  if (originalContent && rebuiltContent) {
    try {
      const originalJson = JSON.parse(await originalContent.async('string')) as unknown;
      const rebuiltJson = JSON.parse(await rebuiltContent.async('string')) as unknown;
      const merged = mergeXmindSheets(originalJson, rebuiltJson);
      rebuilt.file('content.json', JSON.stringify(merged));
    } catch {
      // content.json 损坏则保持重建结果，不因保留区合并而失败整个保存。
    }
  }

  const originalManifest = original.file('manifest.json');
  const rebuiltManifest = rebuilt.file('manifest.json');
  if (originalManifest && rebuiltManifest) {
    try {
      const originalJson = JSON.parse(await originalManifest.async('string')) as {
        'file-entries'?: Record<string, unknown>;
      };
      const rebuiltJson = JSON.parse(await rebuiltManifest.async('string')) as {
        'file-entries'?: Record<string, unknown>;
      };
      const mergedEntries = { ...(originalJson['file-entries'] ?? {}), ...(rebuiltJson['file-entries'] ?? {}) };
      rebuilt.file('manifest.json', JSON.stringify({ ...rebuiltJson, 'file-entries': mergedEntries }));
    } catch {
      // manifest 损坏则保持重建结果，不因保留区合并而失败整个保存。
    }
  }

  return rebuilt.generateAsync({ type: 'nodebuffer' });
}

/**
 * 保留原 sheet 中重建端不覆盖的字段（boundaries / relationships / theme / skeleton …）。
 * 编辑涉及的字段以 rebuilt 为准（id/title/rootTopic/children/summaries/class/extensions）。
 * 顶层数组长度以 rebuilt 为准，多余 sheet 直接丢弃（多 sheet 是 xmind 旧格式字段，
 * 重建端只生成单 sheet 模型）；保留内容从第一个 sheet 抓取。
 */
const REBUILT_SHEET_OWNED_KEYS = new Set([
  'id',
  'class',
  'title',
  'extensions',
  'topicPositioning',
  'topicOverlapping',
  'coreVersion',
  'rootTopic',
  'children',
  'summaries',
]);

function mergeXmindSheets(originalJson: unknown, rebuiltJson: unknown): unknown {
  if (!Array.isArray(originalJson) || !Array.isArray(rebuiltJson)) return rebuiltJson;
  const originalSheet = (originalJson[0] ?? {}) as Record<string, unknown>;
  const rebuiltSheet = (rebuiltJson[0] ?? {}) as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(originalSheet)) {
    if (!REBUILT_SHEET_OWNED_KEYS.has(key)) preserved[key] = value;
  }
  // rootTopic 内的 boundaries / relationships / skeleton / theme / extensions 等同样保留
  const originalRoot = (originalSheet.rootTopic ?? {}) as Record<string, unknown>;
  const rebuiltRoot = (rebuiltSheet.rootTopic ?? {}) as Record<string, unknown>;
  const preservedRootKeys = new Set(
    Object.keys(originalRoot).filter(
      (k) =>
        ![
          'id',
          'structureClass',
          'title',
          'notes',
          'href',
          'labels',
          'children',
          'summaries',
          'marker',
        ].includes(k),
    ),
  );
  const mergedRoot = { ...originalRoot, ...rebuiltRoot };
  // 把 preservedRootKeys 强制包含（rebuiltRoot 没有这些键时，原值必须保留）
  for (const key of preservedRootKeys) {
    if (!(key in mergedRoot) && key in originalRoot) {
      (mergedRoot as Record<string, unknown>)[key] = originalRoot[key];
    }
  }
  const mergedSheet = { ...preserved, ...rebuiltSheet, rootTopic: mergedRoot };
  const out = [...rebuiltJson];
  out[0] = mergedSheet;
  return out;
}