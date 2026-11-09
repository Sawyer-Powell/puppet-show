import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

const executable = (file) => {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
};
const locate = (name) => isAbsolute(name) ? (executable(name) ? name : null)
  : (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, name)).find(executable);

/** Installed Chrome/Chromium; never downloads a browser. CHROME takes priority. */
export function findChrome() {
  if (process.env.CHROME) {
    const found = locate(process.env.CHROME);
    if (found) return found;
    throw new Error("CHROME does not point to an executable browser; set CHROME to the full Chrome/Chromium executable path");
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome", "/snap/bin/chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  ];
  for (const candidate of candidates) {
    const found = locate(candidate);
    if (found) return found;
  }
  throw new Error("Chrome/Chromium not found; install a browser or set CHROME to its executable path");
}
