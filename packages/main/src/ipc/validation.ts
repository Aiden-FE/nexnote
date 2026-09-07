import type { IpcChannel, ChannelRequest } from '@nexnote/shared';

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
      return invalid(`${key} 必须是字符串`);
    }
    return null;
  };

const booleanField =
  (key: string): PayloadValidator =>
  (payload) => {
    if (typeof (payload as Record<string, unknown>)[key] !== 'boolean') {
      return invalid(`${key} 必须是布尔值`);
    }
    return null;
  };

const finiteNumberField =
  (key: string): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return invalid(`${key} 必须是有限数字`);
    }
    return null;
  };

const optionalField =
  (key: string, type: 'string' | 'number' | 'boolean'): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (value === undefined) return null;
    if (typeof value !== type) return invalid(`${key} 必须为可选 ${type}`);
    if (type === 'number' && !Number.isFinite(value)) return invalid(`${key} 必须为有限数字`);
    return null;
  };

const validateObject =
  (allowed: readonly string[], fields: PayloadValidator[]): PayloadValidator =>
  (payload) => {
    if (!isPlainObject(payload)) return invalid('payload 必须是普通对象');
    for (const key of Object.keys(payload)) {
      if (!allowed.includes(key)) return invalid(`未知字段 ${key}`);
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
const createNote = object(
  ['parentDir', 'name', 'content'],
  [stringField('parentDir'), optionalField('name', 'string'), optionalField('content', 'string')],
);
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

const stringArrayField =
  (key: string): PayloadValidator =>
  (payload) => {
    const value = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return invalid(`${key} 必须是字符串数组`);
    }
    return null;
  };

const aiCredentialSubmit = object(
  ['secret', 'baseUrl'],
  [stringField('secret'), stringField('baseUrl')],
);
const aiProfileSave = object(
  ['id', 'profile'],
  [optionalField('id', 'string'), (p) => (isPlainObject((p as Record<string, unknown>).profile) ? null : invalid('profile 必须是对象'))],
);
const idOnly = object(['id'], [stringField('id')]);
const aiFeaturesSet = object(
  ['feature', 'assignment'],
  [
    stringField('feature'),
    (p) => {
      const assignment = (p as Record<string, unknown>).assignment;
      return assignment === null || isPlainObject(assignment) ? null : invalid('assignment 必须是对象或 null');
    },
  ],
);
const aiChatRequest = object(
  ['messages', 'profileId', 'feature', 'model', 'params'],
  [
    (p) => {
      const messages = (p as Record<string, unknown>).messages;
      return Array.isArray(messages) && messages.every(isPlainObject) ? null : invalid('messages 必须是消息对象数组');
    },
    optionalField('profileId', 'string'),
    optionalField('feature', 'string'),
    optionalField('model', 'string'),
    (p) => {
      const params = (p as Record<string, unknown>).params;
      return params === undefined || isPlainObject(params) ? null : invalid('params 必须是对象');
    },
  ],
);
const aiConnectionTarget: PayloadValidator = (payload) => {
  const error = object(
    ['profileId', 'candidate'],
    [optionalField('profileId', 'string'), (p) => {
      const candidate = (p as Record<string, unknown>).candidate;
      if (candidate === undefined) return null;
      if (!isPlainObject(candidate)) return invalid('candidate 必须是对象');
      return object(
        ['kind', 'baseUrl', 'credentialToken', 'defaultModel'],
        [stringField('kind'), stringField('baseUrl'), optionalField('credentialToken', 'string'), optionalField('defaultModel', 'string')],
      )(candidate);
    }],
  )(payload);
  if (error) return error;
  const target = payload as Record<string, unknown>;
  return target.profileId !== undefined || target.candidate !== undefined ? null : invalid('必须提供 profileId 或 candidate');
};
const streamIdOnly = object(['streamId'], [stringField('streamId')]);
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
    return invalid('limit 必须是 1 到 500 的整数');
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
const confidence = object(['pageId'], [
  (payload) => {
    const pageId = (payload as Record<string, unknown>).pageId;
    return typeof pageId === 'number' && Number.isInteger(pageId) && pageId > 0
      ? null
      : invalid('pageId 必须是正整数');
  },
]);
const confidenceFrontmatter = object(['enabled'], [booleanField('enabled')]);
const indexBacklinks = object(['pagePath'], [stringField('pagePath')]);
const indexQuery = object(
  ['query', 'limit'],
  [stringField('query'), optionalField('limit', 'number')],
);
const indexTags = object(['flat'], [optionalField('flat', 'boolean')]);
const indexTagPages = object(['tag'], [stringField('tag')]);
const vaultCreate = object(['parentDir', 'name'], [stringField('parentDir'), stringField('name')]);
const vaultClone = object(
  ['url', 'parentDir', 'name'],
  [stringField('url'), stringField('parentDir'), optionalField('name', 'string')],
);
const saveLayout: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) return invalid('payload 必须是普通对象');
  if (Object.keys(payload).some((key) => key !== 'layout')) return invalid('未知字段');
  if (!isPlainObject(payload.layout)) return invalid('layout 必须是对象');
  const layout = payload.layout;
  const fields: Record<string, 'number' | 'boolean' | 'nullable-string' | 'string-array'> = {
    sidebarWidth: 'number',
    sidebarCollapsed: 'boolean',
    activeSidebarPanelId: 'nullable-string',
    dockVisible: 'boolean',
    dockWidth: 'number',
    splitEnabled: 'boolean',
    splitRatio: 'number',
    treeCollapsedDirs: 'string-array',
    treeShowAllFiles: 'boolean',
  };
  if (Object.keys(layout).some((key) => !(key in fields))) return invalid('layout 包含未知字段');
  for (const [key, type] of Object.entries(fields)) {
    const value = layout[key];
    // DEV-003 layouts may predate newer tree fields; missing fields are defaulted on read.
    if (value === undefined) continue;
    if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      return invalid(`layout.${key} 必须是有限数字`);
    if (type === 'boolean' && typeof value !== 'boolean')
      return invalid(`layout.${key} 必须是布尔值`);
    if (type === 'nullable-string' && value !== null && typeof value !== 'string')
      return invalid(`layout.${key} 必须是字符串或 null`);
    if (
      type === 'string-array' &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    )
      return invalid(`layout.${key} 必须是字符串数组`);
  }
  return null;
};

