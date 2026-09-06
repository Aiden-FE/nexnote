export function parseImmutableEvidenceUrl(raw: string): { url: URL; evidenceCommit: string };
export function fetchEvidence(rawUrl: string): Promise<{ body: Buffer; evidenceCommit: string }>;
export function create(output: string): Promise<void>;
export function validate(data: unknown): void;
export function validateAttestation(attestation: unknown, want: unknown, evidenceCommit: string): void;
