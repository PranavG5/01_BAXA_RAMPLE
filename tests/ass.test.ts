import { test } from "node:test";
import assert from "node:assert/strict";
import { assColor, assText, assTime, buildAss } from "../src/lib/core/ass.ts";

test("colours, times and text are converted to ASS form", () => {
  assert.equal(assColor("#5B4BDB", "#111111"), "&H00DB4B5B");
  assert.equal(assColor("nope", "#111111"), "&H00111111");
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(75.456), "0:01:15.46");
  assert.equal(assText("Line {\\b1}one\nline two"), "Line (/b1)one line two");
});

test("scenes become timed events with the right styles", () => {
  const ass = buildAss({
    scenes: [
      { order: 2, role: "showcase", duration_s: 3.5, treatment: "still_motion", onScreenText: "Sharp lines", voiceoverText: "Precision work." },
      { order: 1, role: "hook", duration_s: 3, treatment: "animate", onScreenText: "$25 Fades", voiceoverText: "" },
      { order: 3, role: "cta", duration_s: 3.5, treatment: "end_card", onScreenText: "", voiceoverText: "Book now." },
    ],
    businessName: "Baxa Barbers",
    bookingText: "baxa.com/book",
    brandPrimary: "#5B4BDB",
    brandAccent: "#F5C518",
    captions: true,
    fontName: "DejaVu Sans",
  });
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.deepEqual(
    events.map((e) => e.split(",").slice(1, 4).join(",")),
    ["0:00:00.00,0:00:03.00,Hook", "0:00:03.00,0:00:06.50,Overlay", "0:00:03.00,0:00:06.50,Caption", "0:00:06.50,0:00:10.00,Cta", "0:00:06.50,0:00:10.00,Booking"],
  );
  assert.ok(events[3].endsWith("Baxa Barbers"), "end card falls back to the business name");
  assert.ok(!events.some((e) => e.includes("Book now.")), "no caption on the end card");
  assert.ok(ass.includes("Style: Hook,DejaVu Sans,78,&H00FFFFFF,&H00FFFFFF,&H00DB4B5B"));
});
