"use strict";
/**
 * Malware scanning.
 *
 * Every upload lands as `pending` and is only served once it is `clean`. That
 * gate lives in the download handler; this module only decides the verdict.
 *
 * Two drivers:
 *   clamav  - talks to a real clamd over TCP using the INSTREAM protocol.
 *   local   - no antivirus engine available. Detects the EICAR test string,
 *             which is the industry standard harmless test file, so the
 *             infected path can actually be exercised in development and CI.
 *
 * `local` is NOT antivirus. Production must run clamav.
 */
const net = require("net");

/* The EICAR standard anti-malware test string, split so this file itself is
   not flagged by scanners. Every real engine detects the joined form. */
const EICAR = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR",
  "-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
].join("");

const VERDICT = { CLEAN: "clean", INFECTED: "infected", SKIPPED: "skipped" };

/** Reference implementation of clamd INSTREAM. Not exercised in CI. */
function scanWithClamav(buffer, { host, port, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let response = "";
    let settled = false;

    const done = (verdict, detail) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve({ verdict, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => done(VERDICT.SKIPPED, "scanner timeout"));
    socket.on("error", (err) => done(VERDICT.SKIPPED, `scanner unreachable: ${err.code || err.message}`));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.on("close", () => {
      if (settled) return;
      if (/\bOK\b/.test(response)) return done(VERDICT.CLEAN);
      if (/FOUND/.test(response)) return done(VERDICT.INFECTED, response.trim());
      done(VERDICT.SKIPPED, response.trim() || "no verdict");
    });

    socket.connect(port, host, () => {
      socket.write("zINSTREAM\0");
      // length-prefixed chunks, then a zero-length chunk to end the stream
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const slice = buffer.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}

function scanLocally(buffer) {
  const head = buffer.subarray(0, 4096).toString("latin1");
  if (head.includes(EICAR)) {
    return { verdict: VERDICT.INFECTED, detail: "Eicar-Test-Signature FOUND" };
  }
  return { verdict: VERDICT.CLEAN, detail: "local heuristic only, not antivirus" };
}

async function scan(buffer, config) {
  if (config.files.scanner === "clamav") {
    if (!config.files.clamavHost) {
      return { verdict: VERDICT.SKIPPED, detail: "CLAMAV_HOST not set" };
    }
    return scanWithClamav(buffer, {
      host: config.files.clamavHost,
      port: config.files.clamavPort,
    });
  }
  return scanLocally(buffer);
}

module.exports = { scan, VERDICT, EICAR, scanLocally, scanWithClamav };
