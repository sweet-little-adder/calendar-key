import { spawn } from "node:child_process";

export type CalendarEvent = {
	title: string;
	start: Date;
};

const EVENTS_CACHE_TTL_MS = 5 * 60_000;
const OSASCRIPT_TIMEOUT_MS = 8_000;

const eventsCache = new Map<string, { events: CalendarEvent[]; fetchedAt: number }>();

export async function fetchMonthEvents(year: number, month: number): Promise<CalendarEvent[]> {
	const cacheKey = `${year}-${month}`;
	const cached = eventsCache.get(cacheKey);
	if (cached !== undefined && Date.now() - cached.fetchedAt < EVENTS_CACHE_TTL_MS) {
		return cached.events;
	}

	if (process.platform !== "darwin") {
		return [];
	}

	const nextMonth = month === 12 ? 1 : month + 1;
	const nextYear = month === 12 ? year + 1 : year;

	const script = `
set output to ""
tell application "Calendar"
	set startDate to date "${month}/1/${year}"
	set endDate to date "${nextMonth}/1/${nextYear}"
	repeat with c in calendars
		try
			repeat with e in (events of c whose start date ≥ startDate and start date < endDate)
				set eventTitle to summary of e
				if eventTitle is missing value then set eventTitle to ""
				set eventStart to start date of e
				set y to year of eventStart
				set m to month of eventStart as integer
				set d to day of eventStart
				set output to output & eventTitle & tab & y & "-" & m & "-" & d & linefeed
			end repeat
		end try
	end repeat
end tell
return output
`.trim();

	const stdout = await runOsascript(script);
	const events = parseEvents(stdout);
	events.sort((a, b) => a.start.getTime() - b.start.getTime());

	eventsCache.set(cacheKey, { events, fetchedAt: Date.now() });
	return events;
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

	return events;
}

function runOsascript(script: string): Promise<string> {
	return new Promise((resolve) => {
		const proc = spawn("osascript", ["-e", script]);
		let stdout = "";

		const timer = setTimeout(() => {
			proc.kill();
			resolve("");
		}, OSASCRIPT_TIMEOUT_MS);

		proc.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});

		proc.on("close", () => {
			clearTimeout(timer);
			resolve(stdout);
		});

		proc.on("error", () => {
			clearTimeout(timer);
			resolve("");
		});
	});
}