const chatNew = object(['title'], [optionalField('title', 'string')]);
const chatSave = object(['session'], [
  (p) => (isPlainObject((p as Record<string, unknown>).session) ? null : invalid('session 必须是对象')),
]);
const chatSaveAsDoc = object(
  ['path', 'userAsQuote'],
  [stringField('path'), optionalField('userAsQuote', 'boolean')],
);
const chatFolderSet = object(['folder'], [stringField('folder')]);

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
  isPlainObject(payload) ? null : invalid('payload 必须是对象');

const skillsObjectChannels = [
  'skills:setEnabled',
  'skills:setOrder',
  'skills:setParams',
  'skills:retrieve',
] as const;

const VALIDATORS: Partial<Record<IpcChannel, PayloadValidator>> = {
  'ai:credential:submit': aiCredentialSubmit,
  'ai:profile:save': aiProfileSave,
  'ai:profile:delete': idOnly,
  'ai:profile:setDefault': idOnly,
  'ai:features:set': aiFeaturesSet,
  'ai:testConnection': aiConnectionTarget,
  'ai:listModels': aiConnectionTarget,
  'ai:chat:complete': aiChatRequest,
  'ai:chat:stream:start': aiChatRequest,
  'ai:chat:stream:cancel': streamIdOnly,
  'ai:embed': aiEmbed,
  'ai:embedWithMetadata': aiEmbed,
  'ai:import': aiImport,
  'chat:get': pathOnly,
  'chat:new': chatNew,
  'chat:save': chatSave,
  'chat:saveAsDoc': chatSaveAsDoc,
  'chat:folder:set': chatFolderSet,
  ...Object.fromEntries(pluginObjectChannels.map((c) => [c, pluginObject])) as Partial<
    Record<IpcChannel, PayloadValidator>
  >,
  ...Object.fromEntries(skillsObjectChannels.map((c) => [c, pluginObject])) as Partial<
    Record<IpcChannel, PayloadValidator>
  >,
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
  'index:backlinks': indexBacklinks,
  'index:search': indexQuery,
  'index:jumpTo': indexQuery,
  'index:tags': indexTags,
  'index:tagPages': indexTagPages,
  'index:pageSummary': pathOnly,
  'index:confidence': confidence,
  'index:setConfidenceFrontmatter': confidenceFrontmatter,
  'vault:create': vaultCreate,
  'vault:open': pathOnly,
  'vault:initGit': pathOnly,
  'vault:clone': vaultClone,
  'vault:removeRecent': pathOnly,
  'vault:reveal': pathOnly,
  'vault:saveLayout': saveLayout,
};

/** Reject malformed input with a stable code before executing the registered handler. */
export function validatePayload<C extends IpcChannel>(
  channel: C,
  payload: unknown,
): ValidationError | null {
  const validator = VALIDATORS[channel];
  if (validator) return validator(payload);
  if (payload !== undefined && payload !== null) return invalid(`${channel} 不接受 payload`);
  return null;
}

export function assertPayload<C extends IpcChannel>(
  channel: C,
  payload: unknown,
): asserts payload is ChannelRequest<C> {
  const error = validatePayload(channel, payload);
  if (error) throw Object.assign(new Error(`${channel}: ${error.message}`), { code: error.code });
}
