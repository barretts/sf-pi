/* SPDX-License-Identifier: Apache-2.0 */
/** A bounded original-text query observation; never a policy or sensitivity result. */
import { createRequire } from "node:module";
import type { SOQLParser as SOQLParserType } from "@salesforce/soql-common";
import type { JevSoqlQueryShape } from "./types.ts";

const require = createRequire(import.meta.url);
const MAX_INPUT_BYTES = 512;
const MAX_SOURCE_CHARACTERS = 80;
const MAX_QUERY_LIMIT = 2000;
const SIMPLE_ID_QUERY =
  /^[ \t\r\n]*SELECT[ \t\r\n]+Id[ \t\r\n]+FROM[ \t\r\n]+([A-Za-z_][A-Za-z0-9_]*)[ \t\r\n]+LIMIT[ \t\r\n]+([1-9][0-9]{0,3})[ \t\r\n]*$/i;

export function observeJevSoqlQueryShape(query: string): JevSoqlQueryShape | undefined {
  if (Buffer.byteLength(query) > MAX_INPUT_BYTES) return;
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(query)) return;
  // Match before trimming or normalization. No Unicode whitespace, comments, or extra clauses.
  const match = SIMPLE_ID_QUERY.exec(query);
  if (!match || match[1].length > MAX_SOURCE_CHARACTERS) return;
  const queryLimit = Number(match[2]);
  if (queryLimit > MAX_QUERY_LIMIT) return;
  try {
    // Load the existing CommonJS SDK only after the bounded original-text match.
    const { SOQLParser } = require("@salesforce/soql-common") as {
      SOQLParser: typeof SOQLParserType;
    };
    const parsed = SOQLParser({
      isApex: true,
      isMultiCurrencyEnabled: true,
      apiVersion: 67.0,
    }).parseQuery(query);
    if (!parsed.getSuccess() || parsed.getParserErrors().length) return;
  } catch {
    // Parser faults and local syntax rejection remain unknown. Never emit query-bearing errors.
    return;
  }
  return {
    projection: "single_Id",
    sourceCount: 1,
    queryLimit,
    otherClauses: false,
    sourceSpelling: "withheld",
    sensitivity: "unknown",
  };
}
