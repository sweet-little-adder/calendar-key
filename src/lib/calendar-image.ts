import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import type { CalendarEvent } from "./calendar-events";
import { buildMonthWeeks, getCurrentYear, getLocalDateKey, getMonthAbbrev } from "./calendar";
import { getContrastTextColor } from "./color";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const FONT_FAMILY = "Arial, Helvetica Neue, Helvetica, sans-serif";
const RENDER_SIZE = 288;
const OUTPUT_SIZE = 144;
export const EVENTS_PER_PAGE = 4;

const FONT_CANDIDATES = [
	"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
	"/Library/Fonts/Arial Unicode.ttf",
	"/System/Library/Fonts/PingFang.ttc",
	"/System/Library/Fonts/Supplemental/Arial.ttf",
	"/Library/Fonts/Arial.ttf",
	"C:\\Windows\\Fonts\\arial.ttf",
];

const DEFAULT_THEME_COLOR = "#ff0069";

const imageCache = new Map<string, string>();

export type CalendarViewMode = "month" | "events" | "year";

export type CalendarRenderOptions = {
	themeColor?: string;
	viewMode?: CalendarViewMode;
	events?: CalendarEvent[];
	eventsPage?: number;
	eventsLoaded?: boolean;
	eventsDenied?: boolean;
	eventsFetchFailed?: boolean;
};

export function getEventsPageCount(totalEvents: number): number {
	if (totalEvents <= 0) {
		return 1;
	}

	return Math.ceil(totalEvents / EVENTS_PER_PAGE);
}

/**
 * Renders a calendar key image as a crisp PNG data URI.
 */
export function renderCalendarImage(year: number, month: number, options: CalendarRenderOptions = {}): string {
	const themeColor = normalizeThemeColor(options.themeColor);
	const viewMode = options.viewMode ?? "month";
	const events = options.events ?? [];
	const eventsPage = options.eventsPage ?? 0;
	const cacheKey = buildImageCacheKey(year, month, themeColor, viewMode, events, eventsPage);

	const cached = imageCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	let svg: string;
	switch (viewMode) {
		case "events":
			svg = buildEventsSvg(
				year,
				month,
				RENDER_SIZE,
				themeColor,
				events,
				eventsPage,
				options.eventsLoaded ?? true,
				options.eventsDenied ?? false,
				options.eventsFetchFailed ?? false,
			);
			break;
		case "year":
			svg = buildYearSvg(year, month, RENDER_SIZE, themeColor);
			break;
		default:
			svg = buildMonthSvg(year, month, RENDER_SIZE, themeColor);
	}

	const image = svgToDataUri(svg, viewMode);
	imageCache.set(cacheKey, image);
	return image;
}

function svgToDataUri(svg: string, viewMode: CalendarViewMode): string {
	const fontFiles =
		viewMode === "events"
			? FONT_CANDIDATES.filter((path) => existsSync(path))
			: FONT_CANDIDATES.filter((path) => existsSync(path)).slice(0, 1);

	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: OUTPUT_SIZE },
		font: {
			fontFiles: fontFiles.length > 0 ? fontFiles : undefined,
			loadSystemFonts: false,
			defaultFontFamily: "Arial",
		},
	});

	const png = resvg.render().asPng();
	return `data:image/png;base64,${png.toString("base64")}`;
}

