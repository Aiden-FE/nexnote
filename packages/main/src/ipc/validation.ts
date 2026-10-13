import type { IpcChannel, ChannelRequest } from '@nexnote/shared';
import { isMindmapStructureId, PLUGIN_CRASH_ERROR_CODES, tCurrent } from '@nexnote/shared';
import { TARGET_LANGUAGE_PATTERN, TRANSLATION_MAX_TEXT_CHARS } from '../agent/translation';

/** Stable error returned when renderer-controlled IPC input does not match its contract. */
export interface ValidationError {
  code: 'IPC_PAYLOAD_INVALID';
  message: string;
}

/** Runtime validators run before an IPC handler sees renderer-controlled input. */
export type PayloadValidator = (payload: unknown) => ValidationError | null;

const invalid = (message: string): ValidationError => ({ code: 'IPC_PAYLOAD_INVALID', message });
const isPlainObject = (payload: unknown): payload is Record<string, unknown> =>
  !!payload && typeof payload === 'object' && !Array.isArray(payload);

const stringField =
  (key: string): PayloadValidator =>
  (payload) => {
    if (typeof (payload as Record<string, unknown>)[key] !== 'string') {
      return invalid(tCurrent('validation.error.FIELD_STRING', { key }));
    }
    return null;
  };

const booleanField =
  (key: string): PayloadValidator =>
  (payload) => {
    if (typeof (payload as Record<string, unknown>)[key] !== 'boolean') {
      return invalid(tCurrent('validation.error.FIELD_BOOLEAN', { key }));
    }
    return null;
  };

const finiteNumberField =
  (key: string): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return invalid(tCurrent('validation.error.FIELD_FINITE_NUMBER', { key }));
    }
    return null;
  };

const optionalField =
  (key: string, type: 'string' | 'number' | 'boolean'): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (value === undefined) return null;
    if (typeof value !== type)
      return invalid(tCurrent('validation.error.OPTIONAL_FIELD_TYPE', { key, type }));
    if (type === 'number' && !Number.isFinite(value))
      return invalid(tCurrent('validation.error.FIELD_FINITE_NUMBER', { key }));
    return null;
  };

const validateObject =
  (allowed: readonly string[], fields: PayloadValidator[]): PayloadValidator =>
  (payload) => {
    if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
    for (const key of Object.keys(payload)) {
      if (!allowed.includes(key))
        return invalid(tCurrent('validation.error.UNKNOWN_FIELD', { key }));
    }
    for (const validate of fields) {
      const error = validate(payload);
      if (error) return error;
    }
    return null;
  };

const object = (allowed: readonly string[], fields: PayloadValidator[]) =>
  validateObject(allowed, fields);
const pathOnly = object(['path'], [stringField('path')]);
const rename = object(['from', 'to'], [stringField('from'), stringField('to')]);
const write = object(
  ['path', 'content', 'createParentDirs'],
  [stringField('path'), stringField('content'), optionalField('createParentDirs', 'boolean')],
);
const mkdir = object(
  ['path', 'recursive'],
  [stringField('path'), optionalField('recursive', 'boolean')],
);
const remove = object(
  ['path', 'toTrash'],
  [stringField('path'), optionalField('toTrash', 'boolean')],
);
const createNote: PayloadValidator = (payload) => {
  const base = object(
    ['parentDir', 'name', 'content', 'format'],
    [
      stringField('parentDir'),
      optionalField('name', 'string'),
      optionalField('content', 'string'),
      optionalField('format', 'string'),
    ],
  )(payload);
  if (base) return base;
  const format = (payload as Record<string, unknown>).format;
  if (format !== undefined && format !== 'native-block' && format !== 'markdown') {
    return invalid(tCurrent('validation.error.FORMAT'));
  }
  return null;
};
const createTextFile = object(
  ['path', 'content', 'createParentDirs'],
  [stringField('path'), stringField('content'), optionalField('createParentDirs', 'boolean')],
);
const importBinaryFile = object(
  ['path', 'data', 'suggestionName', 'mime', 'createParentDirs', 'overwrite'],
  [
    stringField('path'),
    stringField('data'),
    optionalField('suggestionName', 'string'),
    optionalField('mime', 'string'),
    optionalField('createParentDirs', 'boolean'),
    optionalField('overwrite', 'boolean'),
  ],
);
const listTree = object(['showAllFiles'], [optionalField('showAllFiles', 'boolean')]);
const docxPath = object(['path'], [stringField('path')]);
const docxExport = object(
  ['path', 'targetPath'],
  [stringField('path'), optionalField('targetPath', 'string')],
);
const docxImport: PayloadValidator = (payload) => {
  const base = object(
    ['data', 'name', 'targetDir'],
    [
      optionalField('data', 'string'),
      optionalField('name', 'string'),
      optionalField('targetDir', 'string'),
    ],
  )(payload);
  const value = payload as Record<string, unknown>;
  if (base) return base;
  if (value.data === undefined) return null;
  if (typeof value.data !== 'string' || value.data.length === 0)
    return invalid(tCurrent('validation.error.DATA_REQUIRED'));
  if (
    value.data.length > 268_435_456 ||
    value.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    return invalid(tCurrent('validation.error.DATA_BASE64'));
  }
  return null;
};

