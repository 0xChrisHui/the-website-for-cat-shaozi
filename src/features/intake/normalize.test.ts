import { describe, expect, it } from "vitest";
import { normalizeIntakeDate } from "./normalize";

const receivedAt = "2026-11-24T16:00:00.000Z";

describe("normalizeIntakeDate", () => {
  it("prefers an explicit item date over a different shared date", () => {
    expect(normalizeIntakeDate({ dateHint: "2024-02-29", commonDateHint: "2024-03-01", receivedAt }))
      .toEqual({ status: "resolved", localDate: "2024-02-29", dateSource: "item" });
  });

  it("uses the explicit shared date when the item has no hint", () => {
    expect(normalizeIntakeDate({ commonDateHint: " 2000 年 2 月 29 日 ", receivedAt }))
      .toEqual({ status: "resolved", localDate: "2000-02-29", dateSource: "common" });
  });

  it.each([
    ["2026-11-24T15:59:59.999Z", "2026-11-24"],
    [receivedAt, "2026-11-25"],
  ])("uses the Shanghai calendar for receipt at %s", (timestamp, localDate) => {
    expect(normalizeIntakeDate({ receivedAt: timestamp }))
      .toEqual({ status: "resolved", localDate, dateSource: "received" });
  });

  it.each([
    "1900-02-29",
    "2025年2月29日",
    "2026-04-31",
    "2026-00-01",
    "2026-11-00",
    "2026-11-4",
    " 11/12/2026 ",
    "去年秋天",
    "2026-11-24 或 2026-11-25",
    "",
  ])("preserves a supplied item hint in need of confirmation (%j)", (dateHint) => {
    expect(normalizeIntakeDate({ dateHint, commonDateHint: "2026-11-24", receivedAt }))
      .toEqual({ status: "pending", reason: "日期待确认", dateSource: "item", originalHint: dateHint });
  });

  it("preserves a conflicting shared hint when no item date is supplied", () => {
    const commonDateHint = " 2026年11月24日 / 2026年11月25日 ";
    expect(normalizeIntakeDate({ commonDateHint, receivedAt }))
      .toEqual({ status: "pending", reason: "日期待确认", dateSource: "common", originalHint: commonDateHint });
  });

  it("gives the same result for repeated deliveries with the same inputs", () => {
    const input = { receivedAt };
    const first = normalizeIntakeDate(input);
    normalizeIntakeDate({ receivedAt, dateHint: "昨天" });
    expect(normalizeIntakeDate(input)).toEqual(first);
  });
});