function buildMonthSvg(year: number, month: number, size: number, themeColor: string): string {
	const weeks = buildMonthWeeks(year, month);
	const today = new Date();
	const highlightToday = today.getFullYear() === year && today.getMonth() + 1 === month;
	const todayDate = today.getDate();
	const todayTextColor = getContrastTextColor(themeColor);

	const padding = 16;
	const monthTitleHeight = 26;
	const weekdayRowHeight = 26;
	const gridTop = padding + monthTitleHeight + weekdayRowHeight;
	const gridHeight = size - gridTop - padding;
	const rowHeight = gridHeight / weeks.length;
	const colWidth = (size - padding * 2) / 7;
	const gridLeft = padding;

	const monthTitleFontSize = 18;
	const weekdayFontSize = 16;
	const dayFontSize = 22;
	const todayCircleOffsetX = 1.5;
	const todayCircleOffsetY = -0.5;

	let svg = svgBackground(size);

	const titleY = padding + monthTitleHeight / 2;
	svg += textAnchored(size / 2, titleY, getMonthAbbrev(month), monthTitleFontSize, "#d8d8d8", 700, "middle");

	if (year !== getCurrentYear()) {
		svg += textAnchored(size - padding, titleY, String(year), monthTitleFontSize, "#d8d8d8", 700, "end");
	}

	for (let dow = 0; dow < 7; dow++) {
		const x = gridLeft + colWidth * dow + colWidth / 2;
		const y = padding + monthTitleHeight + weekdayRowHeight / 2;
		const fill = dow === 0 || dow === 6 ? "#7a7a7a" : "#9a9a9a";
		svg += text(x, y, WEEKDAY_LABELS[dow], weekdayFontSize, fill, 500);
	}

	for (let week = 0; week < weeks.length; week++) {
		for (let dow = 0; dow < 7; dow++) {
			const day = weeks[week][dow];
			if (day === null) {
				continue;
			}

			const cx = gridLeft + colWidth * dow + colWidth / 2;
			const cy = gridTop + rowHeight * week + rowHeight / 2;
			const isToday = highlightToday && day === todayDate;

			if (isToday) {
				const radius = Math.min(colWidth, rowHeight) * 0.43;
				svg += `<circle cx="${cx + todayCircleOffsetX}" cy="${cy + todayCircleOffsetY}" r="${radius}" fill="${escapeXml(themeColor)}"/>`;
			}

			const fill = isToday ? todayTextColor : "#ececec";
			const weight = isToday ? 600 : 400;
			svg += dayText(cx, cy, String(day), dayFontSize, fill, weight);
		}
	}

	svg += "</svg>";
	return svg;
}

function buildYearSvg(year: number, focusMonth: number, size: number, themeColor: string): string {
	const padding = 14;
	const titleHeight = 24;
	const gridTop = padding + titleHeight + 6;
	const gridHeight = size - gridTop - padding;
	const cols = 4;
	const rows = 3;
	const cellWidth = (size - padding * 2) / cols;
	const cellHeight = gridHeight / rows;
	const monthFontSize = 15;
	const focusTextColor = getContrastTextColor(themeColor);

	const today = new Date();
	const highlightCurrentMonth = today.getFullYear() === year;
	const currentMonth = today.getMonth() + 1;

	let svg = svgBackground(size);
	svg += textAnchored(size / 2, padding + titleHeight / 2, String(year), 18, "#d8d8d8", 700, "middle");

	for (let month = 1; month <= 12; month++) {
		const index = month - 1;
		const col = index % cols;
		const row = Math.floor(index / cols);
		const cx = padding + cellWidth * col + cellWidth / 2;
		const cy = gridTop + cellHeight * row + cellHeight / 2;
		const isFocusMonth = month === focusMonth;
		const isCurrentMonth = highlightCurrentMonth && month === currentMonth;

		if (isFocusMonth) {
			const radius = Math.min(cellWidth, cellHeight) * 0.38;
			svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${escapeXml(themeColor)}"/>`;
		} else if (isCurrentMonth) {
			const radius = Math.min(cellWidth, cellHeight) * 0.38;
			svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${escapeXml(themeColor)}" stroke-width="2"/>`;
		}

		const fill = isFocusMonth ? focusTextColor : isCurrentMonth ? themeColor : "#bdbdbd";
		const weight = isFocusMonth || isCurrentMonth ? 700 : 500;
		svg += text(cx, cy, getMonthAbbrev(month), monthFontSize, fill, weight);
	}

	svg += "</svg>";
	return svg;
}