const binaryKind = (value: unknown): value is 'xlsx' | 'mindmap' =>
  value === 'xlsx' || value === 'mindmap';
const binaryImport: PayloadValidator = (payload) => {
  const base = object(
    ['kind', 'data', 'name', 'targetDir'],
    [
      (p) =>
        binaryKind((p as Record<string, unknown>).kind)
          ? null
          : invalid(tCurrent('validation.error.BINARY_KIND')),
      optionalField('data', 'string'),
      optionalField('name', 'string'),
      optionalField('targetDir', 'string'),
    ],
  )(payload);
  if (base) return base;
  const value = payload as Record<string, unknown>;
  if (value.data === undefined) return null;
  if (typeof value.data !== 'string' || value.data.length === 0)
    return invalid(tCurrent('validation.error.DATA_REQUIRED'));
  if (
    value.data.length > 268_435_456 ||
    value.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    return invalid(tCurrent('validation.error.DATA_BASE64'));
  }
  return null;
};
const binaryRead: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (!binaryKind(payload.kind)) return invalid(tCurrent('validation.error.BINARY_KIND'));
  return stringField('path')(payload);
};
const binarySave: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (!binaryKind(payload.kind)) return invalid(tCurrent('validation.error.BINARY_KIND'));
  const pathCheck = stringField('path')(payload);
  if (pathCheck) return pathCheck;
  const shaCheck = stringField('expectedSha256')(payload);
  if (shaCheck) return shaCheck;
  return payload.data !== undefined && payload.data !== null
    ? null
    : invalid(tCurrent('validation.error.DATA_MISSING'));
};
const binaryGitignoreSet = object(['untrack'], [booleanField('untrack')]);
const binaryHostKind = (v: unknown): boolean => v === 'xlsx' || v === 'mindmap';
const binaryHostRef: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (!binaryHostKind(payload.kind)) return invalid(tCurrent('validation.error.BINARY_HOST_KIND'));
  return stringField('path')(payload);
};
const binaryHostSetActive: PayloadValidator = (payload) => {
  if (payload === null) return null;
  return binaryHostRef(payload);
};
const binaryHostSetBounds: PayloadValidator = (payload) => {
  const refCheck = binaryHostRef(payload);
  if (refCheck) return refCheck;
  const bounds = (payload as { bounds?: unknown }).bounds;
  if (bounds === null) return null;
  if (!isPlainObject(bounds)) return invalid(tCurrent('validation.error.BOUNDS_OBJECT'));
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = (bounds as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return invalid(
        tCurrent('validation.error.BOUNDS_FIELD_NONNEGATIVE', { key: `bounds.${key}` }),
      );
    }
  }
  return null;
};
const binaryEditorTheme = object(
  ['theme'],
  [
    (p) => {
      const theme = (p as Record<string, unknown>).theme;
      return theme === 'light' || theme === 'dark'
        ? null
        : invalid(tCurrent('validation.error.THEME'));
    },
  ],
);
const printDocument = object(['title', 'html'], [stringField('title'), stringField('html')]);
const binaryMindmapThemeSet = object(
  ['path', 'theme'],
  [stringField('path'), stringField('theme')],
);
// DEV-102：结构 id 走枚举白名单（不接受任意字符串，防止 path/structure 混淆注入）。
const isMindmapStructureIdField =
  (key: string): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    return isMindmapStructureId(value)
      ? null
      : invalid(tCurrent('validation.error.STRUCTURE_ID', { key }));
  };
