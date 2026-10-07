import { MongoBinary } from "mongodb-memory-server";

/**
 * Runs once, before any test file. The tests start their own in-memory MongoDB, which needs a
 * program file that is downloaded the first time (a fresh machine, a CI run with a cold cache).
 * If several test files start at the same moment they all try to download it at once, and the
 * download's lock breaks ("Cannot unlock file ... not locked by this process"). Fetching it here,
 * once, means every test file just finds it.
 */
export default async function setup() {
  await MongoBinary.getPath();
}
