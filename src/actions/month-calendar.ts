import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	Target,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { fetchMonthEventsResult, getCachedMonthEventsResult } from "../lib/calendar-events";
import { type CalendarViewMode, renderCalendarImage } from "../lib/calendar-image";
import { getLocalDateKey, getMsUntilNextMidnight, normalizeYear } from "../lib/calendar";

const DATE_POLL_INTERVAL_MS = 15_000;
const REFRESH_BURST_DELAYS_MS = [0, 2_000, 5_000, 15_000];
const VIEW_MODES: CalendarViewMode[] = ["month", "events", "year"];

@action({ UUID: "com.orionwong.calendar-keys.month" })
export class MonthCalendar extends SingletonAction<MonthCalendarSettings> {
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private datePollTimer: ReturnType<typeof setInterval> | undefined;
	private lastKnownDateKey = getLocalDateKey();
	private autoRefreshStarted = false;
	private readonly settingsByAction = new Map<string, MonthCalendarSettings>();
	private readonly prefetchedMonths = new Set<string>();

	constructor() {
		super();

		streamDeck.system.onSystemDidWakeUp(() => {
			this.scheduleRefreshBurst("system wake");
		});

		streamDeck.devices.onDeviceDidConnect(() => {
			this.scheduleRefreshBurst("device connect");
		});
	}

