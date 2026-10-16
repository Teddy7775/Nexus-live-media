// Lists the printers Windows knows about and the exact paper-size names each driver offers.
// Copy the printer name and (for photo strips) the "2 inch cut" paper size into config.json.
//
//   npm run printers

import printing from 'pdf-to-printer';

try {
  const printers = await printing.getPrinters();
  if (printers.length === 0) {
    console.log('No printers found. Install the printer driver, then run this again.');
  }
  for (const p of printers) {
    console.log(`\nPrinter name : "${p.name}"`);
    console.log('Paper sizes  :');
    for (const size of p.paperSizes) console.log(`   "${size}"`);
    if (p.paperSizes.length === 0) console.log('   (the driver did not report any)');
  }
  try {
    const def = await printing.getDefaultPrinter();
    if (def) console.log(`\nWindows default printer: "${def.name}"  (the booth never uses the default - it only prints to printer.name)`);
  } catch {
    /* no default printer set */
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Could not list printers: ${message}`);
  console.error('This only works on Windows (it asks the Windows print system).');
  process.exitCode = 1;
}
