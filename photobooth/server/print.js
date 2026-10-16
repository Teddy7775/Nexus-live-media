import fs from 'node:fs/promises';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { printGeometry } from './templates.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const messageOf = (err) => (err instanceof Error ? err.message : String(err ?? 'unknown error'));

export class PrintError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrintError';
  }
}

/**
 * Wraps the print image in a PDF whose page is exactly the paper size (portrait).
 * Landscape canvases are rotated 90 degrees so they fill a portrait-fed 4x6 sheet.
 */
export async function buildPrintPdf({ imageFile, template, outFile }) {
  const geometry = printGeometry(template);
  let image = sharp(imageFile, { failOn: 'none' });
  if (geometry.rotate) image = image.rotate(90);
  const jpeg = await image.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([geometry.pageWidthPt, geometry.pageHeightPt]);
  const embedded = await pdf.embedJpg(jpeg);
  page.drawImage(embedded, { x: 0, y: 0, width: geometry.pageWidthPt, height: geometry.pageHeightPt });
  await fs.writeFile(outFile, await pdf.save());
  return { file: outFile, rotated: geometry.rotate, pageWidthPt: geometry.pageWidthPt, pageHeightPt: geometry.pageHeightPt };
}

/** Writes nothing to any printer; lets you rehearse the flow (and inspect the PDFs) without wasting paper. */
export class DryRunPrinter {
  constructor(cfg, { logger } = {}) {
    this.mode = 'dryrun';
    this.cfg = cfg;
    this.log = logger;
  }

  async listPrinters() {
    return [];
  }

  async status() {
    return { mode: this.mode, ok: true, detail: 'Dry run: print jobs are only saved as PDF files, nothing is sent to a printer' };
  }

  async print({ pdfFile, copies }) {
    await sleep(this.cfg.dryRunDelayMs);
    this.log?.info?.(`[dry run] would print ${copies} copy/copies of ${pdfFile}`);
    return { dryRun: true };
  }
}

/** Sends the PDF to a Windows printer through the print spooler (uses pdf-to-printer / SumatraPDF). */
export class WindowsPrinter {
  #lib = null;

  constructor(cfg, { logger, loader = () => import('pdf-to-printer') } = {}) {
    this.mode = 'windows';
    this.cfg = cfg;
    this.log = logger;
    this.loader = loader;
  }

  async #load() {
    if (!this.#lib) {
      const mod = await this.loader();
      // pdf-to-printer is CommonJS: from ESM its functions live on `default`.
      this.#lib = mod.default ?? mod;
    }
    return this.#lib;
  }

  async listPrinters() {
    try {
      return await (await this.#load()).getPrinters();
    } catch (err) {
      throw new PrintError(`Cannot list printers: ${messageOf(err)}`);
    }
  }

  async status() {
    try {
      const printers = await this.listPrinters();
      const found = printers.find((p) => p.name === this.cfg.name);
      if (!found) {
        const names = printers.map((p) => `"${p.name}"`).join(', ') || '(none found)';
        return { mode: this.mode, ok: false, detail: `Printer "${this.cfg.name}" not found. Installed printers: ${names}`, printers };
      }
      const sizeProblem = this.cfg.paperSize && !found.paperSizes.includes(this.cfg.paperSize) ? ` - but paper size "${this.cfg.paperSize}" is not one of its sizes` : '';
      return { mode: this.mode, ok: !sizeProblem, detail: `Printer "${found.name}" is installed${sizeProblem}`, printers, paperSizes: found.paperSizes };
    } catch (err) {
      return { mode: this.mode, ok: false, detail: messageOf(err), printers: [] };
    }
  }

  async print({ pdfFile, copies }) {
    const lib = await this.#load();
    const options = { printer: this.cfg.name, scale: this.cfg.scale, copies, silent: true };
    if (this.cfg.paperSize) options.paperSize = this.cfg.paperSize;
    try {
      // Resolves when the job has been handed to the Windows spooler - it cannot tell us about paper or ribbon problems.
      await lib.print(pdfFile, options);
    } catch (err) {
      throw new PrintError(`Printing failed: ${messageOf(err)}`);
    }
    return { dryRun: false };
  }
}

export function createPrinter(config, { logger, loader } = {}) {
  return config.printer.mode === 'windows' ? new WindowsPrinter(config.printer, { logger, loader }) : new DryRunPrinter(config.printer, { logger });
}
