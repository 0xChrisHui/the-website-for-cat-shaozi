import { expect, it } from "vitest";
import { intakeEventStorageKey } from "./intake";

it("preserves existing stage0 event keys and isolates the same ID by verified source", () => {
  expect(intakeEventStorageKey("stage0-grok", "Message_6-Original")).toBe("Message_6-Original");
  expect(intakeEventStorageKey("dot", "Message_6-Original")).toBe("dot:Message_6-Original");
  expect(intakeEventStorageKey("mail-hook", "Message_6-Original")).toBe("mail-hook:Message_6-Original");
});

it("rejects delimiters and invalid values in either part of the stored key", () => {
  expect(() => intakeEventStorageKey("dot:secondary", "event-1")).toThrow();
  expect(() => intakeEventStorageKey("dot", "secondary:event-1")).toThrow();
  expect(() => intakeEventStorageKey("stage0-grok", "dot:event-1")).toThrow();
});
