#!/usr/bin/env node
'use strict';

/**
 * Bypasses node-thermal-printer entirely: sends raw StarPRNT bytes
 * (init, some text, feed, full cut) straight over a TCP socket to port 9100.
 *
 * Use this to check whether ANY raw socket print reaches paper. If print-qr.js
 * says "sent successfully" but nothing comes out, and this script *also*
 * prints nothing, the problem is on the printer/network side, not in the
 * QR command bytes -- most likely one of:
 *   - Printer emulation is set to something other than default StarPRNT
 *     (check the printer's Configuration Utility / self-test page).
 *   - "Print Job Routing" (Star's raw-port passthrough setting) is disabled,
 *     so port 9100 accepts the bytes but never hands them to the print engine.
 *   - Paper out / cover open / an error state (check the status LED).
 *
 * Usage: node raw-text-test.js <printer-ip>
 */

const net = require('net');

const ip = process.argv[2] || process.env.PRINTER_IP;
const port = Number(process.env.PRINTER_PORT || 9100);

if (!ip) {
  console.error('Usage: node raw-text-test.js <printer-ip>');
  process.exit(1);
}

const HW_INIT = Buffer.from([0x1b, 0x40]);
const TXT_ALIGN_CT = Buffer.from([0x1b, 0x1d, 0x61, 0x01]);
const CTL_VT = Buffer.from([0x0b]);
const PAPER_FULL_CUT = Buffer.from([0x1b, 0x64, 0x02]);

const payload = Buffer.concat([
  HW_INIT,
  TXT_ALIGN_CT,
  Buffer.from('RAW TEST OK\n'),
  CTL_VT,
  CTL_VT,
  PAPER_FULL_CUT,
]);

const socket = net.connect({ host: ip, port, timeout: 5000 }, () => {
  socket.write(payload, () => {
    console.log(`Sent ${payload.length} raw bytes to ${ip}:${port}.`);
    socket.end();
  });
});

socket.on('close', () => process.exit(0));
socket.on('timeout', () => {
  console.error('Socket timeout.');
  socket.destroy();
  process.exit(1);
});
socket.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});
