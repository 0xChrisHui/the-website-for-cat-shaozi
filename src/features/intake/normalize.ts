import type { IntakeEventV1 } from "../../lib/contracts/intake";

type IntakeDateInput = Pick<IntakeEventV1, "commonDateHint" | "receivedAt"> &
  Pick<IntakeEventV1["items"][number], "dateHint">;

export type IntakeDateResult =
  | { status: "resolved"; localDate: string; dateSource: "item" | "common" | "received" }
  | { status: "pending"; reason: "日期待确认"; dateSource: "item" | "common"; originalHint: string };

const shanghaiCalendar = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Shanghai",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function calendarDate(hint: string): string | undefined {
  const value = hint.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ??
    /^(\d{4})[ \t]*年[ \t]*(\d{1,2})[ \t]*月[ \t]*(\d{1,2})[ \t]*日$/.exec(value);
  if (!match) return;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  if (
    year === 0 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return;

  return check.toISOString().slice(0, 10);
}

// receivedAt is the validated UTC timestamp from IntakeEventV1.
export function normalizeIntakeDate({
  dateHint,
  commonDateHint,
  receivedAt,
}: IntakeDateInput): IntakeDateResult {
  const hint = dateHint ?? commonDateHint;
  if (hint !== undefined) {
    const dateSource = dateHint === undefined ? "common" : "item";
    const localDate = calendarDate(hint);
    if (localDate) return { status: "resolved", localDate, dateSource };
    return { status: "pending", reason: "日期待确认", dateSource, originalHint: hint };
  }

  const parts = shanghaiCalendar.formatToParts(new Date(receivedAt));
  const year = parts.find(({ type }) => type === "year")!.value.padStart(4, "0");
  const month = parts.find(({ type }) => type === "month")!.value;
  const day = parts.find(({ type }) => type === "day")!.value;
  return { status: "resolved", localDate: `${year}-${month}-${day}`, dateSource: "received" };
}
