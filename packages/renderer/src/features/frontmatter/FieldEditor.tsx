import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { FrontmatterData, FrontmatterValue, StandardFieldDef } from '@nexnote/kernel';
import {
  assertSafeFrontmatterKey,
  fieldTypeOf,
  formatDisplayDateTime,
  isStandardField,
  isReadonlyStandardField,
  STANDARD_FIELD_CATALOG,
} from '@nexnote/kernel';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { t, useI18n } from '../../lib/i18n';

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
  const tr = useI18n();
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
    // DEV-079: 标准字段与自定义字段删除行为一致——不再按 isStandardField 早返。
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
          <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
            {tr('frontmatter.fieldCatalog')}
          </div>
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
                    title={t(`frontmatter.field.${field.key}.description`)}
                    onClick={() => addStandardField(field)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                      added ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent',
                    )}
                  >
                    <span className="font-medium text-foreground">{field.key}</span>
                    <TypeBadge type={field.type} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {t(`frontmatter.field.${field.key}.description`)}
                    </span>
                    {added && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {tr('frontmatter.added')}
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
                  placeholder={tr('frontmatter.customFieldName')}
                  onChange={(e) => setDraftKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomField();
                    if (e.key === 'Escape') closeCatalog();
                  }}
                />
                <Button size="sm" variant="secondary" onClick={addCustomField}>
                  {tr('frontmatter.add')}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="field-catalog-custom"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-accent"
                onClick={() => setShowCustom(true)}
              >
                <Plus className="size-3.5" /> {tr('frontmatter.customField')}
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
          <Plus className="size-3.5" /> {tr('frontmatter.addField')}
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
  const tr = useI18n();
  const standard = isStandardField(name);
  // DEV-077: readonly 标准字段（updated）由应用维护，禁用输入与类型切换。
  const readonly = isReadonlyStandardField(name);
  const [editingKey, setEditingKey] = useState(false);
  const [draft, setDraft] = useState(name);
  const [collapsed, setCollapsed] = useState(false);
  // DEV-079: 标准字段删除前需要轻量确认（自定义字段直接删除）。
  const [confirmRemove, setConfirmRemove] = useState(false);
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
          aria-label={collapsed ? tr('frontmatter.expand') : tr('frontmatter.collapse')}
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
            title={
              STANDARD_DESCRIPTIONS.has(name)
                ? t(`frontmatter.field.${name}.description`)
                : tr('frontmatter.standardField')
            }
          >
            {name}
            {standard && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {tr('frontmatter.standardBadge')}
              </span>
            )}
          </span>
        )}
        <TypeBadge type={type} />
        {confirmRemove ? (
          <span
            data-testid={`field-remove-confirm-${name}`}
            className="flex shrink-0 items-center gap-1 text-[10px]"
          >
            <span className="text-muted-foreground">
              {tr('frontmatter.removeConfirm', { name })}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onRemove();
                setConfirmRemove(false);
              }}
            >
              {tr('frontmatter.delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              {tr('frontmatter.cancel')}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (standard) setConfirmRemove(true);
              else onRemove();
            }}
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            )}
            aria-label={tr('frontmatter.removeField')}
            title={
              standard
                ? tr('frontmatter.removeStandardField')
                : tr('frontmatter.removeField')
            }
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="border-t px-2 py-2">
          {readonly ? (
            <div data-testid={`frontmatter-readonly-${name}`} className="text-xs text-muted-foreground">
              <span className="font-mono">{readonlyDisplayValue(value)}</span>
              <span className="ml-2">{tr('frontmatter.managedByApp')}</span>
            </div>
          ) : (
            <ValueEditor name={name} value={value} onChange={onChange} knownTags={knownTags} />
          )}
        </div>
      )}
    </div>
  );
}

/** DEV-077：只读字段展示值。DEV-078：Date 走本地时区可读格式。 */
function readonlyDisplayValue(value: FrontmatterValue): string {
  if (value instanceof Date) return formatDisplayDateTime(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null) return '—';
  return String(value);
}

function TypeBadge({ type }: { type: FieldType }) {
  const key: Record<FieldType, string> = {
    string: 'frontmatter.type.string',
    number: 'frontmatter.type.number',
    boolean: 'frontmatter.type.boolean',
    date: 'frontmatter.type.date',
    list: 'frontmatter.type.list',
    null: 'frontmatter.type.null',
  };
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {t(key[type])}
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
  const tr = useI18n();
  if (value === null) {
    return (
      <div className="text-xs text-muted-foreground">
        {tr('frontmatter.emptyValue')}
        <div className="mt-2 flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => onChange('')}>
            {tr('frontmatter.setString')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(0)}>
            {tr('frontmatter.setNumber')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange(false)}>
            {tr('frontmatter.setBoolean')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange([])}>
            {tr('frontmatter.setList')}
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
        label={isTags ? tr('frontmatter.tagsItem') : tr('frontmatter.listItem')}
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
        {value ? tr('frontmatter.on') : tr('frontmatter.off')}
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
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={tr('frontmatter.valuePlaceholder', { name })}
    />
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
  const tr = useI18n();
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
        {values.length === 0 && (
          <span className="text-xs text-muted-foreground">
            {tr('frontmatter.noItems', { label })}
          </span>
        )}
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
              aria-label={tr('frontmatter.removeItem', { value: v })}
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
            placeholder={tr('frontmatter.newItem', { label })}
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
            {tr('frontmatter.add')}
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
