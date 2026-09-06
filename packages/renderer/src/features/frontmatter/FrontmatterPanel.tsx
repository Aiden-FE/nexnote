import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Braces, ClipboardList, Code2, LockKeyhole } from 'lucide-react';
import type { FrontmatterData } from '@nexnote/kernel';
import { parseFrontmatterYaml, serializeFrontmatterYaml } from '@nexnote/kernel';
import { renameFrontmatterKey } from './frontmatter-utils';
import { Button } from '../../components/ui/button';
import { FieldEditor } from './FieldEditor';
import { tokenizeYaml, type YamlTokenKind } from './frontmatter-utils';

export type FrontmatterMode = 'table' | 'yaml';

export interface FrontmatterPanelProps {
  data: FrontmatterData;
  source: string;
  knownTags: string[];
  /** 初始 YAML 不可解析时强制源码模式，避免空 data 覆盖原文。 */
  locked?: boolean;
  parseError?: string | null;
  onChange: (data: FrontmatterData) => void;
  onYamlChange: (source: string, data: FrontmatterData) => void;
}

const TOKEN_CLASS: Record<YamlTokenKind, string> = {
  plain: 'text-foreground',
  key: 'font-semibold text-sky-700 dark:text-sky-300',
  punctuation: 'text-muted-foreground',
  comment: 'italic text-muted-foreground',
  string: 'text-emerald-700 dark:text-emerald-300',
  atom: 'text-amber-700 dark:text-amber-300',
};

/** 编辑器顶部的属性表格 / YAML 源码双模式面板。 */
export function FrontmatterPanel({
  data,
  source,
  knownTags,
  locked = false,
  parseError = null,
  onChange,
  onYamlChange,
}: FrontmatterPanelProps) {
  const [mode, setMode] = useState<FrontmatterMode>(locked ? 'yaml' : 'table');
  const [yaml, setYaml] = useState(source);
  const [yamlError, setYamlError] = useState<string | null>(parseError);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const activeMode: FrontmatterMode = locked ? 'yaml' : mode;

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // 表格模式下 YAML 文本跟随外部 source；源码模式下保留用户正在编辑的文本。
  const effectiveYaml = activeMode === 'table' ? source : yaml;
  const lineCount = useMemo(() => effectiveYaml.split('\n').length, [effectiveYaml]);
  const highlighted = useMemo(() => tokenizeYaml(effectiveYaml), [effectiveYaml]);
  const activeError = yamlError ?? (locked ? parseError : null);

  const switchToYaml = () => {
    setYaml(serializeFrontmatterYaml(data));
    setYamlError(null);
    setMode('yaml');
  };

  const switchToTable = () => {
    if (locked) return;
    try {
      const next = parseFrontmatterYaml(effectiveYaml);
      setYamlError(null);
      onYamlChange(effectiveYaml, next);
      setMode('table');
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : String(error));
      // 保持源码模式，不丢用户输入。
    }
  };

  /**
   * 输入立即更新高亮和校验，结构化写回防抖 300ms。
   * 不可解析时绝不调用 onYamlChange，保证原始 YAML 不被空对象覆盖。
   */
  const changeYaml = (next: string) => {
    setYaml(next);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      const nextData = parseFrontmatterYaml(next);
      setYamlError(null);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        onYamlChange(next, nextData);
      }, 300);
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section
      data-testid="frontmatter-panel"
      className="mb-4 overflow-hidden rounded-lg border bg-card"
    >
      <header className="flex min-h-9 items-center gap-1 border-b bg-muted/35 px-2">
        <ClipboardList className="ml-1 size-3.5 text-muted-foreground" />
        <span className="mr-auto text-xs font-medium">文档属性</span>
        {locked && (
          <span
            className="mr-1 inline-flex items-center gap-1 text-[10px] text-destructive"
            title="修复 YAML 后可切回表格"
          >
            <LockKeyhole className="size-3" /> 源码锁定
          </span>
        )}
        <Button
          size="sm"
          variant={activeMode === 'table' ? 'secondary' : 'ghost'}
          disabled={locked}
          onClick={() => {
            if (activeMode === 'yaml') switchToTable();
          }}
          title={locked ? 'YAML 无法解析，修复后才能切换表格' : '属性表格'}
        >
          <Braces className="size-3.5" /> 表格
        </Button>
        <Button
          size="sm"
          variant={activeMode === 'yaml' ? 'secondary' : 'ghost'}
          onClick={() => {
            if (activeMode === 'table') switchToYaml();
          }}
          title="YAML 源码"
        >
          <Code2 className="size-3.5" /> YAML
        </Button>
      </header>
      {activeMode === 'table' ? (
        <div className="p-2">
          <FieldEditor
            data={data}
            onChange={onChange}
            knownTags={knownTags}
            onRename={(from, to) => onChange(renameFrontmatterKey(data, from, to))}
          />
        </div>
      ) : (
        <div className="p-2">
          <div className="relative min-h-36 overflow-hidden rounded-md border border-input bg-background font-mono text-xs leading-5 focus-within:ring-1 focus-within:ring-ring">
            <pre
              ref={highlightRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-2"
            >
              {highlighted.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={TOKEN_CLASS[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                  {lineIndex < highlighted.length - 1 ? '\n' : null}
                </span>
              ))}
            </pre>
            <textarea
              data-testid="frontmatter-yaml-editor"
              aria-label="Frontmatter YAML 源码"
              spellCheck={false}
              wrap="off"
              value={effectiveYaml}
              onScroll={(event) => {
                if (!highlightRef.current) return;
                highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
              }}
              onChange={(event) => changeYaml(event.target.value)}
              className="relative block min-h-36 w-full resize-y overflow-auto border-0 bg-transparent p-2 font-mono text-xs leading-5 text-transparent caret-foreground outline-none selection:bg-editor-selection"
            />
          </div>
          <div className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
            {activeError ? (
              <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
            ) : null}
            <span className={activeError ? 'text-destructive' : ''}>
              {activeError ?? `${lineCount} 行 · 语法有效，300ms 后保存；切回表格会保留当前数据`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