const binaryMindmapStructureSet = object(
  ['path', 'structure'],
  [stringField('path'), isMindmapStructureIdField('structure')],
);

const stringArrayField =
  (key: string): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return invalid(tCurrent('validation.error.FIELD_STRING_ARRAY', { key }));
    }
    return null;
  };

const aiCredentialSubmit = object(
  ['secret', 'baseUrl'],
  [stringField('secret'), stringField('baseUrl')],
);
const aiProfileSave = object(
  ['id', 'profile'],
  [
    optionalField('id', 'string'),
    (p) =>
      isPlainObject((p as Record<string, unknown>).profile)
        ? null
        : invalid(tCurrent('validation.error.PROFILE_OBJECT')),
  ],
);
const idOnly = object(['id'], [stringField('id')]);
const aiFeaturesSet: PayloadValidator = (payload) => {
  const base = object(
    ['feature', 'assignment'],
    [
      stringField('feature'),
      (p) => {
        const assignment = (p as Record<string, unknown>).assignment;
        return assignment === null || isPlainObject(assignment)
          ? null
          : invalid(tCurrent('validation.error.ASSIGNMENT_OBJECT_OR_NULL'));
      },
    ],
  )(payload);
  if (base) return base;
  const feature = (payload as Record<string, unknown>).feature;
  return ['writing', 'translation', 'chat', 'embedding'].includes(String(feature))
    ? null
    : invalid(tCurrent('validation.error.FEATURE'));
};
const aiTranslationLanguage = object(
  ['targetLanguage'],
  [
    (payload) => {
      const value = (payload as Record<string, unknown>).targetLanguage;
      if (typeof value !== 'string') return invalid(tCurrent('validation.error.TARGET_LANGUAGE'));
      if (value === '' || TARGET_LANGUAGE_PATTERN.test(value)) return null;
      return invalid(tCurrent('validation.error.TARGET_LANGUAGE'));
    },
  ],
);
const _aiChatRequest = object(
  ['messages', 'profileId', 'feature', 'model', 'params'],
  [
    (p) => {
      const messages = (p as Record<string, unknown>).messages;
      return Array.isArray(messages) && messages.every(isPlainObject)
        ? null
        : invalid(tCurrent('validation.error.MESSAGES_OBJECT_ARRAY'));
    },
    optionalField('profileId', 'string'),
    optionalField('feature', 'string'),
    optionalField('model', 'string'),
    (p) => {
      const params = (p as Record<string, unknown>).params;
      return params === undefined || isPlainObject(params)
        ? null
        : invalid(tCurrent('validation.error.PARAMS_OBJECT'));
    },
  ],
);
const aiConnectionTarget: PayloadValidator = (payload) => {
  const error = object(
    ['profileId', 'candidate'],
    [
      optionalField('profileId', 'string'),
      (p) => {
        const candidate = (p as Record<string, unknown>).candidate;
        if (candidate === undefined) return null;
        if (!isPlainObject(candidate))
          return invalid(tCurrent('validation.error.CANDIDATE_OBJECT'));
        return object(
          ['kind', 'baseUrl', 'credentialToken', 'defaultModel'],
          [
            stringField('kind'),
            stringField('baseUrl'),
            optionalField('credentialToken', 'string'),
            optionalField('defaultModel', 'string'),
          ],
        )(candidate);
      },
    ],
  )(payload);
  if (error) return error;
  const target = payload as Record<string, unknown>;
  return target.profileId !== undefined || target.candidate !== undefined
    ? null
    : invalid(tCurrent('validation.error.PROFILE_OR_CANDIDATE_REQUIRED'));
};
const agentRun: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  const allowed = [
    'messages',
    'skillIds',
    'contextText',
    'params',
    'permissionMode',
    'contextPaths',
  ];
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    return invalid(tCurrent('validation.error.AGENT_UNKNOWN_FIELD'));
  const messages = payload.messages;
  if (
    !Array.isArray(messages) ||
    messages.some(
      (m) =>
        !isPlainObject(m) ||
        !['system', 'user', 'assistant'].includes(String(m.role)) ||
        typeof m.content !== 'string',
    )
  )
    return invalid(tCurrent('validation.error.MESSAGES_VALID_ARRAY'));
  if (
    payload.skillIds !== undefined &&
    (!Array.isArray(payload.skillIds) || payload.skillIds.some((id) => typeof id !== 'string'))
  )
    return invalid(tCurrent('validation.error.SKILL_IDS_STRING_ARRAY'));
  if (payload.contextText !== undefined && typeof payload.contextText !== 'string')
    return invalid(tCurrent('validation.error.CONTEXT_TEXT_STRING'));
  if (payload.params !== undefined && !isPlainObject(payload.params))
    return invalid(tCurrent('validation.error.PARAMS_OBJECT'));
  if (
    payload.permissionMode !== undefined &&
    !['conversation', 'edit', 'full'].includes(String(payload.permissionMode))
  )
    return invalid(tCurrent('validation.error.PERMISSION_MODE'));
  if (
    payload.contextPaths !== undefined &&
    (!Array.isArray(payload.contextPaths) ||
      payload.contextPaths.some((p) => typeof p !== 'string'))
  )
    return invalid(tCurrent('validation.error.CONTEXT_PATHS_STRING_ARRAY'));
  return null;
};

