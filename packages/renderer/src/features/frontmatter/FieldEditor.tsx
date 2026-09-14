import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { FrontmatterData, FrontmatterValue, StandardFieldDef } from '@nexnote/kernel';
import {
  assertSafeFrontmatterKey,
  fieldTypeOf,
  isStandardField,
  STANDARD_FIELD_CATALOG,
} from '@nexnote/kernel';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';

export interface FieldEditorProps {
  data: FrontmatterData;
  onChange: (next: FrontmatterData) => void;
  knownTags: string[];
  onRename: (from: string, to: string) => void;
}

type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'list' | 'null';

const STANDARD_ORDER = STANDARD_FIELD_CATALOG.map((field) => field.key);
const STANDARD_DESCRIPTIONS = new Map(STANDARD_FIELD_CATALOG.map((f) => [f.key, f.description]));

/** 标准字段按预定义类型给出的初始值（日期取当前时间）。 */
function defaultValueForStandardField(field: StandardFieldDef): FrontmatterValue {
  switch (field.type) {
    case 'list':
      return [];
    case 'date':
      return new Date();
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}

function sortedKeys(data: FrontmatterData): string[] {
  const standard = STANDARD_ORDER.filter((k) => Object.prototype.hasOwnProperty.call(data, k));
  const custom = Object.keys(data)
    .filter((k) => !STANDARD_ORDER.includes(k))
    .sort((a, b) => a.localeCompare(b));
  return [...standard, ...custom];
}

export function FieldEditor({ data, onChange, knownTags, onRename }: FieldEditorProps) {
  const [draftKey, setDraftKey] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const catalogRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => sortedKeys(data), [data]);

  // 点击目录外关闭浮层
  useEffect(() => {
    if (!showCatalog) return;
    const onPointerDown = (event: PointerEvent) => {
      if (catalogRef.current && !catalogRef.current.contains(event.target as Node)) {
        setShowCatalog(false);
        setShowCustom(false);
        setDraftKey('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showCatalog]);

  const update = (key: string, value: FrontmatterValue) => {
    onChange({ ...data, [key]: value });
  };

  const remove = (key: string) => {
    if (isStandardField(key)) return;
    const next = { ...data };
    delete next[key];
    onChange(next);
  };

  const rename = (key: string, to: string) => {
    const next = to.trim();
    if (!next || next === key) return;
    if (isStandardField(key) || isStandardField(next)) return;
    if (Object.prototype.hasOwnProperty.call(data, next)) return;
    onRename?.(key, next);
  };

  const closeCatalog = () => {
    setShowCatalog(false);
    setShowCustom(false);
    setDraftKey('');
  };

  const addStandardField = (field: StandardFieldDef) => {
    if (Object.prototype.hasOwnProperty.call(data, field.key)) return;
    update(field.key, defaultValueForStandardField(field));
    closeCatalog();
  };

  const addCustomField = () => {
    let name: string;
    try {
      name = assertSafeFrontmatterKey(draftKey);
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(data, name)) {
      closeCatalog();
      return;
    }
    update(name, '');
    closeCatalog();
  };

  return (
    <div data-testid="frontmatter-field-editor" className="space-y-2">
      {keys.map((key) => (
        <FieldRow
          key={key}
          name={key}
          value={data[key] ?? null}
          onChange={(v) => update(key, v)}
          onRemove={() => remove(key)}
          onRename={(to) => rename(key, to)}
          knownTags={knownTags}
        />
      ))}
      {showCatalog ? (
        <div
          ref={catalogRef}
          data-testid="field-catalog"
          className="rounded-md border bg-popover p-2 text-xs shadow-md"
        >
          <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">字段目录</div>
          <ul className="max-h-64 space-y-0.5 overflow-auto">
            {STANDARD_FIELD_CATALOG.map((field) => {
              const added = Object.prototype.hasOwnProperty.call(data, field.key);
              return (
                <li key={field.key}>
                  <button
                    type="button"
                    data-testid="field-catalog-item"
                    data-field={field.key}
                    disabled={added}
                    title={field.description}
                    onClick={() => addStandardField(field)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                      added ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent',
                    )}
                  >
                    <span className="font-medium text-foreground">{field.key}</span>
                    <TypeBadge type={field.type} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {field.description}
                    </span>
                    {added && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        已添加
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t pt-1.5">
            {showCustom ? (
              <div className="flex items-center gap-2 px-1 pb-1">
                <Input
                  autoFocus
                  data-testid="field-catalog-custom-input"
                  value={draftKey}
                  placeholder="自定义字段名（如 category）"
                  onChange={(e) => setDraftKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomField();
                    if (e.key === 'Escape') closeCatalog();
                  }}
                />
                <Button size="sm" variant="secondary" onClick={addCustomField}>
                  添加
                </Button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="field-catalog-custom"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-accent"
                onClick={() => setShowCustom(true)}
              >
                <Plus className="size-3.5" /> 自定义字段…
              </button>
            )}
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          data-testid="add-field-trigger"
          onClick={() => setShowCatalog(true)}
        >
          <Plus className="size-3.5" /> 添加字段
        </Button>
      )}
    </div>
  );
}

interface FieldRowProps {
  name: string;
  value: FrontmatterValue;
  onChange: (v: FrontmatterValue) => void;
  onRemove: () => void;
  onRename: (to: string) => void;
  knownTags: string[];
}

function FieldRow({ name, value, onChange, onRemove, onRename, knownTags }: FieldRowProps) {
  const standard = isStandardField(name);
  const [editingKey, setEditingKey] = useState(false);
  const [draft, setDraft] = useState(name);
  const [collapsed, setCollapsed] = useState(false);
  const type = fieldTypeOf(value);

  const toggle = () => setCollapsed((c) => !c);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      data-testid={`frontmatter-field-${name}`}
      className={cn(
        'rounded-md border bg-card text-card-foreground',
        standard && 'border-border/80',
      )}
    >
      <div className="flex h-8 items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggle}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          aria-label={collapsed ? '展开' : '折叠'}
        >
          <Chevron className="size-3.5" />
        </button>
        {editingKey && !standard ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(draft);
              setEditingKey(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(draft);
                setEditingKey(false);
              }
              if (e.key === 'Escape') {
                setDraft(name);
                setEditingKey(false);
              }
            }}
            className="h-6 flex-1 text-xs"
          />
        ) : (
          <span
            className={cn(
              'flex-1 truncate text-xs font-medium',
              standard ? 'text-foreground' : 'text-foreground/80 cursor-text',
            )}
            onDoubleClick={() => {
              if (!standard) {
                setDraft(name);
                setEditingKey(true);
              }
            }}
            title={standard ? (STANDARD_DESCRIPTIONS.get(name) ?? '标准字段') : '双击重命名'}
          >
            {name}
            {standard && <span className="ml-1 text-[10px] text-muted-foreground">标准</span>}
          </span>
        )}
        <TypeBadge type={type} />
        <button
          type="button"
          onClick={onRemove}
          disabled={standard}
          className={cn(
            'rounded p-1 text-muted-foreground',
            standard
              ? 'cursor-not-allowed opacity-40'
              : 'hover:bg-destructive/10 hover:text-destructive',
          )}
          aria-label="删除字段"
          title={standard ? '标准字段不可删除' : '删除字段'}
        >
          {standard ? <MoreHorizontal className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </button>
      </div>
      {!collapsed && (
        <div className="border-t px-2 py-2">
          <ValueEditor name={name} value={value} onChange={onChange} knownTags={knownTags} />
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: FieldType }) {
  const label: Record<FieldType, string> = {
    string: '文本',
    number: '数字',
    boolean: '布尔',
    date: '日期',
    list: '列表',
    null: '空',
  };
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {label[type]}
    </span>
  );
}

function ValueEditor({
  name,
  value,
  onChange,
  knownTags,
}: {
  name: string;
  value: FrontmatterValue;
  onChange: (v: FrontmatterValue) => void;
  knownTags: string[];
}) {
  if (value === null) {
    return (
      <div className="text-xs text-muted-foreground">
        值为空。
        <div className="mt-2 flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => onChange('')}>
            设为文本
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(0)}>
            设为数字
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(false)}>
            设为布尔
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange([])}>
            设为列表
          </Button>
        </div>
      </div>
    );
  }

  if (Array.isArray(value)) {
    const isTags = name === 'tags';
    return (
      <ListEditor
        values={value}
        onChange={onChange}
        autocomplete={isTags ? knownTags : []}
        label={isTags ? '标签' : '列表项'}
      />
    );
  }

  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="size-3.5"
        />
        {value ? '开启' : '关闭'}
      </label>
    );
  }

  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    );
  }

  if (value instanceof Date) {
    const iso = value.toISOString();
    const hasTime = !iso.endsWith('T00:00:00.000Z');
    const inputValue = hasTime ? iso.slice(0, 16) : iso.slice(0, 10);
    return (
      <input
        type={hasTime ? 'datetime-local' : 'date'}
        value={inputValue}
        onChange={(e) => {
          // datetime-local 按 UTC 语义回写，保留已有时间分量；纯 date 仍为日期类型。
          const d = new Date(hasTime ? `${e.target.value}:00Z` : `${e.target.value}T00:00:00Z`);
          if (!Number.isNaN(d.getTime())) onChange(d);
        }}
        className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
      />
    );
  }

  // string
  return (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${name} 的值`} />
  );
}

function ListEditor({
  values,
  onChange,
  autocomplete,
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  autocomplete: string[];
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const candidates = autocomplete.filter(
    (t) => !values.includes(t) && t.toLowerCase().includes(draft.toLowerCase()),
  );

  const addItem = (item?: string) => {
    const v = (item ?? draft).trim();
    if (!v || values.includes(v)) {
      setDraft('');
      setShowSuggest(false);
      return;
    }
    onChange([...values, v]);
    setDraft('');
    setShowSuggest(false);
  };

  const removeItem = (idx: number) => {
    const next = [...values];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {values.length === 0 && <span className="text-xs text-muted-foreground">暂无 {label}</span>}
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          >
            {v}
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="rounded-full text-muted-foreground hover:text-destructive"
              aria-label={`移除 ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="flex gap-1">
          <Input
            value={draft}
            placeholder={`新增${label}…`}
            onChange={(e) => {
              setDraft(e.target.value);
              setShowSuggest(e.target.value.length > 0);
            }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
              if (e.key === 'Backspace' && draft === '' && values.length > 0) {
                removeItem(values.length - 1);
              }
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => addItem()}>
            添加
          </Button>
        </div>
        {showSuggest && candidates.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-md border bg-popover p-1 text-xs shadow">
            {candidates.slice(0, 8).map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addItem(c);
                  }}
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
