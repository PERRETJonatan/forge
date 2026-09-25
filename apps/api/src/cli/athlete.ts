import { createInterface } from "node:readline";
import { AuthError, createAthlete, MIN_PASSWORD_LENGTH, setPassword } from "../auth/auth.service.js";
import { prisma } from "../db.js";

/**
 * Operator tool for accounts -- there's no public signup. In the API container:
 *
 *   node dist/cli/athlete.js create <email> <name...>
 *   node dist/cli/athlete.js set-password <email>
 *
 * (`npm run athlete -- <command> ...` in dev.) The password is prompted for, hidden, so it never
 * lands in shell history or `ps`; piped stdin works too, for scripting.
 */

const USAGE = `Usage:
  athlete create <email> <name...>   Create an account (prompts for the password)
  athlete set-password <email>       Set a new password and sign out every session`;

/** Reads a line without echoing it when attached to a terminal. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      // Swallow readline's echo of each keystroke.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.question(process.stdin.isTTY ? "" : prompt, (answer) => {
      if (process.stdin.isTTY) process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function promptPassword(): Promise<string> {
  const password = await readSecret(`Password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if (process.stdin.isTTY) {
    const confirm = await readSecret("Repeat password: ");
    if (confirm !== password) throw new Error("Passwords don't match");
  }
  return password;
}

async function main(args: string[]): Promise<void> {
  const [command, email, ...rest] = args;
  if (command === "create" && email && rest.length > 0) {
    const athlete = await createAthlete(email.trim(), await promptPassword(), rest.join(" ").trim());
    console.log(`Created ${athlete.email} (${athlete.name}).`);
  } else if (command === "set-password" && email) {
    await setPassword(email.trim(), await promptPassword());
    console.log(`Password updated for ${email}; all of its sessions were signed out.`);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

main(process.argv.slice(2))
  .catch((err: unknown) => {
    console.error(err instanceof AuthError || err instanceof Error ? `Error: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