const agentWritingRun: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  const allowed = ['actionId', 'target', 'contextText', 'params'];
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    return invalid(tCurrent('validation.error.WRITING_UNKNOWN_FIELD'));
  if (
    !['rewrite', 'expand', 'condense', 'polish', 'fillgaps', 'evidence'].includes(
      String(payload.actionId),
    )
  )
    return invalid(tCurrent('validation.error.ACTION_ID'));
  if (payload.target !== undefined && typeof payload.target !== 'string')
    return invalid(tCurrent('validation.error.TARGET_STRING'));
  if (payload.contextText !== undefined && typeof payload.contextText !== 'string')
    return invalid(tCurrent('validation.error.CONTEXT_TEXT_STRING'));
  if (payload.params !== undefined && !isPlainObject(payload.params))
    return invalid(tCurrent('validation.error.PARAMS_OBJECT'));
  return null;
};

const agentTranslationRun: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  const allowed = ['translation', 'params'];
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    return invalid(tCurrent('validation.error.TRANSLATION_UNKNOWN_FIELD'));
  if (!isPlainObject(payload.translation))
    return invalid(tCurrent('validation.error.TRANSLATION_OBJECT'));
  const translation = payload.translation;
  const translationFields = ['mode', 'targetLanguage', 'text'];
  if (Object.keys(translation).some((key) => !translationFields.includes(key)))
    return invalid(tCurrent('validation.error.TRANSLATION_FIELDS_UNKNOWN'));
  if (
    translation.mode !== 'selection' &&
    translation.mode !== 'document' &&
    translation.mode !== 'input'
  )
    return invalid(tCurrent('validation.error.TRANSLATION_MODE'));
  if (
    typeof translation.targetLanguage !== 'string' ||
    !TARGET_LANGUAGE_PATTERN.test(translation.targetLanguage)
  )
    return invalid(tCurrent('validation.error.TRANSLATION_TARGET_LANGUAGE'));
  if (typeof translation.text !== 'string' || translation.text.trim().length === 0)
    return invalid(tCurrent('validation.error.TRANSLATION_TEXT_REQUIRED'));
  if (translation.text.length > TRANSLATION_MAX_TEXT_CHARS)
    return invalid(tCurrent('validation.error.TRANSLATION_TEXT_TOO_LONG'));
  if (payload.params !== undefined) {
    if (!isPlainObject(payload.params)) return invalid(tCurrent('validation.error.PARAMS_OBJECT'));
    // reasoning 由主进程固定关闭：渲染层连提交该字段都不允许。
    if ('reasoningEffort' in payload.params)
      return invalid(tCurrent('validation.error.TRANSLATION_REASONING_UNSUPPORTED'));
  }
  return null;
};

const agentCancel = object(['runId'], [stringField('runId')]);
const agentApproval = object(
  ['approvalId', 'decision'],
  [
    stringField('approvalId'),
    (p) =>
      (p as Record<string, unknown>).decision === 'approved' ||
      (p as Record<string, unknown>).decision === 'denied'
        ? null
        : invalid(tCurrent('validation.error.DECISION')),
  ],
);
const aiEmbed = object(['texts'], [stringArrayField('texts')]);
const aiImport = object(['json'], [stringField('json')]);

