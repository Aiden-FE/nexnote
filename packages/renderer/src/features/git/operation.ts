export type SyncOperation = 'pull' | 'push';

/** Keep the pull payload explicit: its IPC contract is an object, not void. */
export async function invokeSyncOperation(
  operation: SyncOperation,
  request: { pull(): Promise<unknown>; push(): Promise<unknown> },
): Promise<void> {
  if (operation === 'pull') await request.pull();
  else await request.push();
}
