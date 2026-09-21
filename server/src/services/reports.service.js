"use strict";
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const db = require("../db");
const V = require("../lib/validate");
const analytics = require("./analytics.service");
const { audit } = require("./auth.service");

/**
 * Reports.
 *
 * One rule shapes this module: a report containing message content is an
 * export of PHI. Those reports are refused unless the organisation has
 * explicitly allowed content export, and every run is recorded with who asked,
 * over what range, how many rows, and whether content left.
 */

class ReportError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * The report catalogue. `containsContent` is the important column: it decides
 * whether the export needs the organisation to have opted in.
 */
const REPORTS = {
  usage_by_person: {
    title: "Usage by person",
    containsContent: false,
    columns: ["Name", "Email", "Team", "Questions", "Tier 0 lookups", "Helpful votes", "Points"],
    async rows({ from, to }) {
      const people = await analytics.byPerson({ from, to });
      return people.map(p => [p.fullName, p.email, p.team || "", p.questions, p.lookups, p.helpfulVotes, p.points]);
    },
  },

  questions_by_domain: {
    title: "Questions by domain",
    containsContent: false,
    columns: ["Domain", "Answers", "Low confidence", "Low confidence share"],
    async rows() {
      const rows = await analytics.byDomain();
      return rows.map(r => [
        r.domain, r.n, r.lowConfidence,
        r.n ? `${Math.round((r.lowConfidence / r.n) * 100)}%` : "0%",
      ]);
    },
  },

  unanswered: {
    // The question text is the point of this report, and a question an
    // associate typed can itself carry claim detail.
    title: "Unanswered questions",
    containsContent: true,
    columns: ["Question", "Domain", "Times asked", "Low confidence", "Without a document"],
    async rows() {
      const rows = await analytics.unanswered({ limit: 50 });
      return rows.map(r => [r.question, r.domain, r.asked, r.lowConfidence, r.withoutDocument]);
    },
  },

  sme_queue: {
    title: "SME queue and resolutions",
    containsContent: true,
    columns: ["Status", "Question", "Domain", "Model", "Tier", "Raised by", "Resolved by", "Raised", "Resolved"],
    async rows({ from, to }) {
      const params = [];
      let range = "";
      if (from) { range += " AND q.created_at >= ?"; params.push(from + " 00:00:00"); }
      if (to)   { range += " AND q.created_at <= ?"; params.push(to + " 23:59:59"); }
      const [rows] = await db.query(
        `SELECT q.status, q.created_at AS createdAt, q.resolved_at AS resolvedAt,
                m.domain, m.model_name AS model, m.tier,
                (SELECT body FROM kody_messages u
                  WHERE u.thread_id = m.thread_id AND u.role = 'user' AND u.id < m.id
                  ORDER BY u.id DESC LIMIT 1) AS question,
                r.full_name AS raisedBy, a.full_name AS resolvedBy
           FROM sme_queue q
           JOIN kody_messages m ON m.id = q.kody_message_id
           LEFT JOIN users r ON r.id = q.raised_by
           LEFT JOIN users a ON a.id = q.assigned_to
          WHERE 1=1 ${range}
          ORDER BY q.created_at DESC LIMIT 1000`,
        params
      );
      return rows.map(r => [
        r.status, r.question || "", r.domain || "", r.model || "tier 0", r.tier,
        r.raisedBy || "", r.resolvedBy || "",
        r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "",
        r.resolvedAt ? new Date(r.resolvedAt).toISOString().slice(0, 10) : "",
      ]);
    },
  },

  model_spend: {
    title: "Model usage by tier and model",
    containsContent: false,
    columns: ["Tier", "Model", "Answers", "Input tokens", "Output tokens", "Median latency ms"],
    async rows() {
      const [rows] = await db.query(
        `SELECT tier, COALESCE(model_name, 'none') AS model, COUNT(*) AS n,
                COALESCE(SUM(input_tokens),0) AS inTok,
                COALESCE(SUM(output_tokens),0) AS outTok,
                AVG(latency_ms) AS avgMs
           FROM kody_messages
          WHERE role = 'assistant' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY tier, model_name ORDER BY tier`
      );
      return rows.map(r => [
        r.tier, r.model, Number(r.n), Number(r.inTok), Number(r.outTok),
        r.avgMs ? Math.round(Number(r.avgMs)) : 0,
      ]);
    },
  },

  audit_export: {
    title: "Audit log",
    containsContent: false,
    columns: ["When", "Action", "Actor", "Entity", "Entity id", "IP"],
    async rows({ from, to }) {
      const params = [];
      let range = "";
      if (from) { range += " AND a.created_at >= ?"; params.push(from + " 00:00:00"); }
      if (to)   { range += " AND a.created_at <= ?"; params.push(to + " 23:59:59"); }
      const [rows] = await db.query(
        `SELECT a.created_at AS at, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                a.ip_address AS ip, u.full_name AS actor
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE 1=1 ${range}
          ORDER BY a.created_at DESC LIMIT 5000`,
        params
      );
      return rows.map(r => [
        new Date(r.at).toISOString().replace("T", " ").slice(0, 19),
        r.action, r.actor || "system", r.entityType || "", r.entityId || "",
        r.ip ? Array.from(r.ip).join(".") : "",
      ]);
    },
  },
};

