# Test helpers

## cleanup.mjs

Every suite cleans up after itself, whether it remembers to or not.

`npm test` runs `tests/run.js`, which loads this into every test process through
`NODE_OPTIONS`. It notes the highest id in each table before the suite starts
and deletes anything above those marks when the suite finishes. Nothing in a
suite has to call it, which is the point: four suites had already failed on a
second run because they left rows behind, and each was fixed where it broke.

Two full runs now leave every row count unchanged.

### What it does not do

- **It does not undo changes to rows that already existed.** A suite that
  rewrites a seed user's password, flips a setting or backdates an existing row
  still has to put it back.
- **It does not cover tables without an auto-increment id.** Join tables with
  composite keys rely on the foreign key cascade from the parent row instead.
- **It needs `--test-concurrency=1`**, which `run.js` sets. With files running in
  parallel, one file's cleanup would delete another file's rows.
- **It is skipped if a test process is killed** or calls `process.exit`.

### Inspecting a failure

```
npm run test:dirty              everything, rows left in place
node tests/run.js chat --dirty  one suite, rows left in place
```

### A warning, from experience

This deletes rows. While it was being written, a mutation test replaced
`WHERE id > ?` with `WHERE id >= 0` to check that the guard was real, and ran it
against the development database. It emptied 33 of 47 tables, and the database
had to be rebuilt with `npm run migrate:fresh` and `npm run seed:passwords`.

A mutation of code that deletes things is not like a mutation of code that
returns things. Read what the mutation will do before running it, and if it is
destructive, do not run it against a database you want to keep.
