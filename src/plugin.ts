import streamDeck from "@elgato/streamdeck";

import { IncrementCounter } from "./actions/increment-counter";
import { MonthCalendar } from "./actions/month-calendar";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register actions.
streamDeck.actions.registerAction(new IncrementCounter());
streamDeck.actions.registerAction(new MonthCalendar());

// Finally, connect to the Stream Deck.
streamDeck.connect();
