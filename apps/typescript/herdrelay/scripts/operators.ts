/**
 * Create and list named operator accounts.
 *
 *   npm run operators:add -- --username=marta --name="Marta Nowak"
 *   npm run operators:list
 *
 * The password is typed at a prompt and never echoed, never passed as an
 * argument (which would put it in shell history and in `ps`), and never stored
 * — only its scrypt hash and salt are written.
 */
import { createInterface } from "node:readline";
import {
  hashPassword,
  isValidUsername,
  loadOperators,
  operatorsFile,
  saveOperator,
} from "../lib/operators";

const ENTER = ["\r", "\n"];
const END_OF_TRANSMISSION = String.fromCharCode(4);
const INTERRUPT = String.fromCharCode(3);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

function flag(name: string): string | null {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

/** Read a line without echoing it. */
async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;

  if (!input.isTTY) {
    // Piped input, so `printf 'secret' | npm run operators:add ...` works in a
    // container or CI. Still never an argv value.
    const rl = createInterface({ input });
    for await (const line of rl) {
      rl.close();
      return line;
    }
    return "";
  }

  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  let secret = "";
  for await (const chunk of input) {
    const text = String(chunk);
    if (ENTER.includes(text) || text === END_OF_TRANSMISSION) break;
    if (text === INTERRUPT) {
      output.write("\n");
      process.exit(130);
    }
    if (BACKSPACE.includes(text)) {
      secret = secret.slice(0, -1);
      continue;
    }
    secret += text;
  }
  input.setRawMode(false);
  input.pause();
  output.write("\n");
  return secret;
}

async function list(): Promise<void> {
  const operators = await loadOperators();
  if (operators.length === 0) {
    console.log(`No operator accounts in ${operatorsFile()}.`);
    console.log('Create one with: npm run operators:add -- --username=marta --name="Marta Nowak"');
    return;
  }
  console.log(`${operators.length} operator account(s) in ${operatorsFile()}:\n`);
  for (const operator of operators) {
    console.log(`  ${operator.username.padEnd(20)} ${operator.name}`);
  }
}

async function add(): Promise<void> {
  const username = flag("username");
  const name = flag("name");
  if (!username || !name) {
    throw new Error('Usage: npm run operators:add -- --username=marta --name="Marta Nowak"');
  }
  if (!isValidUsername(username)) {
    throw new Error(
      "Username must be 2-32 characters of lowercase letters, digits, dot, dash or underscore.",
    );
  }

  const password = await readSecret(`Password for ${username}: `);
  if (password.length < 10) {
    throw new Error("Use a password of at least 10 characters.");
  }

  const { salt, hash } = await hashPassword(password);
  await saveOperator({ username, name, salt, hash });
  const saved = await loadOperators();

  console.log(`\nSaved ${username} (${name}) to ${operatorsFile()}.`);
  console.log("Sign in to the console with that username and password.");
  console.log("Approvals are now recorded against this person by name.");
  if (saved.length === 1) {
    console.log(
      "\nThis file is gitignored and holds a password hash, not a password. Back it up if losing it would lock you out.",
    );
  }
}

const command = process.argv.find((argument) => argument === "add" || argument === "list") ?? "list";

(command === "add" ? add() : list()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
