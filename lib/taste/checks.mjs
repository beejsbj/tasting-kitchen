import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { within } from "./files.mjs";

function runCommand(argv, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${chunk}`.slice(-65536);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function runCheck(check, workspace, env) {
  if (check.type === "file-exists") {
    try {
      const info = await stat(within(workspace, check.target, `check ${check.id} target`));
      return { passed: info.isFile() || info.isDirectory(), detail: `${check.target} exists` };
    } catch (error) {
      if (error?.code === "ENOENT") return { passed: false, detail: `${check.target} does not exist` };
      throw error;
    }
  }
  if (check.type === "command") {
    const result = await runCommand(check.argv, workspace, env);
    return { passed: result.code === 0, detail: result.code === 0 ? "command exited 0" : `command exited ${result.code ?? result.signal}`, stdout: result.stdout, stderr: result.stderr };
  }
  if (check.type === "json-schema") {
    // This contract currently has no schema checks. Refuse instead of pretending
    // that JSON parsing is equivalent to JSON Schema validation.
    await readFile(within(workspace, check.target));
    return { passed: false, detail: "json-schema checks require an explicit validator adapter" };
  }
  return { passed: true, advisory: true, detail: `${check.type} is a human review cue and does not gate publication` };
}

export async function runChecks(recipe, workspace, { env = process.env } = {}) {
  const checks = [];
  for (const check of recipe.validation.checks) {
    try {
      const result = await runCheck(check, workspace, env);
      checks.push({ id: check.id, type: check.type, required: check.required, description: check.description, ...result });
    } catch (error) {
      checks.push({ id: check.id, type: check.type, required: check.required, description: check.description, passed: false, detail: error.message });
    }
  }
  return { passed: checks.every((check) => !check.required || check.passed), checks };
}
