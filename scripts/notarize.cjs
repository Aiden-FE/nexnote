/* eslint-env node */
/**
 * electron-builder afterSign hook. Runs only on macOS CI with all Apple secrets.
 * Required environment: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
 * Certificate material is supplied independently via CSC_LINK / CSC_KEY_PASSWORD.
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const mode = process.env.NEXNOTE_NOTARIZE_MODE ?? 'required';
  if (mode === 'disabled') {
    console.log('[notarize] disabled for non-publishable development/nightly artifact');
    return;
  }
  if (mode !== 'required') throw new Error(`[notarize] invalid NEXNOTE_NOTARIZE_MODE: ${mode}`);
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    throw new Error('[notarize] Apple credentials are required for every publishable macOS build');
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
