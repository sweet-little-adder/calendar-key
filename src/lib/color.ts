/** Returns true when a hex color is light enough to need dark text on top. */
export function isLightColor(hex: string): boolean {
	const normalized = hex.trim().toLowerCase();
	if (!/^#[0-9a-f]{6}$/.test(normalized)) {
		return false;
	}

	const r = Number.parseInt(normalized.slice(1, 3), 16);
	const g = Number.parseInt(normalized.slice(3, 5), 16);
	const b = Number.parseInt(normalized.slice(5, 7), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	return luminance > 0.62;
}

export function getContrastTextColor(backgroundColor: string): string {
	return isLightColor(backgroundColor) ? "#141414" : "#ffffff";
}
