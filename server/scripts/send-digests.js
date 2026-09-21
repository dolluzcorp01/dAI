#!/usr/bin/env node
/**
 * Send the email digest to everyone with unread notifications.
 *
 *   node scripts/send-digests.js
 *   node scripts/send-digests.js --dry     report only
 *
 * Intended for cron, once a day:
 *   0 18 * * 1-5  cd /srv/kody/server && node scripts/send-digests.js >> /var/log/kody-digest.log 2>&1
 *
 * Safe to run twice: a notification already emailed is excluded, and
 * delivered_email is only set after the transport succeeds.
 */
const db = require("../src/db");
const config = require("../src/config");
const notify = require("../src/services/notifications.service");

(async () => {
  const dry = process.argv.includes("--dry");
  const started = Date.now();

  try {
    if (dry) {
      const [users] = await db.query(
        `SELECT DISTINCT n.user_id AS userId, u.email
           FROM notifications n
           JOIN notification_prefs p ON p.user_id = n.user_id
           JOIN users u ON u.id = n.user_id
          WHERE n.read_at IS NULL AND n.delivered_email = 0 AND p.email_digest = 1
            AND u.is_active = 1 AND u.deleted_at IS NULL`
      );
      console.log(`DRY RUN, transport ${config.mail.driver}`);
      for (const u of users) {
        const d = await notify.buildDigest(u.userId);
        if (!d || d.skipped) { console.log(`  skip  ${u.email}  ${d ? d.skipped : "no user"}`); continue; }
        console.log(`  send  ${u.email}  ${d.count} unread  "${d.subject}"`);
      }
      console.log(`\n${users.length} user(s) would be emailed. Re-run without --dry to send.`);
      return;
    }

    const out = await notify.sendAllDigests();
    const sent = out.results.filter(r => r.status === "sent").length;
    const failed = out.results.filter(r => r.status === "failed");
    console.log(`digest run: ${out.users} considered, ${sent} sent, ${failed.length} failed, ` +
                `${Date.now() - started}ms, transport ${config.mail.driver}`);
    for (const f of failed) console.error(`  failed for user ${f.userId}: ${f.detail}`);
    if (failed.length > 0) process.exitCode = 1;
  } catch (err) {
    console.error("digest run failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
