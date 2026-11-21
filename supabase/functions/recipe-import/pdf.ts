// ARÔMES V&N · recipe-import : lecture et découpage de PDF avec pdf-lib (npm:pdf-lib), sans réseau ni base.
// Séparé de index.ts pour pouvoir être essayé hors de Deno.serve.
import { PDFDocument } from "npm:pdf-lib@1.17.1";

/** Erreur d'un PDF illisible ou inutilisable : le message est destiné à l'utilisateur (français). */
export class PdfError extends Error { }

const UNREADABLE = "Ce PDF n'a pas pu être lu (fichier abîmé ou protégé par un mot de passe).";

/** Vrai si le fichier commence par la signature « %PDF- » (dans ses 1024 premiers octets, comme les lecteurs). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!looksLikePdf(bytes)) throw new PdfError("Ce fichier n'est pas un PDF.");
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    console.error("pdf load", String((e as Error)?.message ?? e).slice(0, 200));
    throw new PdfError(UNREADABLE);
  }
}

/** Nombre de pages du PDF. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const n = (await load(bytes)).getPageCount();
  if (n < 1) throw new PdfError(UNREADABLE);
  return n;
}

/**
 * Nouveau PDF ne contenant que les pages demandées (numéros 1-based, dans l'ordre donné). Les numéros hors du document
 * sont ignorés ; si aucun ne reste, erreur.
 */
export async function extractPdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const total = src.getPageCount();
  const indices = [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= total).map((p) => p - 1);
  if (!indices.length) throw new PdfError("Les pages de cette recette ne figurent pas dans le PDF.");
  try {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    return await out.save();
  } catch (e) {
    console.error("pdf extract", String((e as Error)?.message ?? e).slice(0, 200));
    throw new PdfError("Les pages de cette recette n'ont pas pu être extraites du PDF.");
  }
}
