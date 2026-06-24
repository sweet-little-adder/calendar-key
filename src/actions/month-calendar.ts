import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	Target,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { fetchMonthEvents } from "../lib/calendar-events";
import { type CalendarViewMode, renderCalendarImage } from "../lib/calendar-image";
import { getLocalDateKey, getMsUntilNextMidnight, normalizeYear } from "../lib/calendar";

const DATE_POLL_INTERVAL_MS = 60_000;
const REFRESH_BURST_DELAYS_MS = [0, 2_000, 5_000, 15_000];
const VIEW_MODES: CalendarViewMode[] = ["month", "events", "year"];

@action({ UUID: "com.orionwong.calendar-keys.month" })
export class MonthCalendar extends SingletonAction<MonthCalendarSettings> {
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private datePollTimer: ReturnType<typeof setInterval> | undefined;
	private lastKnownDateKey = getLocalDateKey();
	private autoRefreshStarted = false;

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
		return this.render(ev.action, ev.payload.settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<MonthCalendarSettings>): void | Promise<void> {
		return this.render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<MonthCalendarSettings>): Promise<void> {
		const { settings } = ev.payload;
		const currentIndex = normalizeViewModeIndex(settings.viewMode);
		const nextIndex = (currentIndex + 1) % VIEW_MODES.length;

		settings.viewMode = nextIndex;
		await ev.action.setSettings(settings);
		await this.render(ev.action, settings);
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

		for (const action of actions) {
			const settings = await action.getSettings<MonthCalendarSettings>();
			await this.render(action, settings);
		}
	}

	private async render(
		action: WillAppearEvent<MonthCalendarSettings>["action"],
		settings: MonthCalendarSettings,
	): Promise<void> {
		const month = normalizeMonth(settings.month);
		const year = normalizeYear(settings.year);
		const viewMode = getViewMode(settings.viewMode);
		const events = viewMode === "events" ? await fetchMonthEvents(year, month) : undefined;
		const image = renderCalendarImage(year, month, {
			themeColor: settings.themeColor,
			viewMode,
			events,
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
