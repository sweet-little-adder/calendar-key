import EventKit
import Foundation

struct Arguments {
	let year: Int
	let month: Int
}

func parseArguments() -> Arguments? {
	let args = CommandLine.arguments
	guard args.count == 3,
		let year = Int(args[1]),
		let month = Int(args[2]),
		month >= 1,
		month <= 12
	else {
		fputs("usage: fetch-calendar-events <year> <month>\n", stderr)
		return nil
	}

	return Arguments(year: year, month: month)
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

func printEvents(_ events: [EKEvent], calendar: Calendar) {
	let sortedEvents = events.sorted {
		($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast)
	}

	for event in sortedEvents {
		guard let startDate = event.startDate else {
			continue
		}

		let components = calendar.dateComponents([.year, .month, .day], from: startDate)
		guard let year = components.year, let month = components.month, let day = components.day else {
			continue
		}

		let title = event.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		print("\(title)\t\(year)-\(month)-\(day)")
	}
}

guard let args = parseArguments() else {
	exit(2)
}

let store = EKEventStore()
let calendar = Calendar.current
let semaphore = DispatchSemaphore(value: 0)
var exitCode = 1

requestAccess(using: store) { granted in
	defer { semaphore.signal() }

	guard granted else {
		fputs("calendar access denied\n", stderr)
		exitCode = 3
		return
	}

	guard let (startDate, endDate) = monthRange(for: args, calendar: calendar) else {
		fputs("invalid month range\n", stderr)
		exitCode = 4
		return
	}

	let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
	printEvents(store.events(matching: predicate), calendar: calendar)
	exitCode = 0
}

semaphore.wait()
exit(Int32(exitCode))
