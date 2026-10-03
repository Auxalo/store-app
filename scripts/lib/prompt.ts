/** Small helpers for the command-line tasks: --flags, and one line from the keyboard. */

export function parseFlags(argv = process.argv.slice(2)): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i++;
    } else flags.set(arg.slice(2), "true");
  }
  return flags;
}

/** One line from the keyboard. With `hidden`, nothing is shown while typing. */
export function ask(question: string, hidden = false): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error(
      `Missing "${question.trim()}". Run this in a terminal, or pass the values as --flags.`,
    );
    process.exit(1);
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done();
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0 && !hidden) process.stdout.write("\b \b");
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
          if (!hidden) process.stdout.write(char);
        }
      }
    };
    stdin.on("data", onData);
  });
}