	override onWillAppear(ev: WillAppearEvent<MonthCalendarSettings>): void | Promise<void> {
		this.startAutoRefresh();
		const settings = this.rememberSettings(ev.action.id, ev.payload.settings);
		this.prefetchEvents(settings);
		return this.render(ev.action, settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<MonthCalendarSettings>): void | Promise<void> {
		const settings = this.rememberSettings(ev.action.id, ev.payload.settings);
		return this.render(ev.action, settings);
	}

	override onKeyDown(ev: KeyDownEvent<MonthCalendarSettings>): void | Promise<void> {
		const remembered = this.getRememberedSettings(ev.action.id, ev.payload.settings);
		const nextIndex = (normalizeViewModeIndex(remembered.viewMode) + 1) % VIEW_MODES.length;
		const settings = { ...remembered, viewMode: nextIndex };

		this.rememberSettings(ev.action.id, settings);

		void ev.action.setSettings({ viewMode: nextIndex }).catch((error: unknown) => {
			streamDeck.logger.error("Failed to persist view mode", error);
		});

		void this.render(ev.action, settings).catch((error: unknown) => {
			streamDeck.logger.error("Failed to cycle view mode", error);
		});
	}

	private rememberSettings(actionId: string, settings: MonthCalendarSettings): MonthCalendarSettings {
		const remembered = { ...settings };
		this.settingsByAction.set(actionId, remembered);
		return remembered;
	}

	private getRememberedSettings(actionId: string, fallback: MonthCalendarSettings): MonthCalendarSettings {
		return this.settingsByAction.get(actionId) ?? fallback;
	}

	private startAutoRefresh(): void {
		if (this.autoRefreshStarted) {
			return;
		}

		this.autoRefreshStarted = true;
		this.scheduleDailyRefresh();

		this.datePollTimer = setInterval(() => {
			const today = getLocalDateKey();
			if (today === this.lastKnownDateKey) {
				return;
			}

			this.lastKnownDateKey = today;
			streamDeck.logger.info(`Calendar date changed to ${today}; refreshing keys.`);
			void this.refreshAllVisibleActions();
		}, DATE_POLL_INTERVAL_MS);
	}

	private scheduleDailyRefresh(): void {
		if (this.refreshTimer !== undefined) {
			clearTimeout(this.refreshTimer);
		}

		this.refreshTimer = setTimeout(() => {
			this.lastKnownDateKey = getLocalDateKey();
			void this.refreshAllVisibleActions();
			this.scheduleDailyRefresh();
		}, getMsUntilNextMidnight());
	}

	private scheduleRefreshBurst(reason: string): void {
		streamDeck.logger.info(`Scheduling calendar refresh burst (${reason}).`);

		for (const delay of REFRESH_BURST_DELAYS_MS) {
			setTimeout(() => {
				this.lastKnownDateKey = getLocalDateKey();
				void this.refreshAllVisibleActions();
			}, delay);
		}
	}

	private async refreshAllVisibleActions(): Promise<void> {
		const actions = [...this.actions];
		if (actions.length === 0) {
			return;
		}

		this.lastKnownDateKey = getLocalDateKey();

		await Promise.all(
			actions.map(async (action) => {
				const settings = this.getRememberedSettings(action.id, {});
				await this.render(action, settings);
			}),
		);
	}

	private prefetchEvents(settings: MonthCalendarSettings): void {
		if (process.platform !== "darwin") {
			return;
		}

		const year = normalizeYear(settings.year);
		const month = normalizeMonth(settings.month);
		const cacheKey = `${year}-${month}`;

		if (this.prefetchedMonths.has(cacheKey) || getCachedMonthEventsResult(year, month) !== undefined) {
			return;
		}

		this.prefetchedMonths.add(cacheKey);

		void fetchMonthEventsResult(year, month)
			.then((result) => {
				if (!result.ok) {
					streamDeck.logger.warn(
						`Calendar fetch for ${year}-${month} failed (denied=${result.denied}, events=${result.events.length})`,
					);
					this.prefetchedMonths.delete(cacheKey);
				}

				return this.refreshEventsViewActions(year, month);
			})
			.catch((error: unknown) => {
				this.prefetchedMonths.delete(cacheKey);
				streamDeck.logger.warn("Failed to prefetch calendar events", error);
			});
	}

	private async refreshEventsViewActions(year: number, month: number): Promise<void> {
		const eventsResult = getCachedMonthEventsResult(year, month);
		if (eventsResult === undefined) {
			return;
		}

		await Promise.all(
			[...this.actions].map(async (action) => {
				const settings = this.getRememberedSettings(action.id, {});
				if (getViewMode(settings.viewMode) !== "events") {
					return;
				}

				if (normalizeYear(settings.year) !== year || normalizeMonth(settings.month) !== month) {
					return;
				}

				await this.paint(action, settings, year, month, "events", eventsResult);
			}),
		);
	}

	private async render(
		action: WillAppearEvent<MonthCalendarSettings>["action"],
		settings: MonthCalendarSettings,
	): Promise<void> {
		const month = normalizeMonth(settings.month);
		const year = normalizeYear(settings.year);
		const viewMode = getViewMode(settings.viewMode);
		const cachedEvents = viewMode === "events" ? getCachedMonthEventsResult(year, month) : undefined;
		const needsBackgroundFetch = viewMode === "events" && cachedEvents === undefined;

		await this.paint(action, settings, year, month, viewMode, cachedEvents);

		if (needsBackgroundFetch) {
			void fetchMonthEventsResult(year, month)
				.then(() => this.refreshEventsViewActions(year, month))
				.catch((error: unknown) => {
					streamDeck.logger.warn("Failed to load calendar events", error);
				});
		}
	}

	private async paint(
		action: WillAppearEvent<MonthCalendarSettings>["action"],
		settings: MonthCalendarSettings,
		year: number,
		month: number,
		viewMode: CalendarViewMode,
		eventsResult: Awaited<ReturnType<typeof fetchMonthEventsResult>> | undefined,
	): Promise<void> {
		const image = renderCalendarImage(year, month, {
			themeColor: settings.themeColor,
			viewMode,
			events: eventsResult?.events,
			eventsLoaded: eventsResult?.ok ?? false,
			eventsDenied: eventsResult?.denied ?? false,
			eventsFetchFailed: eventsResult !== undefined && !eventsResult.ok && !eventsResult.denied,
		});

		await action.setImage(image, { target: Target.HardwareAndSoftware });
		await action.setTitle("");
	}
}

type MonthCalendarSettings = {
	month?: number | string;
	year?: number | string;
	themeColor?: string;
	viewMode?: number | string;
};

function normalizeMonth(month: number | string | undefined): number {
	const parsed = typeof month === "string" ? Number.parseInt(month, 10) : month;

	if (parsed === undefined || Number.isNaN(parsed) || parsed < 1 || parsed > 12) {
		return new Date().getMonth() + 1;
	}

	return parsed;
}

function normalizeViewModeIndex(viewMode: number | string | undefined): number {
	const parsed = typeof viewMode === "string" ? Number.parseInt(viewMode, 10) : viewMode;
	if (parsed === undefined || Number.isNaN(parsed)) {
		return 0;
	}

	const wrapped = ((parsed % VIEW_MODES.length) + VIEW_MODES.length) % VIEW_MODES.length;
	return wrapped;
}

function getViewMode(viewMode: number | string | undefined): CalendarViewMode {
	return VIEW_MODES[normalizeViewModeIndex(viewMode)] ?? "month";
}
