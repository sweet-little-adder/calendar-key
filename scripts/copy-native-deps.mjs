import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdPlugin = join(root, "com.orionwong.calendar-keys.sdPlugin");
const targetModules = join(sdPlugin, "node_modules");

const packages = ["@resvg/resvg-js"];

function copyPackage(name) {
	const sourceDir = join(root, "node_modules", name);
	const targetDir = join(targetModules, name);

	if (!existsSync(sourceDir)) {
		throw new Error(`Missing dependency: ${name}`);
	}

	mkdirSync(dirname(targetDir), { recursive: true });
	rmSync(targetDir, { force: true, recursive: true });
	cpSync(sourceDir, targetDir, { recursive: true });
}

mkdirSync(targetModules, { recursive: true });

for (const pkg of packages) {
	copyPackage(pkg);
}

const resvgScope = join(root, "node_modules", "@resvg");
if (existsSync(resvgScope)) {
	for (const entry of readdirSync(resvgScope)) {
		if (entry.startsWith("resvg-js-")) {
			copyPackage(`@resvg/${entry}`);
		}
	}
}

const packageJson = {
	type: "module",
	dependencies: {
		"@resvg/resvg-js": JSON.parse(readFileSync(join(root, "node_modules/@resvg/resvg-js/package.json"), "utf8"))
			.version,
	},
};

writeFileSync(join(sdPlugin, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
console.log("Copied @resvg packages into .sdPlugin");
