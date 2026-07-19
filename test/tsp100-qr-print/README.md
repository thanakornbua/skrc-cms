# TSP100IIILAN QR print test

Standalone script to test printing a QR code on a Star TSP100IIILAN printer over LAN.
Not part of the app build -- exploratory only.

## Setup

```
npm install
```

## Run

```
node print-qr.js <printer-ip> ["text to encode"]
```

or

```
PRINTER_IP=192.168.1.50 node print-qr.js
```

If the printer isn't found, check:
- The printer's IP address (print a self-test/status page from the printer, or check your router's DHCP client list).
- That your machine is on the same LAN/subnet as the printer.
- That TCP port 9100 is reachable (`nc -zv <ip> 9100` or `Test-NetConnection <ip> -Port 9100`).
- The printer's emulation mode is left at its default (StarLine/StarPRNT) -- this script does not use ESC/POS.
