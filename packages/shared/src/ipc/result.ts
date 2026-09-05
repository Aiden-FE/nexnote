/** 统一 IPC 结果信封：主进程所有 handler 的返回值都是 Result<T>。 */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });

export const err = (error: string, code?: string): Err => ({ ok: false, error, code });

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(result.error);
}