const timeline: PayloadValidator = (payload) => {
  const base = object(
    ['path', 'limit'],
    [optionalField('path', 'string'), optionalField('limit', 'number')],
  )(payload);
  if (base) return base;
  const limit = (payload as Record<string, unknown>).limit;
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500)
  ) {
    return invalid(tCurrent('validation.error.LIMIT'));
  }
  return null;
};
const recordAutoCommit = object(
  ['summary', 'debounceMs'],
  [optionalField('summary', 'string'), optionalField('debounceMs', 'number')],
);
const commit = object(['message'], [stringField('message')]);
const addRemote = object(['name', 'url'], [stringField('name'), stringField('url')]);
const restore = object(['path', 'commit'], [stringField('path'), stringField('commit')]);
const pull = object(['force'], [optionalField('force', 'boolean')]);
const useSystemGit = object(['enabled'], [booleanField('enabled')]);
const autoCommitDebounce = object(['milliseconds'], [finiteNumberField('milliseconds')]);
const doctorPrepare = object(['action'], [stringField('action')]);
const doctorExecute = object(['ticket'], [stringField('ticket')]);
const confidence = object(
  ['pageId'],
  [
    (payload) => {
      const pageId = (payload as Record<string, unknown>).pageId;
      return typeof pageId === 'number' && Number.isInteger(pageId) && pageId > 0
        ? null
        : invalid(tCurrent('validation.error.PAGE_ID_POSITIVE_INTEGER'));
    },
  ],
);
const confidenceFrontmatter = object(['enabled'], [booleanField('enabled')]);
const indexBacklinks = object(['pagePath'], [stringField('pagePath')]);
const indexQuery = object(
  ['query', 'limit'],
  [stringField('query'), optionalField('limit', 'number')],
);
const indexTags = object(['flat'], [optionalField('flat', 'boolean')]);
const indexTagPages = object(['tag'], [stringField('tag')]);
const vaultCreate = object(
  ['parentDir', 'name', 'initGit', 'operationId'],
  [
    stringField('parentDir'),
    stringField('name'),
    optionalField('initGit', 'boolean'),
    optionalField('operationId', 'string'),
  ],
);
const vaultOpen = object(
  ['path', 'initGit'],
  [stringField('path'), optionalField('initGit', 'boolean')],
);
const vaultClone = object(
  ['url', 'parentDir', 'preflightToken', 'name', 'operationId'],
  [
    stringField('url'),
    stringField('parentDir'),
    stringField('preflightToken'),
    optionalField('name', 'string'),
    optionalField('operationId', 'string'),
  ],
);
const vaultClonePreflight = object(
  ['url', 'parentDir', 'name'],
  [stringField('url'), stringField('parentDir'), optionalField('name', 'string')],
);
const vaultCancelOperation = object(['operationId'], [stringField('operationId')]);

// Settings validators（DEV-016）：浅校验（类型+结构），深度校验交给 merge 函数。
const settingsSetGlobal: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (typeof payload.patch !== 'object' || payload.patch === null || Array.isArray(payload.patch)) {
    return invalid(tCurrent('validation.error.PATCH_OBJECT'));
  }
  const allowedTop = ['appearance', 'updates', 'startup', 'git', 'network'];
  for (const key of Object.keys(payload.patch as Record<string, unknown>)) {
    if (!allowedTop.includes(key))
      return invalid(tCurrent('validation.error.PATCH_UNKNOWN_FIELD', { key }));
  }
  return null;
};

const settingsSetVault: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (typeof payload.patch !== 'object' || payload.patch === null || Array.isArray(payload.patch)) {
    return invalid(tCurrent('validation.error.PATCH_OBJECT'));
  }
  const allowedTop = ['editor', 'git', 'binary'];
  for (const key of Object.keys(payload.patch as Record<string, unknown>)) {
    if (!allowedTop.includes(key))
      return invalid(tCurrent('validation.error.PATCH_UNKNOWN_FIELD', { key }));
  }
  return null;
};

