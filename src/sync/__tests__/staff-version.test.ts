import { describe, expect, it } from "vitest";
import {
  currentStaffVersion,
  markStaffRead,
  noteStaffVersion,
  staffVersionMoved,
} from "../staff-version";

describe("staff version", () => {
  it("says the list changed only after the server's number moved since it was read", () => {
    expect(staffVersionMoved()).toBe(false); // nothing heard yet
    noteStaffVersion(3);
    expect(staffVersionMoved()).toBe(true); // heard, never read
    markStaffRead(currentStaffVersion());
    expect(staffVersionMoved()).toBe(false);
    noteStaffVersion(3);
    expect(staffVersionMoved()).toBe(false); // same number again
    noteStaffVersion(4);
    expect(staffVersionMoved()).toBe(true); // a person or PIN changed
  });

  it("ignores an older server that sends no number, and a list that was fetched before a later change", () => {
    noteStaffVersion(undefined);
    expect(currentStaffVersion()).toBe(4);
    const readAt = currentStaffVersion(); // the list fetched now is version 4...
    noteStaffVersion(5); // ...but the server moved on while it was loading
    markStaffRead(readAt);
    expect(staffVersionMoved()).toBe(true); // so it is read again
  });
});
