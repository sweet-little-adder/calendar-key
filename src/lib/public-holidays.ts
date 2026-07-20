import { readFileSync, existsSync } from "node:fs";
import { cwd } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PublicHoliday = {
	date: string;
	name: string;
	localName: string;
};

export type YearHolidaysFetchResult = {
	holidays: PublicHoliday[];
	ok: boolean;
};

const HOLIDAYS_CACHE_TTL_MS = 24 * 60 * 60_000;
const FAILED_HOLIDAYS_CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const NAGER_API_BASE = "https://date.nager.at/api/v3";

const holidaysCache = new Map<string, { result: YearHolidaysFetchResult; fetchedAt: number }>();
const inFlightFetches = new Map<string, Promise<YearHolidaysFetchResult>>();

const TIMEZONE_COUNTRY: Record<string, string> = {
	"Asia/Hong_Kong": "HK",
	"Asia/Macau": "MO",
	"Asia/Taipei": "TW",
	"Asia/Singapore": "SG",
	"Asia/Tokyo": "JP",
	"Asia/Seoul": "KR",
	"Asia/Shanghai": "CN",
	"Europe/London": "GB",
	"Australia/Sydney": "AU",
	"America/Toronto": "CA",
	"America/New_York": "US",
	"America/Los_Angeles": "US",
	"America/Chicago": "US",
};

/** Infer ISO country code from timezone and locale (Stream Deck often reports en-US even in HK). */
export function detectSystemCountryCode(): string {
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const fromTimeZone = TIMEZONE_COUNTRY[timeZone];
	if (fromTimeZone !== undefined) {
		return fromTimeZone;
	}

	const locale = Intl.DateTimeFormat().resolvedOptions().locale;
	const match = locale.match(/[-_]([A-Za-z]{2})$/);
	if (match !== null) {
		return match[1].toUpperCase();
	}

	return "HK";
}

export function resolveCountryCode(setting: string | undefined): string {
	if (setting === undefined || setting === "" || setting === "auto") {
		return detectSystemCountryCode();
	}

	const normalized = setting.trim().toUpperCase();
	if (/^[A-Z]{2}$/.test(normalized)) {
		return normalized;
	}

	return detectSystemCountryCode();
}

export function getCachedYearHolidays(year: number, countryCode: string): YearHolidaysFetchResult | undefined {
	const cacheKey = `${countryCode}:${year}`;
	const cached = holidaysCache.get(cacheKey);
	if (cached === undefined) {
		return undefined;
	}

	const ttl = cached.result.ok ? HOLIDAYS_CACHE_TTL_MS : FAILED_HOLIDAYS_CACHE_TTL_MS;
	if (Date.now() - cached.fetchedAt >= ttl) {
		return undefined;
	}

	return cached.result;
}

export async function fetchYearHolidays(year: number, countryCode: string): Promise<YearHolidaysFetchResult> {
	const cacheKey = `${countryCode}:${year}`;
	const cached = holidaysCache.get(cacheKey);
	if (cached !== undefined) {
		const ttl = cached.result.ok ? HOLIDAYS_CACHE_TTL_MS : FAILED_HOLIDAYS_CACHE_TTL_MS;
		if (Date.now() - cached.fetchedAt < ttl) {
			return cached.result;
		}
	}

	const inFlight = inFlightFetches.get(cacheKey);
	if (inFlight !== undefined) {
		return inFlight;
	}

	const fetchPromise = loadYearHolidays(year, countryCode)
		.then((result) => {
			holidaysCache.set(cacheKey, { result, fetchedAt: Date.now() });
			return result;
		})
		.finally(() => {
			inFlightFetches.delete(cacheKey);
		});

	inFlightFetches.set(cacheKey, fetchPromise);
	return fetchPromise;
}

/** Day-of-month numbers that are public holidays in the given month. */
export function getHolidayDaysInMonth(year: number, month: number, holidays: PublicHoliday[]): Set<number> {
	const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
	const days = new Set<number>();

	for (const holiday of holidays) {
		if (!holiday.date.startsWith(monthPrefix)) {
			continue;
		}

		const day = Number.parseInt(holiday.date.slice(8, 10), 10);
		if (!Number.isNaN(day)) {
			days.add(day);
		}
	}

	return days;
}

async function loadYearHolidays(year: number, countryCode: string): Promise<YearHolidaysFetchResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(`${NAGER_API_BASE}/PublicHolidays/${year}/${countryCode}`, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			console.warn(`[public-holidays] fetch failed (${response.status}) for ${countryCode} ${year}`);
			return loadBundledYearHolidays(year, countryCode) ?? { ok: false, holidays: [] };
		}

		const payload = (await response.json()) as NagerHoliday[];
		if (!Array.isArray(payload)) {
			return loadBundledYearHolidays(year, countryCode) ?? { ok: false, holidays: [] };
		}

		const holidays = payload
			.filter((entry) => typeof entry.date === "string")
			.map((entry) => ({
				date: entry.date,
				name: entry.name ?? entry.localName ?? "Holiday",
				localName: entry.localName ?? entry.name ?? "Holiday",
			}));

		return { ok: true, holidays };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[public-holidays] fetch error for ${countryCode} ${year}: ${message}`);
		return loadBundledYearHolidays(year, countryCode) ?? { ok: false, holidays: [] };
	} finally {
		clearTimeout(timer);
	}
}

type NagerHoliday = {
	date: string;
	localName?: string;
	name?: string;
};

export function getBundledYearHolidays(year: number, countryCode: string): YearHolidaysFetchResult | undefined {
	return loadBundledYearHolidays(year, countryCode);
}

function loadBundledYearHolidays(year: number, countryCode: string): YearHolidaysFetchResult | undefined {
	if (countryCode !== "HK") {
		return undefined;
	}

	const yearPrefix = `${year}-`;
	const holidays = getBundledHolidaysHk()
		.filter((entry) => entry.date.startsWith(yearPrefix))
		.map((entry) => ({
			date: entry.date,
			name: entry.name || entry.localName || "Holiday",
			localName: entry.localName || entry.name || "Holiday",
		}));

	if (holidays.length === 0) {
		return undefined;
	}

	return { ok: true, holidays };
}

let bundledHolidaysHkCache: PublicHoliday[] | undefined;

function getBundledHolidaysHk(): PublicHoliday[] {
	if (bundledHolidaysHkCache !== undefined) {
		return bundledHolidaysHkCache;
	}

	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const pluginRoots = [cwd(), join(cwd(), ".."), moduleDir, join(moduleDir, "..")];
	const candidates = [
		join(moduleDir, "data/holidays-hk.json"),
		join(moduleDir, "../data/holidays-hk.json"),
		join(moduleDir, "../../src/data/holidays-hk.json"),
	];

	for (const root of pluginRoots) {
		if (existsSync(join(root, "manifest.json"))) {
			candidates.push(join(root, "bin/data/holidays-hk.json"));
			candidates.push(join(root, "src/data/holidays-hk.json"));
		}
	}

	for (const path of candidates) {
		try {
			const payload = JSON.parse(readFileSync(path, "utf8")) as PublicHoliday[];
			if (Array.isArray(payload) && payload.length > 0) {
				bundledHolidaysHkCache = payload;
				return payload;
			}
		} catch {
			continue;
		}
	}

	bundledHolidaysHkCache = [];
	return bundledHolidaysHkCache;
}
