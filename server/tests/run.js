#!/usr/bin/env node
"use strict";
/**
 * The test runner.
 *
 * This exists for one reason: to load tests/helpers/cleanup.mjs into every test
 * process, so a suite cannot leave rows behind by forgetting to tidy up. It has
 * to be NODE_OPTIONS rather than --import, because node --test runs each file in
 * a child process and --import on the parent does not reach them. NODE_OPTIONS
 * is inherited, so it does.
 *
 * It also expands the file list itself. The old script relied on the shell
 * expanding tests/*.test.js, which cmd.exe does not do, so on Windows that
 * silently ran nothing.
 *
 *   npm test                 every suite, with cleanup
 *   npm test -- chat kody    only suites whose name contains chat or kody
 *   npm run test:dirty       no cleanup, for inspecting what a failure left
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const TESTS = __dirname;
const args = process.argv.slice(2);
const filters = args.filter(a => !a.startsWith("-"));
// --dirty rather than an environment variable, because setting one inline in an
// npm script is not portable: cmd.exe does not take VAR=value prefixes.
const dirty = args.includes("--dirty") || process.env.KODY_TEST_NO_CLEANUP === "1";

const files = fs.readdirSync(TESTS)
  .filter(f => f.endsWith(".test.js"))
  .filter(f => filters.length === 0 || filters.some(q => f.includes(q)))
  .map(f => path.join("tests", f))
  .sort();

if (files.length === 0) {
  console.error(filters.length > 0
    ? `No suite matches ${filters.join(", ")}`
    : "No test files found.");
  process.exit(1);
}

const hook = pathToFileURL(path.join(TESTS, "helpers", "cleanup.mjs")).href;
const env = { ...process.env };
if (dirty) {
  env.KODY_TEST_NO_CLEANUP = "1";
} else {
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --import ${hook}`.trim();
}

const child = spawn(
  process.execPath,
  ["--env-file-if-exists=../.env", "--test", "--test-concurrency=1", ...files],
  { cwd: path.join(TESTS, ".."), env, stdio: "inherit" }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 1 : code);
});
