#!/usr/bin/env node
/**
 * Import a code set from a CSV file.
 *
 *   node scripts/import-codes.js CARC ./carc-2026.csv --from 2026-01-01
 *   node scripts/import-codes.js CARC ./carc-2026.csv --from 2026-01-01 --apply
 *   node scripts/import-codes.js CARC ./carc-2026.csv --from 2026-01-01 --apply --retire-missing
 *
 * Dry run unless --apply is passed, because a bad import silently corrupts
 * every future tier 0 answer.
 *
 * Where the free sets come from:
 *   ICD-10-CM, HCPCS, POS   cms.gov
 *   CARC, RARC              x12.org
 *   CPT (AMA), CDT (ADA)    licensed. Record the licence first:
 *                           UPDATE org_settings SET setting_value='true'
 *                            WHERE setting_key='codes.licence.CPT';
 */
const fs = require("fs");
const path = require("path");
const db = require("../src/db");
const config = require("../src/config");
const importer = require("../src/services/codeimport.service");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--retire-missing") flags.retireMissing = true;
    else if (a === "--from") flags.from = argv[++i];
    else if (a === "--user") flags.user = Number(argv[++i]);
    else if (a.startsWith("--")) { console.error(`Unknown flag ${a}`); process.exit(1); }
    else positional.push(a);
  }
  return { positional, flags };
}

(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [codeSet, file] = positional;

  if (!codeSet || !file) {
    console.error("Usage: import-codes.js <CODE_SET> <file.csv> [--from YYYY-MM-DD] [--apply] [--retire-missing]");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(file, "utf8");
  const dryRun = !flags.apply;

  try {
    const out = await importer.importCodes(flags.user || null, {
      codeSet,
      csv,
      sourceName: path.basename(file),
      effectiveFrom: flags.from,
      dryRun,
      retireMissing: !!flags.retireMissing,
    });

    console.log(`\n${out.codeSet}  ${out.sourceName}  effective ${out.effectiveFrom}`);
    console.log(dryRun ? "DRY RUN, nothing written\n" : "APPLIED\n");
    console.log(`  parsed      ${out.parsed}`);
    console.log(`  added       ${out.added}${out.samples.added.length ? "   e.g. " + out.samples.added.join(", ") : ""}`);
    console.log(`  superseded  ${out.superseded}`);
    console.log(`  corrected   ${out.corrected}`);
    console.log(`  unchanged   ${out.unchanged}`);
    console.log(`  retired     ${out.retired}${out.samples.retired.length ? "   e.g. " + out.samples.retired.join(", ") : ""}`);
    console.log(`  skipped     ${out.skipped}`);
    if (dryRun) console.log("\nRe-run with --apply to write these changes.");
    else console.log(`\nimport id ${out.importId}`);
  } catch (err) {
    console.error(`\nImport failed: ${err.message}`);
    if (err.code === "licence_not_recorded") {
      console.error("This set is royalty bearing. Record the licence in org_settings first.");
    }
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
