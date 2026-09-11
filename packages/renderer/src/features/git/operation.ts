export type SyncOperation = 'pull' | 'push';
export type DoctorRecoveryDecision = 'confirm' | 'deny' | 'ignore';

/** Deterministic recovery transition: errors propagate so the UI can retain its ticket. */
export async function resolveDoctorRecovery(
  decision: DoctorRecoveryDecision,
  operations: { execute(): Promise<void>; dismiss(): Promise<void> },
): Promise<void> {
  if (decision === 'confirm') return operations.execute();
  return operations.dismiss();
}

/** Keep the pull payload explicit: its IPC contract is an object, not void. */
export async function invokeSyncOperation(
  operation: SyncOperation,
  request: { pull(): Promise<unknown>; push(): Promise<unknown> },
): Promise<void> {
  if (operation === 'pull') await request.pull();
  else await request.push();
}
