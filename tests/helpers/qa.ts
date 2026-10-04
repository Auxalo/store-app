import { it } from "vitest";

/**
 * A test for a bug the QA audit confirmed. It is written as the behaviour that SHOULD happen, and
 * marked "expected to fail" so the suite stays green while the bug exists. The day someone fixes
 * the bug, the test starts passing, which makes it fail as an unexpected pass: that is the signal
 * to change `knownBug(` back to `it(`.
 *
 * To see what actually goes wrong in each of them (and check they fail for the right reason), run
 * with `QA_UNPIN=1`:   QA_UNPIN=1 pnpm exec vitest run src/server/__tests__/qa-money.test.ts
 */
export const unpinned = process.env.QA_UNPIN === "1";
export const knownBug = unpinned ? it : it.fails;
