import AppKit
import EventKit
import Foundation

struct Arguments {
	let year: Int
	let month: Int
	let eventsPath: String?
	let statusPath: String?
}

func parseArguments() -> Arguments? {
	let args = CommandLine.arguments
	guard args.count >= 3,
		let year = Int(args[1]),
		let month = Int(args[2]),
		month >= 1,
		month <= 12
	else {
		fputs("usage: fetch-calendar-events <year> <month> [eventsPath] [statusPath]\n", stderr)
		return nil
	}

	let eventsPath = args.count >= 4 ? args[3] : nil
	let statusPath = args.count >= 5 ? args[4] : nil
	return Arguments(year: year, month: month, eventsPath: eventsPath, statusPath: statusPath)
}

func monthRange(for args: Arguments, calendar: Calendar) -> (Date, Date)? {
	var startComponents = DateComponents()
	startComponents.year = args.year
	startComponents.month = args.month
	startComponents.day = 1

	guard let startDate = calendar.date(from: startComponents) else {
		return nil
	}

	var endComponents = DateComponents()
	endComponents.year = args.month == 12 ? args.year + 1 : args.year
	endComponents.month = args.month == 12 ? 1 : args.month + 1
	endComponents.day = 1

	guard let endDate = calendar.date(from: endComponents) else {
		return nil
	}

	return (startDate, endDate)
}

func requestAccess(using store: EKEventStore, completion: @escaping (Bool) -> Void) {
	if #available(macOS 14.0, *) {
		store.requestFullAccessToEvents { granted, error in
			if let error {
				fputs("calendar access error: \(error.localizedDescription)\n", stderr)
			}
			completion(granted)
		}
		return
	}

	store.requestAccess(to: .event) { granted, error in
		if let error {
			fputs("calendar access error: \(error.localizedDescription)\n", stderr)
		}
		completion(granted)
	}
}

func formatEvents(_ events: [EKEvent], calendar: Calendar) -> String {
	let sortedEvents = events.sorted {
		($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast)
	}

	var lines: [String] = []
	for event in sortedEvents {
		guard let startDate = event.startDate else {
			continue
		}

		let components = calendar.dateComponents([.year, .month, .day], from: startDate)
		guard let year = components.year, let month = components.month, let day = components.day else {
			continue
		}

		let title = event.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		lines.append("\(title)\t\(year)-\(month)-\(day)")
	}

	return lines.joined(separator: "\n") + (lines.isEmpty ? "" : "\n")
}

func writeString(_ text: String, to path: String?) {
	guard let path else {
		return
	}

	do {
		try text.write(toFile: path, atomically: true, encoding: .utf8)
	} catch {
		fputs("failed to write \(path): \(error.localizedDescription)\n", stderr)
	}
}

func finish(status: String, exitCode: Int32, eventsText: String = "", eventsPath: String?, statusPath: String?) -> Never {
	if !eventsText.isEmpty {
		print(eventsText, terminator: "")
	}
	writeString(eventsText, to: eventsPath)
	writeString("\(status)\n", to: statusPath)
	exit(exitCode)
}

func currentAuthorizationGranted() -> Bool {
	if #available(macOS 14.0, *) {
		let status = EKEventStore.authorizationStatus(for: .event)
		return status == .fullAccess
	}

	return EKEventStore.authorizationStatus(for: .event) == .authorized
}

guard let args = parseArguments() else {
	exit(2)
}

// AppKit is required so macOS can present the Calendar permission dialog.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.activate(ignoringOtherApps: true)

let store = EKEventStore()
let calendar = Calendar.current

// Fast path when permission is already granted.
if currentAuthorizationGranted() {
	guard let (startDate, endDate) = monthRange(for: args, calendar: calendar) else {
		fputs("invalid month range\n", stderr)
		finish(status: "error", exitCode: 4, eventsPath: args.eventsPath, statusPath: args.statusPath)
	}

	let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
	let eventsText = formatEvents(store.events(matching: predicate), calendar: calendar)
	finish(status: "ok", exitCode: 0, eventsText: eventsText, eventsPath: args.eventsPath, statusPath: args.statusPath)
}

var exitCode: Int32 = 1
var status = "error"
var eventsText = ""
var finished = false

func complete() {
	guard !finished else {
		return
	}
	finished = true
	DispatchQueue.main.async {
		app.stop(nil)
		// Ensure run loop exits even if stop is ignored.
		CFRunLoopStop(CFRunLoopGetMain())
	}
}

requestAccess(using: store) { granted in
	if !granted {
		fputs("calendar access denied\n", stderr)
		exitCode = 3
		status = "denied"
		complete()
		return
	}

	guard let (startDate, endDate) = monthRange(for: args, calendar: calendar) else {
		fputs("invalid month range\n", stderr)
		exitCode = 4
		status = "error"
		complete()
		return
	}

	let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
	eventsText = formatEvents(store.events(matching: predicate), calendar: calendar)
	exitCode = 0
	status = "ok"
	complete()
}

// Time out if the user never responds to the permission prompt.
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
	if !finished {
		fputs("calendar access timed out\n", stderr)
		exitCode = 5
		status = "error"
		complete()
	}
}

app.run()
finish(status: status, exitCode: exitCode, eventsText: eventsText, eventsPath: args.eventsPath, statusPath: args.statusPath)
