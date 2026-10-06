"use strict";
/**
 * What is allowed to be in the repository.
 *
 * On 2026-10-05 a 13.2 MB tarball and a 653 KB checksum manifest were committed,
 * because the commit staged the whole working tree and the build artefacts from
 * the install-elsewhere route were sitting in it. Every clone pays for that
 * forever, and the person who found it was the one whose `git pull` tried to
 * overwrite the files he had just copied to the server.
 *
 * A habit cannot be relied on, so this is a test. It covers the two things that
 * matter: nothing large, and nothing that is a secret or a build artefact.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO = path.join(__dirname, "..", "..");

/** Every tracked file, from git rather than from the filesystem. */
function trackedFiles() {
  // Rule 7: a check that cannot run is inconclusive, never a pass. If git is
  // not here, this fails rather than quietly passing.
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

const sizeOf = (rel) => {
  try { return fs.statSync(path.join(REPO, rel)).size; } catch (_) { return 0; }
};

describe("nothing large is tracked", () => {
  // The largest legitimate file is prototypes/kody_prototype_v10.jsx at about
  // 200 KB, which is the visual source of truth and belongs here. A megabyte
  // leaves room for a prototype to grow and still catches an archive.
  const LIMIT = 1024 * 1024;

  test(`no tracked file is over ${LIMIT / 1024} KB`, () => {
    const big = trackedFiles()
      .map(f => ({ f, size: sizeOf(f) }))
      .filter(x => x.size > LIMIT)
      .map(x => `${x.f} (${Math.round(x.size / 1024)} KB)`);

    assert.deepEqual(big, [],
      "a repository is not a place to put build output. If one of these is "
      + "genuinely source, raise the limit on purpose rather than by accident.");
  });
});

describe("nothing secret or generated is tracked", () => {
  test("no archives, keys or environment files", () => {
    const forbidden = /\.(tgz|tar|tar\.gz|zip|7z|pem|key|p12|pfx|crt|sha256)$|(^|\/)\.env($|\.)/i;

    // .env.example is the point: a template of every key with empty values, so
    // nobody has to guess what a real .env needs. It is tracked on purpose.
    const allowed = new Set([".env.example"]);

    const offenders = trackedFiles().filter(f => forbidden.test(f) && !allowed.has(f));
    assert.deepEqual(offenders, [],
      "archives and checksum manifests are build output; keys and .env files are secrets");
  });

  test("the files that would hurt most are specifically not tracked", () => {
    // Named rather than left to the pattern above, because these three are the
    // ones where being wrong is expensive: the signing key decides the
    // extension's identity, and the env files hold every secret the app has.
    const tracked = new Set(trackedFiles());
    for (const f of [".env", "deploy/.env.production", "extension/key.pem"]) {
      assert.ok(!tracked.has(f), `${f} is tracked, and must never be`);
    }
  });

  test("and .gitignore actually covers them", () => {
    // Being untracked today is not the same as being safe tomorrow: the next
    // `git add` that sweeps the tree would take them.
    const ignore = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8");
    for (const pattern of [".env", "key.pem", "node_modules"]) {
      assert.match(ignore, new RegExp(pattern.replace(".", "\\.")),
        `.gitignore says nothing about ${pattern}`);
    }
  });
});

describe("shell scripts are executable, and agree on one env file", () => {
  /** Mode as git records it, which is what a fresh clone gets. */
  function modeOf(rel) {
    const out = execFileSync("git", ["ls-files", "-s", rel], { cwd: REPO, encoding: "utf8" });
    return out.trim().split(/\s+/)[0] || null;
  }

  test("deploy scripts carry the execute bit in git", () => {
    // Setting it on one machine is not enough: git stores the mode, and a
    // clone without it fails with "Permission denied" on the first run. That
    // is how the first real deploy stopped.
    for (const script of ["deploy/deploy.sh", "deploy/backup.sh"]) {
      assert.equal(modeOf(script), "100755", `${script} is not executable in a fresh clone`);
    }
  });

  test("every script reads the same env file", () => {
    // backup.sh wanted .env.production in deploy/, while deploy.sh, pm2 and the
    // application all read .env at the root. Step 1e creates only .env, so the
    // first deploy could not work. One filename.
    const backup = fs.readFileSync(path.join(REPO, "deploy/backup.sh"), "utf8");
    const deploy = fs.readFileSync(path.join(REPO, "deploy/deploy.sh"), "utf8");
    const pm2 = fs.readFileSync(path.join(REPO, "ecosystem.config.js"), "utf8");

    const code = (src) => src
      .split(/\r?\n/)
      .filter(line => !/^\s*[#/]/.test(line))
      .join(" | ");

    assert.ok(!/\.env\.production/.test(code(backup)),
      "backup.sh still wants .env.production, which nothing else creates");
    assert.match(code(backup), /ENV_FILE/, "and it should be overridable");
    assert.match(code(deploy), /\$APP_DIR\/\.env/);
    assert.match(code(pm2), /--env-file-if-exists=.*\.env/);
  });
});

describe("node_modules is not tracked anywhere", () => {
  test("not the directory, not an archive of it", () => {
    const offenders = trackedFiles().filter(f => /(^|\/)node_modules(\/|\.|$)/.test(f));
    assert.deepEqual(offenders, [],
      "node_modules is installed, not committed, even when it is copied between machines");
  });
});
