import { readFile } from "node:fs/promises";
import path from "node:path";
import { LEGAL_DOCUMENTS, LegalDocumentKey } from "@/lib/legal/versions";

/** Reads a legal document from the repository root (read at build time by the static pages). */
export async function readLegalDocument(key: LegalDocumentKey) {
  const doc = LEGAL_DOCUMENTS[key];
  return { ...doc, source: await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), doc.file), "utf8") };
}