const settingsSetShortcuts: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (!Array.isArray(payload.shortcuts))
    return invalid(tCurrent('validation.error.SHORTCUTS_ARRAY'));
  for (const item of payload.shortcuts as unknown[]) {
    if (!isPlainObject(item)) return invalid(tCurrent('validation.error.SHORTCUTS_ITEM_OBJECT'));
    const entry = item as Record<string, unknown>;
    if (typeof entry.commandId !== 'string')
      return invalid(tCurrent('validation.error.SHORTCUTS_COMMAND_ID_STRING'));
    if (typeof entry.key !== 'string')
      return invalid(tCurrent('validation.error.SHORTCUTS_KEY_STRING'));
    if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') {
      return invalid(tCurrent('validation.error.SHORTCUTS_DISABLED_BOOLEAN'));
    }
  }
  return null;
};

const settingsImportShortcuts = object(['json'], [stringField('json')]);

const settingsSearch = object(['query'], [stringField('query')]);

const settingsSaveExportFile: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (typeof payload.suggestedName !== 'string')
    return invalid(tCurrent('validation.error.SUGGESTED_NAME_STRING'));
  if (typeof payload.contents !== 'string')
    return invalid(tCurrent('validation.error.CONTENTS_STRING'));
  return null;
};
const saveLayout: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  if (Object.keys(payload).some((key) => key !== 'layout'))
    return invalid(tCurrent('validation.error.UNKNOWN_FIELD_TOP'));
  if (!isPlainObject(payload.layout)) return invalid(tCurrent('validation.error.LAYOUT_OBJECT'));
  const layout = payload.layout;
  const fields: Record<string, 'number' | 'boolean' | 'nullable-string' | 'string-array'> = {
    sidebarWidth: 'number',
    sidebarCollapsed: 'boolean',
    activeSidebarPanelId: 'nullable-string',
    dockVisible: 'boolean',
    dockWidth: 'number',
    treeCollapsedDirs: 'string-array',
    treeShowAllFiles: 'boolean',
    treeShowExtensions: 'boolean',
    // 新手引导完成标记；旧配置缺省时读取侧按 false 兜底。
    guideCompleted: 'boolean',
    // DEV-022 页签顺序；旧配置缺省时读取侧按空数组兜底。
    tabOrder: 'string-array',
  };
  if (Object.keys(layout).some((key) => !(key in fields)))
    return invalid(tCurrent('validation.error.LAYOUT_UNKNOWN_FIELD'));
  for (const [key, type] of Object.entries(fields)) {
    const value = layout[key];
    // DEV-003 layouts may predate newer tree fields; missing fields are defaulted on read.
    if (value === undefined) continue;
    if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      return invalid(
        tCurrent('validation.error.LAYOUT_FIELD_FINITE_NUMBER', { key: `layout.${key}` }),
      );
    if (type === 'boolean' && typeof value !== 'boolean')
      return invalid(tCurrent('validation.error.LAYOUT_FIELD_BOOLEAN', { key: `layout.${key}` }));
    if (type === 'nullable-string' && value !== null && typeof value !== 'string')
      return invalid(
        tCurrent('validation.error.LAYOUT_FIELD_STRING_OR_NULL', { key: `layout.${key}` }),
      );
    if (
      type === 'string-array' &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    )
      return invalid(
        tCurrent('validation.error.LAYOUT_FIELD_STRING_ARRAY', { key: `layout.${key}` }),
      );
  }
  return null;
};

const chatNew = object(['title'], [optionalField('title', 'string')]);
const chatList = object(['query'], [optionalField('query', 'string')]);
const chatSave = object(
  ['session', 'status', 'error'],
  [
    (p) =>
      isPlainObject((p as Record<string, unknown>).session)
        ? null
        : invalid(tCurrent('validation.error.SESSION_OBJECT')),
    (p) => {
      const status = (p as Record<string, unknown>).status;
      if (status === undefined) return null;
      return status === 'complete' ||
        status === 'streaming' ||
        status === 'cancelled' ||
        status === 'failed'
        ? null
        : invalid(tCurrent('validation.error.STATUS_VALUE'));
    },
  ],
);
const chatSaveAsDoc = object(
  ['path', 'userAsQuote'],
  [stringField('path'), optionalField('userAsQuote', 'boolean')],
);

