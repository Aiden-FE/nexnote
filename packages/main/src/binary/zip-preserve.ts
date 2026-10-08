import path from 'node:path';
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

/** docProps 时间戳属于「每次写盘都会变」的噪声，比较包内容时归一化掉。 */
const VOLATILE_XLSX_PARTS = new Set(['docProps/core.xml']);

function normalizeVolatilePart(name: string, data: Buffer): string {
  const text = data.toString('utf8');
  if (!VOLATILE_XLSX_PARTS.has(name)) return text;
  return text.replace(
    /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
    '$1$2',
  );
}

/**
 * 两个 xlsx 包在「忽略 docProps 时间戳」后是否等价。
 * 用于跳过无内容变化的写盘：exceljs 每次重建都会刷新时间戳，若照写就会在 Git
 * 工作区留下无意义的 diff（历史缺陷之一）。逐条目比较而非比字节，避免 zip
 * 压缩参数/条目顺序造成的假差异。
 */
export async function xlsxPackagesEquivalent(a: Buffer, b: Buffer): Promise<boolean> {
  const [zipA, zipB] = await Promise.all([loadZip(a), loadZip(b)]);
  const namesA = [...entryNames(zipA)].sort();
  const namesB = [...entryNames(zipB)].sort();
  if (namesA.length !== namesB.length) return false;
  for (let i = 0; i < namesA.length; i += 1) {
    if (namesA[i] !== namesB[i]) return false;
  }
  for (const name of namesA) {
    const [dataA, dataB] = await Promise.all([
      zipA.file(name)?.async('nodebuffer'),
      zipB.file(name)?.async('nodebuffer'),
    ]);
    if (!dataA || !dataB) return false;
    if (normalizeVolatilePart(name, dataA) !== normalizeVolatilePart(name, dataB)) return false;
  }
  return true;
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
    /^xl\/(?:charts|drawings|pivotCache|pivotTables|slicers|slicerCaches|externalLinks|embeddings)\//i.test(
      name,
    )
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

interface RelationshipEntry {
  id: string;
  raw: string;
  /** Target 属性；缺失时为 null。 */
  target: string | null;
  /** TargetMode="External" 的目标是外部 URI，不要求包内存在。 */
  external: boolean;
}

function parseRelationships(xml: string): RelationshipEntry[] {
  const entries: RelationshipEntry[] = [];
  for (const match of xml.matchAll(/<Relationship\b[^>]*(?:\/>|><\/Relationship>)/g)) {
    const raw = match[0];
    const id = /Id="([^"]*)"/.exec(raw)?.[1];
    if (!id) continue;
    entries.push({
      id,
      raw,
      target: /Target="([^"]*)"/.exec(raw)?.[1] ?? null,
      external: /TargetMode="External"/.test(raw),
    });
  }
  return entries;
}

/** `xl/_rels/workbook.xml.rels` → `xl/workbook.xml`；包根 `_rels/.rels` 没有 owner part。 */
function relationshipOwnerPart(relsPath: string): string | null {
  const marker = '_rels/';
  const index = relsPath.lastIndexOf(marker);
  if (index < 0) return null;
  const fileName = relsPath.slice(index + marker.length);
  if (!fileName.endsWith('.rels')) return null;
  const owner = fileName.slice(0, -'.rels'.length);
  if (!owner) return null;
  return `${relsPath.slice(0, index)}${owner}`;
}

/** 把 Relationship 的 Target 解析成包内 part 路径（相对包根）。 */
function resolveRelationshipTarget(relsPath: string, target: string): string {
  const index = relsPath.lastIndexOf('_rels/');
  const dir = index < 0 ? '' : relsPath.slice(0, index);
  return path.posix.normalize(`${dir}${target}`);
}

