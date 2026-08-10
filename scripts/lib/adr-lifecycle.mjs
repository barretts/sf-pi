/* SPDX-License-Identifier: Apache-2.0 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const ADR_STATUSES = Object.freeze([
  "proposed",
  "accepted",
  "rejected",
  "withdrawn",
  "superseded",
]);

const STATUS_SET = new Set(ADR_STATUSES);
const FRONTMATTER_KEYS = new Set([
  "id",
  "status",
  "date",
  "supersedes",
  "supersededBy",
  "implementedBy",
]);
const ADR_FILE_PATTERN = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/;
const ADR_ID_PATTERN = /^\d{4}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function parseScalar(file, field, value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "string") fail(file, `${field} must be a string`);
      return parsed;
    } catch (error) {
      fail(file, `${field} is not a valid quoted string: ${error.message}`);
    }
  }
  return trimmed;
}

function parseArray(file, field, value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    fail(file, `${field} must be a JSON-style string array: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item)) {
    fail(file, `${field} must be a JSON-style string array`);
  }
  if (new Set(parsed).size !== parsed.length) {
    fail(file, `${field} contains duplicate values`);
  }
  return parsed;
}

function parseFrontmatter(file, source) {
  if (!source.startsWith("---\n")) {
    fail(file, "must start with YAML frontmatter");
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    fail(file, "has unterminated YAML frontmatter");
  }

  const metadata = {};
  for (const line of source.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/);
    if (!match) fail(file, `invalid frontmatter line: ${line}`);
    const [, field, value] = match;
    if (!FRONTMATTER_KEYS.has(field)) fail(file, `unknown frontmatter field ${field}`);
    if (Object.prototype.hasOwnProperty.call(metadata, field)) {
      fail(file, `duplicate frontmatter field ${field}`);
    }
    metadata[field] = ["supersedes", "supersededBy", "implementedBy"].includes(field)
      ? parseArray(file, field, value)
      : parseScalar(file, field, value);
  }

  return { metadata, body: source.slice(end + 5) };
}

function normalizeTitle(file, body, id) {
  const match = body.match(/^#\s+(.+)$/m);
  if (!match) fail(file, "must contain one H1 title after frontmatter");
  const title = match[1].replace(new RegExp(`^ADR\\s+${id}:\\s*`, "i"), "").trim();
  if (!title) fail(file, "ADR title must not be empty");
  return title;
}

function validateDate(file, date) {
  if (!DATE_PATTERN.test(date)) fail(file, `invalid date "${date}"`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(file, `invalid date "${date}"`);
  }
}

function validateLegacyStatus(file, body) {
  const lines = body.split("\n");
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const firstContent = lines.slice(titleIndex + 1).find((line) => line.trim().length > 0) ?? "";
  if (/^##\s+Status\s*$/i.test(firstContent) || /^Status:\s*/i.test(firstContent)) {
    fail(file, "contains legacy status metadata outside frontmatter");
  }
}

