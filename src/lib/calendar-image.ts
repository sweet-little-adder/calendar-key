import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { buildMonthWeeks, getCurrentYear, getMonthAbbrev } from "./calendar";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const FONT_FAMILY = "Arial, Helvetica Neue, Helvetica, sans-serif";
const RENDER_SIZE = 288;
const OUTPUT_SIZE = 144;

const FONT_CANDIDATES = [
	"/System/Library/Fonts/Supplemental/Arial.ttf",
	"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
	"/Library/Fonts/Arial.ttf",
	"C:\\Windows\\Fonts\\arial.ttf",
];

const DEFAULT_THEME_COLOR = "#ff0069";

export type CalendarRenderOptions = {
	themeColor?: string;
};

/**
 * Renders a calendar month as a crisp PNG data URI using Arial at a consistent size.
 */
export function renderCalendarImage(year: number, month: number, options: CalendarRenderOptions = {}): string {
	const themeColor = normalizeThemeColor(options.themeColor);
	const svg = buildCalendarSvg(year, month, RENDER_SIZE, themeColor);
	const fontFile = FONT_CANDIDATES.find((path) => existsSync(path));

	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: OUTPUT_SIZE },
		font: {
			fontFiles: fontFile ? [fontFile] : undefined,
			loadSystemFonts: true,
			defaultFontFamily: "Arial",
		},
	});

	const png = resvg.render().asPng();
	return `data:image/png;base64,${png.toString("base64")}`;
}

function buildCalendarSvg(year: number, month: number, size: number, themeColor: string): string {
	const weeks = buildMonthWeeks(year, month);
	const today = new Date();
	const highlightToday = today.getFullYear() === year && today.getMonth() + 1 === month;
	const todayDate = today.getDate();

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
	// Optical correction for resvg + Arial: fine-tune circle vs digit glyph center.
	const todayCircleOffsetX = 1.5;
	const todayCircleOffsetY = -0.5;

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
	svg += `<rect width="${size}" height="${size}" fill="#141414"/>`;

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

			const fill = isToday ? "#ffffff" : "#ececec";
			const weight = isToday ? 600 : 400;
			svg += dayText(cx, cy, String(day), dayFontSize, fill, weight);
		}
	}

	svg += "</svg>";
	return svg;
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