function nextRelationshipId(used: Set<string>): number {
  let max = 0;
  for (const id of used) {
    const match = /^rId(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/**
 * 合并关系文件：以重建包为基座，把原包中仍然有效的 Relationship 补回。
 *
 * 历史缺陷：原实现用 `Id="rId1|rId2|rId3"` 这种拼接正则「丢弃重建端同 Id 项」，
 * 该正则既不能正确表达候选集合，也会从第一个 Relationship 之外开始吞字符——一旦
 * 真的出现 Id 冲突（例如原包缺少 sharedStrings，重建端却带上了它），产物 rels 就是
 * 损坏的 XML，整份工作簿随即无法解析（保存即报废）。
 *
 * 现在的策略：
 * 1. 重建端的关系**永不删除**；与保留部件 Id 冲突时分配一个空闲 Id，并同步改写
 *    owner part（workbook.xml / sheetN.xml …）中的 r:id / r:embed / r:link 引用；
 * 2. 原包关系只在「目标部件确实存在于合并结果」且「重建端未指向同一部件」时补回，
 *    避免悬空关系与重复条目。
 */
function mergeRelationships(input: {
  relsPath: string;
  originalXml: string;
  rebuiltXml: string;
  ownerXml: string | null;
  partExists: (part: string) => boolean;
}): { relsXml: string; ownerXml: string | null } {
  const closing = '</Relationships>';
  if (!input.rebuiltXml.includes(closing)) {
    return { relsXml: input.rebuiltXml, ownerXml: input.ownerXml };
  }
  const originalRels = parseRelationships(input.originalXml);
  const rebuiltRels = parseRelationships(input.rebuiltXml);
  const rebuiltTargets = new Set(
    rebuiltRels
      .map((entry) => entry.target)
      .filter((target): target is string => target !== null)
      .map((target) => resolveRelationshipTarget(input.relsPath, target)),
  );
  // 先判定哪些原包关系真要保留，再决定是否给重建端改号。顺序反过来就不是幂等变换：
  // 第一次保存会让「其实是重复条目」的原包 Id 也逼重建端改号，第二次保存又因 Id
  // 空间不同产出另一份语义等价、逐字节不同的 rels（工作区因此反复变脏）。
  const keptOriginal: RelationshipEntry[] = [];
  for (const entry of originalRels) {
    if (entry.external || entry.target === null) {
      keptOriginal.push(entry);
      continue;
    }
    const target = resolveRelationshipTarget(input.relsPath, entry.target);
    if (rebuiltTargets.has(target)) continue;
    if (!input.partExists(target)) continue;
    keptOriginal.push(entry);
  }

  const keptOriginalIds = new Set(keptOriginal.map((entry) => entry.id));
  const usedIds = new Set<string>(keptOriginalIds);
  for (const entry of rebuiltRels) usedIds.add(entry.id);
  let nextId = nextRelationshipId(usedIds);

  const renamed = new Map<string, string>();
  const rebuiltEntries: string[] = [];
  for (const entry of rebuiltRels) {
    if (!keptOriginalIds.has(entry.id)) {
      rebuiltEntries.push(entry.raw);
      continue;
    }
    const replacement = `rId${nextId}`;
    nextId += 1;
    renamed.set(entry.id, replacement);
    rebuiltEntries.push(entry.raw.replace(`Id="${entry.id}"`, `Id="${replacement}"`));
  }

  const firstEntry = input.rebuiltXml.search(/<Relationship\b/);
  const head =
    firstEntry >= 0
      ? input.rebuiltXml.slice(0, firstEntry)
      : input.rebuiltXml.slice(0, input.rebuiltXml.lastIndexOf(closing));
  const relsXml = `${head}${[...rebuiltEntries, ...keptOriginal.map((entry) => entry.raw)].join('')}${closing}`;

  let ownerXml = input.ownerXml;
  if (ownerXml !== null && renamed.size > 0) {
    ownerXml = ownerXml.replace(
      /(\sr:(?:id|embed|link)=")([^"]*)(")/g,
      (match, prefix: string, id: string, suffix: string) => {
        const replacement = renamed.get(id);
        return replacement ? `${prefix}${replacement}${suffix}` : match;
      },
    );
  }
  return { relsXml, ownerXml };
}

/**
 * XLSX 只读保留区回填：
 * 1) 缺失的 zip entry（xl/vbaProject.bin、xl/charts/*、pivotCache/* 等）原样补回；
 * 2) [Content_Types].xml 补回对应 Override/Default；
 * 3) 关系文件（_rels/.rels、xl/_rels/workbook.xml.rels 等）补回原 Relationship。
 */
export async function preserveXlsxReadonly(
  originalBytes: Buffer,
  rebuiltBytes: Buffer,
): Promise<Buffer> {
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
    const ownerPart = relationshipOwnerPart(name);
    const ownerFile = ownerPart ? rebuilt.file(ownerPart) : null;
    const merged = mergeRelationships({
      relsPath: name,
      originalXml,
      rebuiltXml,
      ownerXml: ownerFile ? await ownerFile.async('string') : null,
      // 回填已在上方完成：这里用重建包的实际内容判断原包关系是否仍指向存在的部件。
      partExists: (part) => rebuilt.file(part) !== null,
    });
    rebuilt.file(name, merged.relsXml);
    if (ownerPart && ownerFile && merged.ownerXml !== null) {
      rebuilt.file(ownerPart, merged.ownerXml);
    }
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
export async function preserveXmindReadonly(
  originalBytes: Buffer,
  rebuiltBytes: Buffer,
): Promise<Buffer> {
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
      const mergedEntries = {
        ...(originalJson['file-entries'] ?? {}),
        ...(rebuiltJson['file-entries'] ?? {}),
      };
      rebuilt.file(
        'manifest.json',
        JSON.stringify({ ...rebuiltJson, 'file-entries': mergedEntries }),
      );
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
