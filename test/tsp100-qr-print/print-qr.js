#!/usr/bin/env node
'use strict';

/**
 * Test script: print a QR code on a Star TSP100IIILAN printer over LAN.
 *
 * The TSP100IIILAN's default emulation is StarLine/StarPRNT (not ESC/POS), so this
 * uses node-thermal-printer's "star" driver, which speaks that native command set
 * directly over TCP port 9100 -- no emulation switch needed on the printer.
 *
 * Usage:
 *   node print-qr.js <printer-ip> ["text to encode"]
 *   PRINTER_IP=192.168.1.50 node print-qr.js
 *
 * Setup:
 *   npm install
 */

const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const ip = process.argv[2] || process.env.PRINTER_IP;
const qrText = process.argv[3] || process.env.PRINTER_QR_TEXT || 'https://skrc-robo-compet.test/hello';
const port = process.env.PRINTER_PORT || '9100';

if (!ip) {
  console.error('Missing printer IP.\nUsage: node print-qr.js <printer-ip> ["text to encode"]\nOr set PRINTER_IP env var.');
  process.exit(1);
}

async function main() {
  const printer = new ThermalPrinter({
    type: PrinterTypes.STAR,
    interface: `tcp://${ip}:${port}`,
    width: 48,
  });

  // Note: deliberately not calling printer.isPrinterConnected() here first. The
  // TSP100IIILAN's raw port only accepts one TCP connection at a time; opening and
  // closing a probe connection right before the real print connection races the
  // printer's listener and reliably causes ECONNREFUSED on the print connection.

  printer.alignCenter();
  printer.println('QR test print');
  printer.newLine();
  printer.printQR(qrText, { cellSize: 6, correction: 'M', model: 2 });
  printer.newLine();
  printer.println(qrText);
  printer.cut();

  try {
    await printer.execute();
    console.log('Print job sent successfully.');
  } catch (err) {
    console.error('Print failed:', err);
    process.exit(1);
  }
}

main();