function buildEventsSvg(
	year: number,
	month: number,
	size: number,
	themeColor: string,
	events: CalendarEvent[],
	eventsPage: number,
	eventsLoaded: boolean,
	eventsDenied: boolean,
	eventsFetchFailed: boolean,
): string {
	const padding = 12;
	const titleHeight = 26;
	const listTop = padding + titleHeight + 6;
	const listHeight = size - listTop - padding;
	const lineHeight = listHeight / EVENTS_PER_PAGE;
	const titleFontSize = 17;
	const eventFontSize = 18;
	const pageStart = eventsPage * EVENTS_PER_PAGE;
	const visibleEvents = events.slice(pageStart, pageStart + EVENTS_PER_PAGE);

	let svg = svgBackground(size);
	svg += textAnchored(size / 2, padding + titleHeight / 2, getMonthAbbrev(month), titleFontSize, "#d8d8d8", 700, "middle");

	if (year !== getCurrentYear()) {
		svg += textAnchored(size - padding, padding + titleHeight / 2, String(year), titleFontSize, "#d8d8d8", 700, "end");
	}

	if (visibleEvents.length === 0) {
		const emptyLabel = eventsDenied
			? "Allow Calendar access"
			: eventsFetchFailed
				? "Could not load events"
				: !eventsLoaded
					? "Loading events..."
					: process.platform === "darwin"
						? "No events"
						: "Events (macOS only)";
		svg += textAnchored(size / 2, listTop + listHeight / 2, emptyLabel, eventFontSize, "#8a8a8a", 500, "middle");
		svg += "</svg>";
		return svg;
	}

	for (let index = 0; index < visibleEvents.length; index++) {
		const event = visibleEvents[index];
		const y = listTop + lineHeight * index + lineHeight / 2;
		const dayLabel = String(event.start.getDate()).padStart(2, "0");
		const title = truncateText(event.title, 13);
		const line = `${dayLabel}  ${title}`;

		svg += textAnchored(padding, y, line, eventFontSize, "#e0e0e0", 500, "start");
	}

	const pageCount = getEventsPageCount(events.length);
	if (pageCount > 1) {
		const pageLabel = `${eventsPage + 1}/${pageCount}`;
		svg += textAnchored(size - padding, size - padding, pageLabel, 12, "#6a6a6a", 500, "end");
	}

	svg += "</svg>";
	return svg;
}

function svgBackground(size: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#141414"/>`;
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength - 1)}…`;
}

function dayText(x: number, y: number, value: string, fontSize: number, fill: string, weight: number): string {
	return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${fill}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}">${escapeXml(value)}</text>`;
}

function textAnchored(
	x: number,
	y: number,
	value: string,
	fontSize: number,
	fill: string,
	weight: number,
	anchor: "start" | "middle" | "end",
): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${fill}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}">${escapeXml(value)}</text>`;
}

function text(x: number, y: number, value: string, fontSize: number, fill: string, weight: number): string {
	return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}">${escapeXml(value)}</text>`;
}

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function buildImageCacheKey(
	year: number,
	month: number,
	themeColor: string,
	viewMode: CalendarViewMode,
	events: CalendarEvent[],
	eventsPage: number,
): string {
	const todayKey = getLocalDateKey();
	if (viewMode === "events") {
		const eventDigest = events.map((event) => `${event.start.getTime()}:${event.title}`).join("|");
		return `${todayKey}:${year}:${month}:${themeColor}:${viewMode}:${eventsPage}:${eventDigest}`;
	}

	return `${todayKey}:${year}:${month}:${themeColor}:${viewMode}`;
}

function normalizeThemeColor(color: string | undefined): string {
	if (color === undefined || color === "") {
		return DEFAULT_THEME_COLOR;
	}

	const normalized = color.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(normalized)) {
		return normalized;
	}

	return DEFAULT_THEME_COLOR;
}
