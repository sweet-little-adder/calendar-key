import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const sdPlugin = "com.orionwong.calendar-keys.sdPlugin";
const source = path.join(root, "src/native/fetch-calendar-events.swift");
const disclaimSource = path.join(root, "src/native/disclaim-spawn.c");
const appRoot = path.join(root, sdPlugin, "bin/CalendarFetch.app");
const macOsDir = path.join(appRoot, "Contents/MacOS");
const binary = path.join(macOsDir, "calendar-fetch");
const disclaimBinary = path.join(root, sdPlugin, "bin/disclaim-spawn");
const infoPlist = path.join(appRoot, "Contents/Info.plist");
const entitlementsPath = path.join(appRoot, "Contents/entitlements.plist");

if (process.platform !== "darwin") {
	console.log("Skipping EventKit helper build on non-macOS platform.");
	process.exit(0);
}

mkdirSync(macOsDir, { recursive: true });
mkdirSync(path.dirname(disclaimBinary), { recursive: true });

const compile = spawnSync(
	"swiftc",
	[
		"-O",
		"-framework",
		"AppKit",
		"-framework",
		"EventKit",
		"-framework",
		"Foundation",
		"-o",
		binary,
		source,
	],
	{ stdio: "inherit" },
);

if (compile.status !== 0) {
	process.exit(compile.status ?? 1);
}

const compileDisclaim = spawnSync("cc", ["-O2", "-o", disclaimBinary, disclaimSource], { stdio: "inherit" });
if (compileDisclaim.status !== 0) {
	process.exit(compileDisclaim.status ?? 1);
}

writeFileSync(
	infoPlist,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>calendar-fetch</string>
	<key>CFBundleIdentifier</key>
	<string>com.orionwong.calendar-keys.fetch</string>
	<key>CFBundleName</key>
	<string>CalendarFetch</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSCalendarsFullAccessUsageDescription</key>
	<string>Calendar Keys reads your Apple Calendar events to display them on Stream Deck keys.</string>
	<key>NSCalendarsUsageDescription</key>
	<string>Calendar Keys reads your Apple Calendar events to display them on Stream Deck keys.</string>
</dict>
</plist>
`,
);

writeFileSync(
	entitlementsPath,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.personal-information.calendars</key>
	<true/>
</dict>
</plist>
`,
);

const sign = spawnSync(
	"codesign",
	["-s", "-", "--force", "--deep", "--entitlements", entitlementsPath, appRoot],
	{ stdio: "inherit" },
);
if (sign.status !== 0) {
	process.exit(sign.status ?? 1);
}

const signDisclaim = spawnSync("codesign", ["-s", "-", "--force", disclaimBinary], { stdio: "inherit" });
if (signDisclaim.status !== 0) {
	process.exit(signDisclaim.status ?? 1);
}

const clearQuarantine = spawnSync("xattr", ["-cr", appRoot, disclaimBinary], { stdio: "inherit" });
if (clearQuarantine.status !== 0) {
	process.exit(clearQuarantine.status ?? 1);
}

console.log(`Built ${appRoot}`);
console.log(`Built ${disclaimBinary}`);
