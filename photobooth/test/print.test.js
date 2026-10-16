import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { DryRunPrinter, PrintError, WindowsPrinter, buildPrintPdf, createPrinter } from '../server/print.js';
import { PrintQueue } from '../server/printQueue.js';
import { builtinTemplates } from '../server/templates.js';
import { waitFor } from './helpers.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'print-test-'));
const template = (id) => builtinTemplates().find((t) => t.id === id);

async function pdfSize(file) {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  return [Math.round(width * 100) / 100, Math.round(height * 100) / 100];
}

async function image(dir, name, width, height) {
  const file = path.join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: '#223344' } }).jpeg().toFile(file);
  return file;
}

test('print PDF for the strip sheet is exactly 4x6 inches portrait (288 x 432 pt)', async () => {
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'p.pdf');
    const info = await buildPrintPdf({ imageFile: await image(dir, 'a.jpg', 1200, 1800), template: template('strip-2x6-x2'), outFile: out });
    assert.equal(info.rotated, false);
    assert.deepEqual(await pdfSize(out), [288, 432]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a landscape single photo is rotated so it still fills a portrait 4x6 page', async () => {
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'p.pdf');
    const info = await buildPrintPdf({ imageFile: await image(dir, 'a.jpg', 1800, 1200), template: template('single-4x6'), outFile: out });
    assert.equal(info.rotated, true);
    assert.deepEqual(await pdfSize(out), [288, 432]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run printer reports itself clearly and never touches hardware', async () => {
  const printer = new DryRunPrinter({ dryRunDelayMs: 5 });
  assert.equal((await printer.status()).ok, true);
  assert.match((await printer.status()).detail, /Dry run/);
  assert.deepEqual(await printer.listPrinters(), []);
  assert.deepEqual(await printer.print({ pdfFile: 'x.pdf', copies: 2 }), { dryRun: true });
});

test('createPrinter picks the backend from config', () => {
  assert.equal(createPrinter({ printer: { mode: 'dryrun', dryRunDelayMs: 0 } }).mode, 'dryrun');
  assert.equal(createPrinter({ printer: { mode: 'windows', name: 'X' } }, { loader: async () => ({}) }).mode, 'windows');
});

// ---- Windows backend, against a stand-in for pdf-to-printer (the real one only runs on Windows)

function fakeLib({ printers = [{ deviceId: 'd', name: 'DNP DS620', paperSizes: ['4x6', '(2x6) 2x6*2'] }], printImpl } = {}) {
  const calls = [];
  const lib = {
    getPrinters: async () => printers,
    print: async (file, options) => {
      calls.push({ file, options });
      if (printImpl) return printImpl(file, options);
      return undefined;
    },
  };
  return { calls, loader: async () => ({ default: lib }) }; // pdf-to-printer exposes its API on `default` from ESM
}

test('windows printer: passes printer name, paper size, scale, copies and silent mode through', async () => {
  const { calls, loader } = fakeLib();
  const printer = new WindowsPrinter({ name: 'DNP DS620', paperSize: '(2x6) 2x6*2', scale: 'fit' }, { loader });
  await printer.print({ pdfFile: 'C:\\booth\\print.pdf', copies: 2 });
  assert.deepEqual(calls, [{ file: 'C:\\booth\\print.pdf', options: { printer: 'DNP DS620', scale: 'fit', copies: 2, silent: true, paperSize: '(2x6) 2x6*2' } }]);
});

test('windows printer: with no paperSize configured it leaves the driver default alone', async () => {
  const { calls, loader } = fakeLib();
  await new WindowsPrinter({ name: 'DNP DS620', paperSize: '', scale: 'fit' }, { loader }).print({ pdfFile: 'p.pdf', copies: 1 });
  assert.equal('paperSize' in calls[0].options, false);
});

