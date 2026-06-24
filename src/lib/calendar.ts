const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

const MONTH_ABBREV = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export function getCurrentYear(): number {
	return new Date().getFullYear();
}

/** Local calendar date as YYYY-MM-DD, used to detect day changes. */
export function getLocalDateKey(now = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Milliseconds until the next local midnight, used to refresh the today indicator. */
export function getMsUntilNextMidnight(now = new Date()): number {
	const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return nextMidnight.getTime() - now.getTime();
}

/** Years available in the property inspector (current year + upcoming). */
export function getSelectableYears(): number[] {
	const years = new Set([getCurrentYear(), getCurrentYear() + 1]);
	return [...years].sort((a, b) => a - b);
}

export function normalizeYear(year: number | string | undefined): number {
	const parsed = typeof year === "string" ? Number.parseInt(year, 10) : year;
	const allowed = getSelectableYears();

	if (parsed !== undefined && !Number.isNaN(parsed) && allowed.includes(parsed)) {
		return parsed;
	}

	return getCurrentYear();
}

export function getMonthName(month: number): string {
	return MONTH_NAMES[month - 1] ?? "Unknown";
}

export function getMonthAbbrev(month: number): string {
	return MONTH_ABBREV[month - 1] ?? "???";
}

/**
 * Builds a month grid where each cell is a day number or null for padding.
 */
export function buildMonthWeeks(year: number, month: number): (number | null)[][] {
	const daysInMonth = new Date(year, month, 0).getDate();
	const startDayOfWeek = new Date(year, month - 1, 1).getDay();

	const weeks: (number | null)[][] = [];
	let day = 1;

	for (let week = 0; week < 6; week++) {
		const row: (number | null)[] = [];

		for (let dow = 0; dow < 7; dow++) {
			if ((week === 0 && dow < startDayOfWeek) || day > daysInMonth) {
				row.push(null);
			} else {
				row.push(day++);
			}
		}

		weeks.push(row);

		if (day > daysInMonth) {
			break;
		}
	}

	return weeks;
}

export { MONTH_NAMES };