export function loadAdrRecords(adrDir) {
  const records = readdirSync(adrDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ADR_FILE_PATTERN.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const filenameMatch = entry.name.match(ADR_FILE_PATTERN);
      const filenameId = filenameMatch[1];
      const source = readFileSync(path.join(adrDir, entry.name), "utf8");
      const { metadata, body } = parseFrontmatter(entry.name, source);

      for (const required of ["id", "status", "date"]) {
        if (typeof metadata[required] !== "string" || !metadata[required]) {
          fail(entry.name, `missing required frontmatter field ${required}`);
        }
      }
      if (!ADR_ID_PATTERN.test(metadata.id)) {
        fail(entry.name, `invalid id "${metadata.id}"`);
      }
      if (metadata.id !== filenameId) {
        fail(
          entry.name,
          `frontmatter id "${metadata.id}" does not match filename id "${filenameId}"`,
        );
      }
      if (!STATUS_SET.has(metadata.status)) {
        fail(entry.name, `invalid status "${metadata.status}"`);
      }
      validateDate(entry.name, metadata.date);
      validateLegacyStatus(entry.name, body);

      return {
        id: metadata.id,
        status: metadata.status,
        date: metadata.date,
        supersedes: metadata.supersedes ?? [],
        supersededBy: metadata.supersededBy ?? [],
        implementedBy: metadata.implementedBy ?? [],
        title: normalizeTitle(entry.name, body, metadata.id),
        filename: entry.name,
      };
    });

  if (records.length === 0) {
    throw new Error("No ADR files found");
  }

  const byId = new Map();
  for (const record of records) {
    if (byId.has(record.id)) {
      throw new Error(
        `Duplicate ADR id ${record.id}: ${byId.get(record.id).filename}, ${record.filename}`,
      );
    }
    byId.set(record.id, record);
  }

  for (const record of records) {
    if (record.status === "superseded" && record.supersededBy.length === 0) {
      throw new Error(`ADR ${record.id} with status superseded must declare supersededBy`);
    }
    if (record.status !== "superseded" && record.supersededBy.length > 0) {
      throw new Error(`ADR ${record.id} may declare supersededBy only when status is superseded`);
    }

    for (const field of ["supersedes", "supersededBy"]) {
      for (const relatedId of record[field]) {
        if (!ADR_ID_PATTERN.test(relatedId)) {
          throw new Error(`ADR ${record.id} ${field} contains invalid ADR id ${relatedId}`);
        }
        if (relatedId === record.id) {
          throw new Error(`ADR ${record.id} cannot ${field} itself`);
        }
        if (!byId.has(relatedId)) {
          throw new Error(`ADR ${record.id} ${field} references missing ADR ${relatedId}`);
        }
      }
    }
  }

  for (const record of records) {
    for (const relatedId of record.supersedes) {
      const related = byId.get(relatedId);
      if (!related.supersededBy.includes(record.id)) {
        throw new Error(
          `ADR ${record.id} supersedes ${relatedId} is not reciprocated by ADR ${relatedId} supersededBy`,
        );
      }
    }
    for (const relatedId of record.supersededBy) {
      const related = byId.get(relatedId);
      if (!related.supersedes.includes(record.id)) {
        throw new Error(
          `ADR ${record.id} supersededBy ${relatedId} is not reciprocated by ADR ${relatedId} supersedes`,
        );
      }
    }
  }

  return records;
}

function link(record) {
  return `[${record.id}: ${record.title}](./${record.filename})`;
}

function renderRecords(records, byId, emptyMessage) {
  if (records.length === 0) return [emptyMessage];
  return records.map((record) => {
    const replacements = record.supersededBy.map((id) => `[ADR ${id}](./${byId.get(id).filename})`);
    const suffix = replacements.length > 0 ? ` — superseded by ${replacements.join(", ")}` : "";
    return `- ${link(record)} — ${record.date}${suffix}`;
  });
}

export function renderAdrIndex(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const accepted = records.filter((record) => record.status === "accepted");
  const proposed = records.filter((record) => record.status === "proposed");
  const historical = ["superseded", "rejected", "withdrawn"];
  const labels = { superseded: "Superseded", rejected: "Rejected", withdrawn: "Withdrawn" };
  const lines = [
    "# Architecture Decision Records",
    "",
    "<!-- GENERATED by scripts/generate-catalog.mjs from ADR frontmatter. Do not edit by hand. -->",
    "",
    "ADRs preserve durable architectural rationale. Runtime code and Behavior Proofs remain the authority for implemented behavior. Dates are the records' original Git creation dates.",
    "",
    "## Current",
    "",
    ...renderRecords(accepted, byId, "_No accepted ADRs._"),
    "",
    "## Proposed",
    "",
    ...renderRecords(proposed, byId, "_No proposed ADRs._"),
    "",
    "## Historical",
  ];

  for (const status of historical) {
    lines.push(
      "",
      `### ${labels[status]}`,
      "",
      ...renderRecords(
        records.filter((record) => record.status === status),
        byId,
        `_No ${status} ADRs._`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}
