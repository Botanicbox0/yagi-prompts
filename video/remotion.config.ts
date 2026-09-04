import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// Point Remotion at an existing Chromium (CI containers, Playwright installs) instead of
// downloading Chrome Headless Shell. Unset locally: Remotion fetches its own on first render.
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
