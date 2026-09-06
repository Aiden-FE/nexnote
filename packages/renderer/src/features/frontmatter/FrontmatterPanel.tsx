import { useMemo, useState } from 'react';
import { AlertCircle, Braces, ClipboardList, Code2 } from 'lucide-react';
import type { FrontmatterData } from '@nexnote/kernel';
import { parseFrontmatterYaml, serializeFrontmatterYaml } from '@nexnote/kernel';
import { Button } from '../../components/ui/button';
import { FieldEditor } from './FieldEditor';

export type FrontmatterMode = 'table' | 'yaml';

export interface FrontmatterPanelProps {
  data: FrontmatterData;
  source: string;
  knownTags: string[];
  onChange: (data: FrontmatterData) => void;
  onYamlChange: (source: string, data: FrontmatterData) => void;
}

/** 编辑器顶部的属性表格 / YAML 源码双模式面板。 */
export function FrontmatterPanel({ data, source, knownTags, onChange, onYamlChange }: FrontmatterPanelProps) {
  const [mode, setMode] = useState<FrontmatterMode>('table');
  const [yaml, setYaml] = useState(source);
  const [yamlError, setYamlError] = useState<string | null>(null);

  // 表格模式下 YAML 文本跟随外部 source 派生；源码模式下以本地编辑为准。
  const effectiveYaml = mode === 'table' ? source : yaml;

  const lineCount = useMemo(() => effectiveYaml.split('\n').length, [effectiveYaml]);

  const switchToYaml = () => {
    setYaml(serializeFrontmatterYaml(data));
    setYamlError(null);
    setMode('yaml');
  };

  const switchToTable = () => {
    try {
      const next = parseFrontmatterYaml(effectiveYaml);
      setYamlError(null);
      onYamlChange(yaml, next);
      setMode('table');
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : String(error));
      // 保持源码模式，不丢用户输入（验收关键）。
    }
  };

  const changeYaml = (next: string) => {
    setYaml(next);
    try {
      const nextData = parseFrontmatterYaml(next);
      setYamlError(null);
      onYamlChange(next, nextData);
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section data-testid="frontmatter-panel" className="mb-4 overflow-hidden rounded-lg border bg-card">
      <header className="flex min-h-9 items-center gap-1 border-b bg-muted/35 px-2">
        <ClipboardList className="ml-1 size-3.5 text-muted-foreground" />
        <span className="mr-auto text-xs font-medium">文档属性</span>
        <Button
          size="sm"
          variant={mode === 'table' ? 'secondary' : 'ghost'}
          onClick={() => {
            if (mode === 'yaml') switchToTable();
          }}
          title="属性表格"
        >
          <Braces className="size-3.5" /> 表格
        </Button>
        <Button
          size="sm"
          variant={mode === 'yaml' ? 'secondary' : 'ghost'}
          onClick={() => {
            if (mode === 'table') switchToYaml();
          }}
          title="YAML 源码"
        >
          <Code2 className="size-3.5" /> YAML
        </Button>
      </header>
      {mode === 'table' ? (
        <div className="p-2">
          <FieldEditor data={data} onChange={onChange} knownTags={knownTags} />
        </div>
      ) : (
        <div className="p-2">
          <textarea
            data-testid="frontmatter-yaml-editor"
            aria-label="Frontmatter YAML 源码"
            spellCheck={false}
            value={effectiveYaml}
            onChange={(event) => changeYaml(event.target.value)}
            className={`min-h-36 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-none focus:ring-1 focus:ring-ring ${
              yamlError ? 'border-destructive text-destructive' : 'border-input'
            }`}
          />
          <div className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
            {yamlError ? <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" /> : null}
            <span className={yamlError ? 'text-destructive' : ''}>
              {yamlError ?? `${lineCount} 行 · 语法有效，切回表格会保留当前数据`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
