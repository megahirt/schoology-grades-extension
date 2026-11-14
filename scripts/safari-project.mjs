// safari-project.mjs — fix up the Xcode project that Apple's Safari packager
// generates (scripts/build-safari.mjs runs it after every conversion).
//
// The packager's output is not ready to ship (seen with Xcode 27.2):
//   - It names the APP's bundle ID after the app name
//     (net.hirtfamily.Grades-Dashboard-for-Schoology) instead of the one it
//     was given, while the extension gets <given ID>.Extension. The prefixes
//     then don't match and the ID is not the one registered with Apple.
//   - The version is always 1.0 (build 1), not the extension's.
//   - The app only runs on the macOS version of the Mac that built it.
//   - The app has no App Store category (required to upload).
//
// Works on both project file formats as text: project.pbxproj (`KEY = value;`)
// and Xcode 27's project.xcproj (`"KEY": "value",`).

export const MIN_MACOS = '12.0';
export const APP_CATEGORY = 'public.app-category.education';

// Replace every `KEY = value;` / `"KEY": "value",` with what change(old) returns.
function setAll(text, key, change) {
  const re = new RegExp(`("?${key}"?\\s*[:=]\\s*)("[^"\\n]*"|[^;,\\n]+)`, 'g');
  return text.replace(re, (whole, head, value) => {
    const old = value.replace(/^"|"$/g, '').trim();
    return `${head}"${change(old)}"`;
  });
}

// fixSafariProject(text, { bundleId, version, build }) -> text
//   bundleId: the app's bundle ID (the extension gets bundleId + '.Extension')
//   version:  X.Y.Z shown to users (CFBundleShortVersionString)
//   build:    build number (CFBundleVersion); new for every upload to Apple
export function fixSafariProject(text, { bundleId, version, build = '1' }) {
  let out = text;
  out = setAll(out, 'PRODUCT_BUNDLE_IDENTIFIER', (old) => (/\.Extension$/.test(old) ? `${bundleId}.Extension` : bundleId));
  out = setAll(out, 'MARKETING_VERSION', () => version);
  out = setAll(out, 'CURRENT_PROJECT_VERSION', () => String(build));
  out = setAll(out, 'MACOSX_DEPLOYMENT_TARGET', () => MIN_MACOS);
  if (!out.includes('INFOPLIST_KEY_LSApplicationCategoryType')) {
    // Next to each target's display name (an extra key on the extension is harmless).
    out = out.replace(
      /^([ \t]*)("?)INFOPLIST_KEY_CFBundleDisplayName"?(\s*[:=]\s*)[^\n]*$/gm,
      (line, indent, quote, sep) => {
        const end = sep.includes(':') ? ',' : ';';
        return `${line}\n${indent}${quote}INFOPLIST_KEY_LSApplicationCategoryType${quote}${sep}"${APP_CATEGORY}"${end}`;
      },
    );
  }
  return out;
}