async function contentExportAllowed() {
  const row = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'reports.allow_content_export'`
  );
  return !!row && row.v === "true";
}

function catalogue() {
  return Object.entries(REPORTS).map(([code, r]) => ({
    code, title: r.title, containsContent: r.containsContent, columns: r.columns,
  }));
}

/* ---------------- writers ---------------- */

async function toXlsx({ title, columns, rows, meta }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kody by Dolluz Corp";
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31));

  ws.addRow([title]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} by ${meta.by}`]);
  if (meta.from || meta.to) ws.addRow([`Range ${meta.from || "start"} to ${meta.to || "today"}`]);
  ws.addRow([]);

  const headerRow = ws.addRow(columns);
  headerRow.font = { bold: true };
  headerRow.eachCell(c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } };
  });

  rows.forEach(r => ws.addRow(r));
  columns.forEach((c, i) => {
    const longest = Math.max(
      String(c).length,
      ...rows.slice(0, 200).map(r => String(r[i] === null || r[i] === undefined ? "" : r[i]).length)
    );
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 60);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf({ title, columns, rows, meta }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title);
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor("#667085")
      .text(`Kody by Dolluz Corp. Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} by ${meta.by}.`);
    if (meta.from || meta.to) doc.text(`Range ${meta.from || "start"} to ${meta.to || "today"}.`);
    doc.text(`${rows.length} row${rows.length === 1 ? "" : "s"}.`);
    doc.moveDown(0.6);
    doc.fillColor("#101828");

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const lineHeight = 14;

    const header = () => {
      doc.fontSize(8).fillColor("#667085");
      columns.forEach((c, i) => {
        doc.text(String(c), doc.page.margins.left + i * colWidth, doc.y, {
          width: colWidth - 6, continued: false, lineBreak: false,
        });
        if (i < columns.length - 1) doc.moveUp();
      });
      doc.moveDown(0.4);
      doc.fillColor("#101828");
    };

    header();
    // 300 rows is enough for a circulated document; the spreadsheet is the
    // format for anything larger.
    for (const row of rows.slice(0, 300)) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - lineHeight * 2) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
        header();
      }
      const y = doc.y;
      doc.fontSize(8);
      row.forEach((cell, i) => {
        doc.text(String(cell === null || cell === undefined ? "" : cell),
          doc.page.margins.left + i * colWidth, y, {
            width: colWidth - 6, height: lineHeight, ellipsis: true, lineBreak: false,
          });
      });
      doc.y = y + lineHeight;
    }

    if (rows.length > 300) {
      doc.moveDown(0.6).fontSize(8).fillColor("#667085")
        .text(`${rows.length - 300} further rows omitted. Export as a spreadsheet for the full set.`);
    }
    doc.end();
  });
}

/* ---------------- entry point ---------------- */

async function generate(userId, { code, format = "xlsx", from, to }, ctx = {}) {
  const report = REPORTS[code];
  if (!report) throw new ReportError(404, "unknown_report", `No report named ${code}.`);
  const fmt = V.oneOf(format, "format", ["xlsx", "pdf"]);

  for (const [name, value] of [["from", from], ["to", to]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new V.ValidationError(`${name} must be a date like 2026-09-01.`, name);
    }
  }

  if (report.containsContent && !(await contentExportAllowed())) {
    throw new ReportError(403, "content_export_blocked",
      "This report contains message text, which can be PHI. " +
      "An administrator must allow content export before it can be produced.");
  }

  const user = await db.one(`SELECT full_name AS fullName FROM users WHERE id = ?`, [userId]);
  const rows = await report.rows({ from, to });
  const meta = { by: (user && user.fullName) || "unknown", from, to };

  const buffer = fmt === "xlsx"
    ? await toXlsx({ title: report.title, columns: report.columns, rows, meta })
    : await toPdf({ title: report.title, columns: report.columns, rows, meta });

  await db.query(
    `INSERT INTO report_runs (report_code, format, requested_by, range_from, range_to,
                              row_count, contains_content)
     VALUES (?,?,?,?,?,?,?)`,
    [code, fmt, userId, from || null, to || null, rows.length, report.containsContent ? 1 : 0]
  );
  await audit(null, {
    actorId: userId, action: "report.exported", entityType: "report", entityId: null,
    ip: ctx.ip, userAgent: ctx.userAgent,
    meta: { code, format: fmt, rows: rows.length, containsContent: report.containsContent, from, to },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `kody-${code}-${stamp}.${fmt}`,
    contentType: fmt === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf",
    rowCount: rows.length,
  };
}

async function history({ limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT r.id, r.report_code AS code, r.format, r.row_count AS rowCount,
            r.contains_content AS containsContent, r.range_from AS rangeFrom,
            r.range_to AS rangeTo, r.created_at AS createdAt, u.full_name AS requestedBy
       FROM report_runs r LEFT JOIN users u ON u.id = r.requested_by
      ORDER BY r.created_at DESC LIMIT ?`,
    [lim]
  );
  return rows.map(r => ({ ...r, containsContent: !!r.containsContent, rowCount: Number(r.rowCount) }));
}

module.exports = { ReportError, REPORTS, catalogue, generate, history, contentExportAllowed, toXlsx, toPdf };
