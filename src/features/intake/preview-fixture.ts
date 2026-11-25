import type { IntakeEventV1 } from "@/lib/contracts/intake";

export const previewIntakeEvent: IntakeEventV1 = {
  eventId: "synthetic-intake",
  sender: "fixture@example.invalid",
  receivedAt: "2026-01-01T17:00:00Z",
  commonDateHint: "2025-12-30",
  items: [
    { kind: "photo", position: 0, dateHint: "2025-12-31" },
    { kind: "photo", position: 1 },
    { kind: "photo", position: 2, dateHint: "2025-12-30 或 2025-12-31" },
    { kind: "diary", position: 3, diaryText: "合成日记样本" },
  ],
};
