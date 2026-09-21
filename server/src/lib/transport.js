"use strict";
/**
 * Outbound transports.
 *
 * Email and push both leave the building, so both are adapters with a memory
 * implementation for tests. Nothing else in the codebase knows whether the
 * mail actually went to SendGrid or into an array.
 *
 * Drivers:
 *   memory   records the payload, sends nothing. Tests and local development.
 *   sendgrid real mail. Requires SENDGRID_API_KEY.
 *   fcm      real Android push. Requires FCM_SERVER_KEY.
 *   none     silently drops. For a deploy that has not configured mail yet.
 */
const config = require("./../config");

class TransportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ---------------- memory ---------------- */

const sentEmails = [];
const sentPushes = [];

const memoryEmail = {
  name: "memory",
  async send({ to, subject, text, html }) {
    sentEmails.push({ to, subject, text, html, at: new Date() });
    return { ok: true, transport: "memory", id: `mem-${sentEmails.length}` };
  },
};

const memoryPush = {
  name: "memory",
  async send({ token, title, body, data }) {
    sentPushes.push({ token, title, body, data, at: new Date() });
    return { ok: true, transport: "memory", id: `mem-${sentPushes.length}` };
  },
};

/* ---------------- sendgrid ---------------- */

const sendgridEmail = {
  name: "sendgrid",
  async send({ to, subject, text, html }) {
    if (!config.mail.sendgridKey) {
      throw new TransportError("missing_key", "SENDGRID_API_KEY is not set.");
    }
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mail.sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: config.mail.from, name: "Kody" },
        subject,
        content: [
          { type: "text/plain", value: text },
          ...(html ? [{ type: "text/html", value: html }] : []),
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new TransportError("send_failed", `SendGrid returned ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { ok: true, transport: "sendgrid", id: res.headers.get("x-message-id") };
  },
};

/* ---------------- fcm ---------------- */

const fcmPush = {
  name: "fcm",
  async send({ token, title, body, data }) {
    if (!config.push.fcmKey) {
      throw new TransportError("missing_key", "FCM_SERVER_KEY is not set.");
    }
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${config.push.fcmKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: token, notification: { title, body }, data }),
    });
    if (!res.ok) {
      throw new TransportError("send_failed", `FCM returned ${res.status}`);
    }
    return { ok: true, transport: "fcm" };
  },
};

const noneTransport = (kind) => ({
  name: "none",
  async send() { return { ok: true, transport: "none", dropped: true, kind }; },
});

function emailTransport() {
  switch (config.mail.driver) {
    case "memory": return memoryEmail;
    case "sendgrid": return sendgridEmail;
    case "none": return noneTransport("email");
    default: throw new TransportError("unknown_driver", `Unknown MAIL_DRIVER: ${config.mail.driver}`);
  }
}

function pushTransport() {
  switch (config.push.driver) {
    case "memory": return memoryPush;
    case "fcm": return fcmPush;
    case "none": return noneTransport("push");
    default: throw new TransportError("unknown_driver", `Unknown PUSH_DRIVER: ${config.push.driver}`);
  }
}

module.exports = {
  TransportError, emailTransport, pushTransport,
  // test helpers
  sentEmails, sentPushes,
  clearSent() { sentEmails.length = 0; sentPushes.length = 0; },
};
