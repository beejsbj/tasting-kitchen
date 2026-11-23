import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { harnessEnv } from "./child-env.mjs";
import { within } from "./files.mjs";
import { assertToolchainImage, runInToolchain } from "./toolchains.mjs";

/** The exit code (EX_TEMPFAIL) a toolchain check uses when Kitchen's equipment, not the output, failed. */
export const EQUIPMENT_FAILURE = 75;

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

async function runCheck(check, workspace, env, { image, imageError, dockerEnv } = {}) {
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
    if (imageError) return { passed: false, errored: true, detail: imageError };
    // A Recipe on a pinned toolchain is judged with that toolchain, read-only and offline,
    // so every model and layer is measured by the same FFmpeg, Node and fonts.
    const result = image
      ? await runInToolchain(image, check.argv, { workspace, processEnv: dockerEnv })
      : await runCommand(check.argv, workspace, env);
    // A validator killed by a signal never reached a verdict on the output. Nor did a
    // toolchain check that exits EQUIPMENT_FAILURE: Kitchen's own browser, decoder or a
    // wait on them failed. A check that imports the delivery's code could exit 75 too; that
    // can only turn a failure into a private, retryable fault, never into a Dish.
    const equipment = Boolean(image) && result.code === EQUIPMENT_FAILURE;
    return { passed: result.code === 0, ...(result.code === null || equipment ? { errored: true } : {}), detail: result.code === 0 ? "command exited 0" : equipment ? `command exited ${EQUIPMENT_FAILURE}: Kitchen's equipment failed during the check` : `command exited ${result.code ?? result.signal}`, stdout: result.stdout, stderr: result.stderr };
  }
  if (check.type === "json-schema") {
    // This contract currently has no schema checks. Refuse instead of pretending
    // that JSON parsing is equivalent to JSON Schema validation.
    await readFile(within(workspace, check.target));
    return { passed: false, errored: true, detail: "json-schema checks require an explicit validator adapter" };
  }
  return { passed: true, advisory: true, detail: `${check.type} is a human review cue and does not gate publication` };
}

export async function runChecks(recipe, workspace, { env = {} } = {}) {
  // Acceptance checks run the model's own code (a validator may import its logic): they get the allowlisted child environment, never the Kitchen's.
  const checkEnv = harnessEnv({ env });
  // The docker client is Kitchen's own process, not the model's code: it keeps the host's docker settings. The container still starts with no host environment.
  const dockerEnv = { ...process.env, ...env };
  const checks = [];
  // The image must be the one the current pin describes before it may judge.
  let imageError = null;
  if (recipe.toolchainRuntime && recipe.validation.checks.some((check) => check.type === "command")) {
    try { await assertToolchainImage(recipe.toolchainRuntime, { processEnv: dockerEnv }); }
    catch (error) { imageError = error.message; }
  }
  for (const check of recipe.validation.checks) {
    try {
      const result = await runCheck(check, workspace, checkEnv, { image: recipe.toolchainRuntime?.image, imageError, dockerEnv });
      checks.push({ id: check.id, type: check.type, required: check.required, description: check.description, ...result });
    } catch (error) {
      // The check itself could not run: that says nothing about the output.
      checks.push({ id: check.id, type: check.type, required: check.required, description: check.description, passed: false, errored: true, detail: error.message });
    }
  }
  return { passed: checks.every((check) => !check.required || check.passed), checks };
}