const pluginObjectChannels = [
  'plugins:pickSource',
  'plugins:installPreview',
  'plugins:confirmInstall',
  'plugins:uninstall',
  'plugins:setEnabled',
  'plugins:listAuditLog',
  'plugins:revokePermission',
  'plugins:runCommand',
  'plugins:beginSession',
  'plugins:closeSession',
  'plugins:getRuntimeSource',
  'plugins:reportCrash',
  'plugins:beginAuthChallenge',
  'plugins:rejectAuthChallenge',
  'plugins:grantPermission',
  'plugins:rpc',
] as const;
const pluginObject: PayloadValidator = (payload) =>
  isPlainObject(payload) ? null : invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));

const pluginCrashErrorCodes = [...Object.values(PLUGIN_CRASH_ERROR_CODES)] as const;

const pluginCrashReport: PayloadValidator = (payload) => {
  const objectCheck = pluginObject(payload);
  if (objectCheck) return objectCheck;
  const error = (payload as Record<string, unknown>).error;
  if (error === undefined) return null;
  if (!pluginCrashErrorCodes.includes(error as (typeof pluginCrashErrorCodes)[number]))
    return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  return null;
};

const skillsObjectChannels = [
  'skills:setEnabled',
  'skills:setOrder',
  'skills:setParams',
  'skills:retrieve',
] as const;

const updateChannel: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  const channel = (payload as Record<string, unknown>).channel;
  if (channel !== 'stable' && channel !== 'beta' && channel !== 'alpha')
    return invalid(tCurrent('validation.error.CHANNEL'));
  return null;
};

const updateSettingsPatch: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid(tCurrent('validation.error.PAYLOAD_OBJECT'));
  const allowed = ['channel', 'autoDownload', 'checkOnLaunch'] as const;
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key as (typeof allowed)[number]))
      return invalid(tCurrent('validation.error.UNKNOWN_FIELD', { key }));
  }
  const p = payload as Record<string, unknown>;
  if (
    p.channel !== undefined &&
    p.channel !== 'stable' &&
    p.channel !== 'beta' &&
    p.channel !== 'alpha'
  ) {
    return invalid(tCurrent('validation.error.CHANNEL'));
  }
  if (p.autoDownload !== undefined && typeof p.autoDownload !== 'boolean')
    return invalid(tCurrent('validation.error.AUTO_DOWNLOAD_BOOLEAN'));
  if (p.checkOnLaunch !== undefined && typeof p.checkOnLaunch !== 'boolean')
    return invalid(tCurrent('validation.error.CHECK_ON_LAUNCH_BOOLEAN'));
  return null;
};

