import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const sdPlugin = "com.orionwong.calendar-keys.sdPlugin";
const source = path.join(root, "src/native/fetch-calendar-events.swift");
const appRoot = path.join(root, sdPlugin, "bin/CalendarFetch.app");
const macOsDir = path.join(appRoot, "Contents/MacOS");
const binary = path.join(macOsDir, "calendar-fetch");
const infoPlist = path.join(appRoot, "Contents/Info.plist");

if (process.platform !== "darwin") {
	console.log("Skipping EventKit helper build on non-macOS platform.");
	process.exit(0);
}

mkdirSync(macOsDir, { recursive: true });

const compile = spawnSync(
	"swiftc",
	["-O", "-framework", "EventKit", "-framework", "Foundation", "-o", binary, source],
	{ stdio: "inherit" },
);

if (compile.status !== 0) {
	process.exit(compile.status ?? 1);
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
	<key>LSBackgroundOnly</key>
	<true/>
	<key>NSCalendarsFullAccessUsageDescription</key>
	<string>Calendar Keys reads your Apple Calendar events to display them on Stream Deck keys.</string>
	<key>NSCalendarsUsageDescription</key>
	<string>Calendar Keys reads your Apple Calendar events to display them on Stream Deck keys.</string>
</dict>
</plist>
`,
);

const sign = spawnSync("codesign", ["-s", "-", "--force", "--deep", appRoot], { stdio: "inherit" });
if (sign.status !== 0) {
	process.exit(sign.status ?? 1);
}

const clearQuarantine = spawnSync("xattr", ["-cr", appRoot], { stdio: "inherit" });
if (clearQuarantine.status !== 0) {
	process.exit(clearQuarantine.status ?? 1);
}

console.log(`Built ${appRoot}`);
