import { describe, expect, it } from "vitest";
import {
  addMonths,
  dhakaToday,
  formatAmount,
  formatDate,
  formatMinutes,
  formatMonth,
  formatTaka,
  formatTime,
  monthRange,
} from "./format";

describe("format", () => {
  it("amounts use lakh grouping; Bangla digits in Bangla", () => {
    expect(formatAmount("1234567.5", "en")).toBe("12,34,567.50");
    expect(formatAmount("29000.00", "en")).toBe("29,000.00");
    expect(formatAmount("950", "en")).toBe("950.00");
    expect(formatAmount("-1000.00", "en")).toBe("-1,000.00");
    expect(formatAmount("1234567.50", "bn")).toBe("১২,৩৪,৫৬৭.৫০");
    expect(formatTaka("29000.00", "en")).toBe("৳ 29,000.00");
  });

  it("dates and months in both languages", () => {
    expect(formatDate("2026-10-15", "en")).toBe("15 October 2026");
    expect(formatDate("2026-10-15", "bn", { weekday: true })).toBe(
      "বৃহস্পতি, ১৫ অক্টোবর ২০২৬",
    );
    expect(formatDate("2026-10-15", "en", { short: true })).toBe("15 Oct");
    expect(formatMonth("2026-09", "bn")).toBe("সেপ্টেম্বর ২০২৬");
  });

  it("times are Dhaka clock time", () => {
    expect(formatTime("2026-10-15T03:05:00.000Z", "en")).toBe("09:05");
    expect(formatTime(null, "en")).toBe("–");
    expect(formatMinutes(537, "en")).toBe("8h 57m");
    expect(dhakaToday(new Date("2026-10-14T19:30:00Z"))).toBe("2026-10-15"); // 01:30 in Dhaka
  });

  it("months", () => {
    expect(monthRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});