const VALIDATORS: Partial<Record<IpcChannel, PayloadValidator>> = {
  'ai:credential:submit': aiCredentialSubmit,
  'ai:profile:save': aiProfileSave,
  'ai:profile:delete': idOnly,
  'ai:profile:setDefault': idOnly,
  'ai:features:set': aiFeaturesSet,
  'ai:translation:setTargetLanguage': aiTranslationLanguage,
  'ai:testConnection': aiConnectionTarget,
  'ai:listModels': aiConnectionTarget,
  'agent:run:chat': agentRun,
  'agent:run:writing': agentWritingRun,
  'agent:run:debug': agentRun,
  'agent:run:translation': agentTranslationRun,
  'agent:cancel': agentCancel,
  'agent:approval:respond': agentApproval,
  'ai:embed': aiEmbed,
  'ai:embedWithMetadata': aiEmbed,
  'ai:import': aiImport,
  'chat:list': chatList,
  'chat:get': pathOnly,
  'chat:new': chatNew,
  'chat:save': chatSave,
  'chat:saveAsDoc': chatSaveAsDoc,
  ...(Object.fromEntries(pluginObjectChannels.map((c) => [c, pluginObject])) as Partial<
    Record<IpcChannel, PayloadValidator>
  >),
  'plugins:reportCrash': pluginCrashReport,
  ...(Object.fromEntries(skillsObjectChannels.map((c) => [c, pluginObject])) as Partial<
    Record<IpcChannel, PayloadValidator>
  >),
  'fs:readTextFile': pathOnly,
  'fs:writeTextFile': write,
  'fs:createTextFile': createTextFile,
  'fs:importBinaryFile': importBinaryFile,
  'fs:exists': pathOnly,
  'fs:stat': pathOnly,
  'fs:listDir': pathOnly,
  'fs:mkdir': mkdir,
  'fs:rename': rename,
  'fs:delete': remove,
  'fs:createNote': createNote,
  'document:getMetadata': docxPath,
  'fs:listTree': listTree,
  'fs:renameLinked': rename,
  'fs:revealInFinder': pathOnly,
  'git:getTimeline': timeline,
  'git:recordAutoCommit': recordAutoCommit,
  'git:commit': commit,
  'git:addRemote': addRemote,
  'git:previewRestore': restore,
  'git:restoreFile': restore,
  'git:pull': pull,
  'git:setUseSystemGit': useSystemGit,
  'git:setAutoCommitDebounce': autoCommitDebounce,
  'git:doctor:repairPrepare': doctorPrepare,
  'git:doctor:repairExecute': doctorExecute,
  'git:sync': () => null,
  'git:configureAutoSync': () => null,
  'index:backlinks': indexBacklinks,
  'index:search': indexQuery,
  'index:jumpTo': indexQuery,
  'index:tags': indexTags,
  'index:tagPages': indexTagPages,
  'index:pageSummary': pathOnly,
  'index:confidence': confidence,
  'index:setConfidenceFrontmatter': confidenceFrontmatter,
  'vault:create': vaultCreate,
  'vault:open': vaultOpen,
  'vault:initGit': pathOnly,
  'vault:clone': vaultClone,
  'vault:inspect': pathOnly,
  'vault:clonePreflight': vaultClonePreflight,
  'vault:cancelOperation': vaultCancelOperation,
  'vault:removeRecent': pathOnly,
  'vault:reveal': pathOnly,
  'vault:saveLayout': saveLayout,
  // Settings（DEV-016）
  'settings:setGlobal': settingsSetGlobal,
  'settings:setVault': settingsSetVault,
  'settings:setShortcuts': settingsSetShortcuts,
  'settings:importShortcuts': settingsImportShortcuts,
  'settings:search': settingsSearch,
  'settings:saveExportFile': settingsSaveExportFile,
  'app:setUpdateChannel': updateChannel,
  'app:setUpdateSettings': updateSettingsPatch,
  // DOCX（DEV-098 撤销仓库内编辑后仅导入转块文档 / 导出）
  'docx:import': docxImport,
  'docx:export': docxExport,
  // binary（DEV-074，ADR-0015；DEV-098 撤销 docx 后仅 xlsx / xmind）
  'binary:import': binaryImport,
  'binary:create': ((payload) => {
    return object(
      ['kind', 'title', 'targetDir'],
      [
        (p) => {
          const k = (p as Record<string, unknown>).kind;
          return k === 'xlsx' || k === 'mindmap'
            ? null
            : invalid(tCurrent('validation.error.BINARY_KIND'));
        },
        optionalField('title', 'string'),
        optionalField('targetDir', 'string'),
      ],
    )(payload);
  }) satisfies PayloadValidator,
  'binary:read': binaryRead,
  'binary:save': binarySave,
  'binary:gitignore:set': binaryGitignoreSet,
  'binary:host:open': binaryHostRef,
  'binary:host:close': binaryHostRef,
  'binary:host:flush': binaryHostRef,
  'binary:host:ready': () => null,
  'binary:host:setActive': binaryHostSetActive,
  'binary:host:setBounds': binaryHostSetBounds,
  'binary:mindmapTheme:set': binaryMindmapThemeSet,
  'binary:mindmapStructure:set': binaryMindmapStructureSet,
  'binary:editorTheme': binaryEditorTheme,
  // print（块文档 / Markdown 文档；payload 由渲染层生成，只做结构校验）
  'print:document': printDocument,
  // 'binary:gitignore:get' 无 payload，走默认拒绝非空 payload
};

/** Reject malformed input with a stable code before executing the registered handler. */
export function validatePayload<C extends IpcChannel>(
  channel: C,
  payload: unknown,
): ValidationError | null {
  const validator = VALIDATORS[channel];
  if (validator) return validator(payload);
  if (payload !== undefined && payload !== null)
    return invalid(tCurrent('validation.error.CHANNEL_NO_PAYLOAD', { channel }));
  return null;
}

export function assertPayload<C extends IpcChannel>(
  channel: C,
  payload: unknown,
): asserts payload is ChannelRequest<C> {
  const error = validatePayload(channel, payload);
  if (error) throw Object.assign(new Error(`${channel}: ${error.message}`), { code: error.code });
}
