import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	Target,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { fetchMonthEventsResult, getCachedMonthEventsResult, getEventDaysInMonth } from "../lib/calendar-events";
import { type CalendarViewMode, getEventsPageCount, renderCalendarImage } from "../lib/calendar-image";
import { getLocalDateKey, getMsUntilNextMidnight, normalizeYear } from "../lib/calendar";
import {
	fetchYearHolidays,
	getBundledYearHolidays,
	getCachedYearHolidays,
	getHolidayDaysInMonth,
	resolveCountryCode,
} from "../lib/public-holidays";

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
	private readonly prefetchedHolidayYears = new Set<string>();

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
		this.prefetchHolidays(settings);
		return this.render(ev.action, settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<MonthCalendarSettings>): void | Promise<void> {
		const previous = this.getRememberedSettings(ev.action.id, ev.payload.settings);
		const settings = this.rememberSettings(ev.action.id, ev.payload.settings);

		if (
			normalizeYear(previous.year) !== normalizeYear(settings.year) ||
			normalizeMonth(previous.month) !== normalizeMonth(settings.month) ||
			normalizeHolidayCountry(previous.holidayCountry) !== normalizeHolidayCountry(settings.holidayCountry)
		) {
			settings.eventsPage = 0;
			this.rememberSettings(ev.action.id, settings);
		}

		this.prefetchHolidays(settings);
		return this.render(ev.action, settings);
	}

	override onKeyDown(ev: KeyDownEvent<MonthCalendarSettings>): void | Promise<void> {
		const remembered = this.getRememberedSettings(ev.action.id, ev.payload.settings);
		const viewMode = getViewMode(remembered.viewMode);
		let nextViewMode: CalendarViewMode = viewMode;
		let eventsPage = normalizeEventsPage(remembered.eventsPage);

		if (viewMode === "month") {
			nextViewMode = "events";
			eventsPage = 0;
		} else if (viewMode === "events") {
			const year = normalizeYear(remembered.year);
			const month = normalizeMonth(remembered.month);
			const eventCount = getCachedMonthEventsResult(year, month)?.events.length ?? 0;
			const pageCount = getEventsPageCount(eventCount);

			if (eventsPage + 1 < pageCount) {
				eventsPage += 1;
			} else {
				nextViewMode = "year";
				eventsPage = 0;
			}
		} else {
			nextViewMode = "month";
			eventsPage = 0;
		}

		const nextIndex = VIEW_MODES.indexOf(nextViewMode);
		const settings = { ...remembered, viewMode: nextIndex, eventsPage };

		this.rememberSettings(ev.action.id, settings);

		void ev.action.setSettings(settings).catch((error: unknown) => {
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
				} else {
					streamDeck.logger.info(`Calendar fetch for ${year}-${month} loaded ${result.events.length} events`);
				}

				return Promise.all([
					this.refreshEventsViewActions(year, month),
					this.refreshMonthViewActions(year, month),
				]);
			})
			.catch((error: unknown) => {
				this.prefetchedMonths.delete(cacheKey);
				streamDeck.logger.warn("Failed to prefetch calendar events", error);
			});
	}

	private prefetchHolidays(settings: MonthCalendarSettings): void {
		const year = normalizeYear(settings.year);
		const countryCode = resolveCountryCode(settings.holidayCountry);
		const cacheKey = `${countryCode}:${year}`;
		const cached = getCachedYearHolidays(year, countryCode);

		if (cached?.ok === true || this.prefetchedHolidayYears.has(cacheKey)) {
			return;
		}

		this.prefetchedHolidayYears.add(cacheKey);

		void fetchYearHolidays(year, countryCode)
			.then((result) => {
				streamDeck.logger.info(
					`Public holidays ${countryCode} ${year}: ok=${result.ok}, count=${result.holidays.length}`,
				);
				if (!result.ok) {
					this.prefetchedHolidayYears.delete(cacheKey);
				}

				return this.refreshMonthViewActions(year);
			})
			.catch((error: unknown) => {
				this.prefetchedHolidayYears.delete(cacheKey);
				streamDeck.logger.warn("Failed to prefetch public holidays", error);
			});
	}

	private async refreshMonthViewActions(year: number, month?: number): Promise<void> {
		await Promise.all(
			[...this.actions].map(async (action) => {
				const remembered = this.getRememberedSettings(action.id, {});
				if (getViewMode(remembered.viewMode) !== "month") {
					return;
				}

				if (normalizeYear(remembered.year) !== year) {
					return;
				}

				const actionMonth = normalizeMonth(remembered.month);
				if (month !== undefined && actionMonth !== month) {
					return;
				}

				const holidayDays = await this.loadHolidayDays(year, actionMonth, remembered);
				const eventsResult = getCachedMonthEventsResult(year, actionMonth);
				await this.paint(action, remembered, year, actionMonth, "month", eventsResult, holidayDays);
			}),
		);
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
		const cachedEvents = getCachedMonthEventsResult(year, month);
		const needsBackgroundFetch = cachedEvents === undefined;
		const holidayDays = viewMode === "month" ? await this.loadHolidayDays(year, month, settings) : new Set<number>();

		await this.paint(action, settings, year, month, viewMode, cachedEvents, holidayDays);

		if (needsBackgroundFetch) {
			void fetchMonthEventsResult(year, month)
				.then(() =>
					Promise.all([
						this.refreshEventsViewActions(year, month),
						viewMode === "month" ? this.refreshMonthViewActions(year, month) : Promise.resolve(),
					]),
				)
				.catch((error: unknown) => {
					streamDeck.logger.warn("Failed to load calendar events", error);
				});
		}

		if (viewMode === "month" && getCachedYearHolidays(year, resolveCountryCode(settings.holidayCountry))?.ok !== true) {
			this.prefetchHolidays(settings);
		}
	}

	private async loadHolidayDays(year: number, month: number, settings: MonthCalendarSettings): Promise<Set<number>> {
		const countryCode = resolveCountryCode(settings.holidayCountry);
		const cached = getCachedYearHolidays(year, countryCode);
		if (cached?.ok === true) {
			return getHolidayDaysInMonth(year, month, cached.holidays);
		}

		const bundled = getBundledYearHolidays(year, countryCode);
		if (bundled?.ok === true) {
			void fetchYearHolidays(year, countryCode);
			const days = getHolidayDaysInMonth(year, month, bundled.holidays);
			streamDeck.logger.info(
				`Public holidays ${countryCode} ${year}-${month} (bundled): [${[...days].join(", ")}]`,
			);
			return days;
		}

		const result = await fetchYearHolidays(year, countryCode);
		const days = getHolidayDaysInMonth(year, month, result.holidays);
		streamDeck.logger.info(`Public holidays ${countryCode} ${year}-${month}: [${[...days].join(", ")}]`);
		return days;
	}

	private async paint(
		action: WillAppearEvent<MonthCalendarSettings>["action"],
		settings: MonthCalendarSettings,
		year: number,
		month: number,
		viewMode: CalendarViewMode,
		eventsResult: Awaited<ReturnType<typeof fetchMonthEventsResult>> | undefined,
		holidayDays: Set<number> = new Set(),
	): Promise<void> {
		const events = eventsResult?.events ?? [];
		const image = renderCalendarImage(year, month, {
			themeColor: settings.themeColor,
			viewMode,
			events,
			eventsPage: normalizeEventsPage(settings.eventsPage),
			eventsLoaded: eventsResult?.ok ?? false,
			eventsDenied: eventsResult?.denied ?? false,
			eventsFetchFailed: eventsResult !== undefined && !eventsResult.ok && !eventsResult.denied,
			holidayDays,
			eventDays: viewMode === "month" ? getEventDaysInMonth(year, month, events) : new Set<number>(),
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
	eventsPage?: number | string;
	holidayCountry?: string;
};

function normalizeHolidayCountry(country: string | undefined): string {
	return country === undefined || country === "" ? "auto" : country;
}

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

function normalizeEventsPage(eventsPage: number | string | undefined): number {
	const parsed = typeof eventsPage === "string" ? Number.parseInt(eventsPage, 10) : eventsPage;
	if (parsed === undefined || Number.isNaN(parsed) || parsed < 0) {
		return 0;
	}

	return parsed;
}
