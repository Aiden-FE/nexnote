export interface AppSaveDetail {
  waitUntil(save: Promise<unknown>): void;
}

export const APP_SAVE_EVENT = 'nexnote:save';

/** Register one mounted editor's persistence flush with the app-wide save request. */
export function registerAppSaveListener(
  target: EventTarget,
  flush: () => Promise<void>,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<AppSaveDetail>).detail;
    detail?.waitUntil(Promise.resolve().then(flush));
  };
  target.addEventListener(APP_SAVE_EVENT, listener);
  return () => target.removeEventListener(APP_SAVE_EVENT, listener);
}

/** Ask all mounted editors to flush and resolve only after every persistence write settles. */
export async function requestAppSave(target: EventTarget): Promise<void> {
  const saves: Promise<unknown>[] = [];
  target.dispatchEvent(
    new CustomEvent<AppSaveDetail>(APP_SAVE_EVENT, {
      detail: { waitUntil: (save) => saves.push(save) },
    }),
  );
  await Promise.all(saves);
}