test('windows printer: errors that are not Error objects (pdf-to-printer rejects with strings) become readable PrintErrors', async () => {
  const { loader } = fakeLib({ printImpl: async () => Promise.reject('The printer is offline') });
  const printer = new WindowsPrinter({ name: 'DNP DS620', scale: 'fit' }, { loader });
  await assert.rejects(printer.print({ pdfFile: 'p.pdf', copies: 1 }), (err) => err instanceof PrintError && /The printer is offline/.test(err.message));
});

test('windows printer status: installed, wrong name (lists what IS installed), and wrong paper size', async () => {
  const { loader } = fakeLib();
  assert.equal((await new WindowsPrinter({ name: 'DNP DS620', paperSize: '' }, { loader }).status()).ok, true);

  const wrongName = await new WindowsPrinter({ name: 'DS620', paperSize: '' }, { loader }).status();
  assert.equal(wrongName.ok, false);
  assert.match(wrongName.detail, /not found.*"DNP DS620"/);

  const wrongSize = await new WindowsPrinter({ name: 'DNP DS620', paperSize: '2x6' }, { loader }).status();
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.detail, /paper size "2x6" is not one of its sizes/);
});

test('windows printer status never throws even if listing printers fails', async () => {
  const printer = new WindowsPrinter({ name: 'X' }, { loader: async () => ({ default: { getPrinters: async () => Promise.reject('Platform not supported') } }) });
  const status = await printer.status();
  assert.equal(status.ok, false);
  assert.match(status.detail, /Platform not supported/);
});

// ---- Queue

function controllablePrinter() {
  const started = [];
  const gates = [];
  return {
    started,
    release: (i, err) => gates[i](err),
    printer: {
      print: ({ pdfFile }) =>
        new Promise((resolve, reject) => {
          started.push(pdfFile);
          gates.push((err) => (err ? reject(err) : resolve()));
        }),
    },
  };
}

test('queue prints one job at a time, in order, and reports queue depth', async () => {
  const { printer, started, release } = controllablePrinter();
  const queue = new PrintQueue(printer);
  const a = queue.enqueue({ sessionId: 's', pdfFile: 'a.pdf' });
  const b = queue.enqueue({ sessionId: 's', pdfFile: 'b.pdf' });
  await waitFor(() => started.length === 1);
  assert.deepEqual(started, ['a.pdf'], 'second job must wait');
  assert.equal(queue.get(a.id).status, 'printing');
  assert.equal(queue.get(b.id).status, 'queued');
  assert.equal(queue.pending(), 2);

  release(0);
  await waitFor(() => started.length === 2);
  assert.equal(queue.get(a.id).status, 'done');
  release(1);
  await waitFor(() => queue.get(b.id).status === 'done');
  assert.equal(queue.pending(), 0);
});

test('a failed print is recorded and does not block the jobs behind it', async () => {
  const { printer, started, release } = controllablePrinter();
  const queue = new PrintQueue(printer);
  const a = queue.enqueue({ sessionId: 's', pdfFile: 'a.pdf' });
  const b = queue.enqueue({ sessionId: 's', pdfFile: 'b.pdf' });
  await waitFor(() => started.length === 1);
  release(0, new PrintError('Printing failed: out of paper'));
  await waitFor(() => started.length === 2);
  assert.equal(queue.get(a.id).status, 'error');
  assert.match(queue.get(a.id).error, /out of paper/);
  release(1);
  await waitFor(() => queue.get(b.id).status === 'done');
});

test('queue keeps only the most recent finished jobs', async () => {
  const queue = new PrintQueue({ print: async () => {} }, { keep: 3 });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    ids.push(queue.enqueue({ sessionId: 's', pdfFile: `${i}.pdf` }).id);
    await waitFor(() => queue.get(ids[i])?.status === 'done');
  }
  assert.ok(queue.list().length <= 4);
  assert.equal(queue.get(ids[0]), null, 'oldest job was dropped');
  assert.ok(queue.get(ids[5]));
});
