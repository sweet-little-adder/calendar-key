import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

export type CalendarEvent = {
	title: string;
	start: Date;
};

export type MonthEventsFetchResult = {
	events: CalendarEvent[];
	ok: boolean;
	denied: boolean;
};

const EVENTS_CACHE_TTL_MS = 5 * 60_000;
const FAILED_EVENTS_CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

const eventsCache = new Map<string, { result: MonthEventsFetchResult; fetchedAt: number }>();
const inFlightFetches = new Map<string, Promise<MonthEventsFetchResult>>();

function getPluginRoot(): string {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [cwd(), join(cwd(), ".."), moduleDir, join(moduleDir, "..")];

	for (const root of candidates) {
		if (existsSync(join(root, "manifest.json"))) {
			return root;
		}
	}

	return cwd();
}

function getFetchBinaryPath(): string {
	const root = getPluginRoot();
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(root, "bin", "CalendarFetch.app", "Contents", "MacOS", "calendar-fetch"),
		join(moduleDir, "CalendarFetch.app", "Contents", "MacOS", "calendar-fetch"),
		join(root, "bin", "fetch-calendar-events"),
		join(moduleDir, "fetch-calendar-events"),
	];

	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export async function fetchMonthEvents(year: number, month: number): Promise<CalendarEvent[]> {
	const result = await fetchMonthEventsResult(year, month);
	return result.events;
}

export function getCachedMonthEventsResult(year: number, month: number): MonthEventsFetchResult | undefined {
	const cacheKey = `${year}-${month}`;
	const cached = eventsCache.get(cacheKey);
	if (cached === undefined) {
		return undefined;
	}

	const ttl = cached.result.ok ? EVENTS_CACHE_TTL_MS : FAILED_EVENTS_CACHE_TTL_MS;
	if (Date.now() - cached.fetchedAt >= ttl) {
		return undefined;
	}

	return cached.result;
}

export async function fetchMonthEventsResult(year: number, month: number): Promise<MonthEventsFetchResult> {
	const cacheKey = `${year}-${month}`;
	const cached = eventsCache.get(cacheKey);
	if (cached !== undefined) {
		const ttl = cached.result.ok ? EVENTS_CACHE_TTL_MS : FAILED_EVENTS_CACHE_TTL_MS;
		if (Date.now() - cached.fetchedAt < ttl) {
			return cached.result;
		}
	}

	const inFlight = inFlightFetches.get(cacheKey);
	if (inFlight !== undefined) {
		return inFlight;
	}

	const fetchPromise = loadMonthEvents(year, month)
		.then((result) => {
			eventsCache.set(cacheKey, { result, fetchedAt: Date.now() });
			return result;
		})
		.finally(() => {
			inFlightFetches.delete(cacheKey);
		});

	inFlightFetches.set(cacheKey, fetchPromise);
	return fetchPromise;
}

async function loadMonthEvents(year: number, month: number): Promise<MonthEventsFetchResult> {
	if (process.platform !== "darwin") {
		return { ok: true, denied: false, events: [] };
	}

	const fetchEventsBinary = getFetchBinaryPath();
	if (!existsSync(fetchEventsBinary)) {
		logFetch(`calendar fetch binary missing at ${fetchEventsBinary}`);
		return { ok: false, denied: false, events: [] };
	}

	const { stdout, exitCode, timedOut, stderr } = await runFetchBinary(fetchEventsBinary, year, month);
	const denied = exitCode === 3 || stderr.includes("calendar access denied");

	if (timedOut) {
		logFetch(`calendar fetch timed out for ${year}-${month}`);
		return { ok: false, denied, events: [] };
	}

	if (exitCode !== 0) {
		logFetch(`calendar fetch failed (${exitCode}) for ${year}-${month}: ${stderr.trim()}`);
		return { ok: false, denied, events: [] };
	}

	const events = parseEvents(stdout);
	logFetch(`calendar fetch loaded ${events.length} events for ${year}-${month}`);
	return { ok: true, denied: false, events };
}

function parseEvents(stdout: string): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	for (const line of stdout.split(/\r?\n/)) {
		if (line.trim() === "") {
			continue;
		}

		const tabIndex = line.lastIndexOf("\t");
		if (tabIndex === -1) {
			continue;
		}

		const title = line.slice(0, tabIndex).trim();
		const dateParts = line.slice(tabIndex + 1).trim().split("-").map(Number);
		if (dateParts.length !== 3 || dateParts.some(Number.isNaN)) {
			continue;
		}

		const [year, month, day] = dateParts;
		events.push({
			title: title === "" ? "Untitled" : title,
			start: new Date(year, month - 1, day),
		});
	}

	events.sort((a, b) => a.start.getTime() - b.start.getTime());
	return events;
}

function runFetchBinary(
	fetchEventsBinary: string,
	year: number,
	month: number,
): Promise<{ stdout: string; exitCode: number | null; timedOut: boolean; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn(fetchEventsBinary, [String(year), String(month)]);
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, FETCH_TIMEOUT_MS);

		proc.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});

		proc.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		proc.on("close", (exitCode) => {
			clearTimeout(timer);
			resolve({ stdout, exitCode, timedOut, stderr });
		});

		proc.on("error", (error) => {
			clearTimeout(timer);
			logFetch(`calendar fetch spawn error: ${error.message}`);
			resolve({ stdout: "", exitCode: null, timedOut, stderr: error.message });
		});
	});
}

function logFetch(message: string): void {
	console.warn(`[calendar-events] ${message}`);
}
