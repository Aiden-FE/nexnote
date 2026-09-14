export interface ArtifactNames {
  macArm64: { dmg: string; zip: string };
  macX64: { dmg: string; zip: string };
  windows: { nsis: string; portable: string };
  linux: { appImage: string; deb: string };
}

export interface ChannelManifestNames {
  mac: string;
  windows: string;
  linux: string;
}

export function channelManifestNames(channel: string): ChannelManifestNames;
export function expectedArtifactNames(version: string, productName?: string): ArtifactNames;
export function verifyArtifactContract(options: {
  releaseDir: string;
  channel: string;
  version: string;
  productName?: string;
}): { names: ArtifactNames; manifests: ChannelManifestNames };
