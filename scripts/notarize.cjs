/* eslint-env node */
/**
 * electron-builder afterSign hook. Runs only on macOS CI with all Apple secrets.
 * Required environment: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
 * Certificate material is supplied independently via CSC_LINK / CSC_KEY_PASSWORD.
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials absent; skipping notarization (non-release build)');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] submitting ${appName}.app to Apple notary service`);
  await notarize({
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
