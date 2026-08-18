import { app, BrowserWindow, dialog, shell } from "electron";
import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Server } from "node:http";
import { SerialPort } from "serialport";

const APP_PORT = 7070;
let window: BrowserWindow | null = null;
let server: Server | null = null;
let serial: SerialPort | null = null;
let timers: NodeJS.Timeout[] = [];
let obsBridge: { outDir: string; stop(): void } | null = null;

/**
 * Mirrors everything the main process prints into a file.
 *
 * The API masks unexpected failures as INTERNAL_ERROR and prints the real
 * cause with console.error — invisible in a packaged application, which is a
 * console this operator does not have. Without this, a competition-day fault
 * reads as "Internal server error" and nothing else.
 *
 * Appends, so a crash and relaunch keep their history, and never throws: a
 * logging failure must not become the failure being logged.
 */
function teeConsoleToFile(): string {
  const logPath = join(app.getPath("userData"), "console.log");
  const write = (level: string, args: unknown[]) => {
    const text = args.map((value) => {
      if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(" ");
    appendFileSync(logPath, `${new Date().toISOString()} ${level} ${text}\n`);
  };
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try { write(level.toUpperCase(), args); } catch { /* never let logging fail the app */ }
    };
  }
  return logPath;
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

async function loadRuntimeConfiguration(): Promise<string> {
  const userConfig = join(app.getPath("userData"), "competition-day.env");
  const portableConfig = join(dirname(process.execPath), "competition-day.env");
  let selected = portableConfig;
  try { await readFile(portableConfig, "utf8"); }
  catch {
    selected = userConfig;
    try { await readFile(userConfig, "utf8"); }
    catch {
      await mkdir(dirname(userConfig), { recursive: true });
      const example = app.isPackaged
        ? join(process.resourcesPath, "competition-day.example.env")
        : resolve(app.getAppPath(), "competition-day.example.env");
      await copyFile(example, userConfig);
      throw new Error(`Configuration was created at ${userConfig}. Fill in AWS, Cognito, and device values, then restart.`);
    }
  }
  Object.assign(process.env, parseEnvFile(await readFile(selected, "utf8")));
  process.env.PORT = String(APP_PORT);
  process.env.CORS_ORIGIN ||= `http://127.0.0.1:${APP_PORT}`;
  // Credentials come from the operator's Cognito sign-in (see
  // backend/src/db/credentials.ts), not from a profile or a key on disk.
  process.env.AWS_SDK_LOAD_CONFIG = "1";
  return selected;
}

function frontendDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "frontend")
    : resolve(app.getAppPath(), "resources/frontend");
}

async function createDesktopWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#fdfbff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${APP_PORT}/`)) event.preventDefault();
  });
  window.on("closed", () => { window = null; });
  await window.loadURL(`http://127.0.0.1:${APP_PORT}/competition-day`);
  window.maximize();
  window.show();
}

/**
 * Drives the OBS overlay from this machine's own API.
 *
 * Bundled into the application rather than left as the `ops/` CLI so the
 * broadcast operator installs one thing: on competition day there is no Node
 * toolchain, no checkout, and no second console window on the laptop. The three
 * text files live under the writable user data directory — %APPDATA% — because
 * an installed application cannot write beside its EXE in Program Files.
 *
 * Failure here is never fatal: the overlay is a nice-to-have and the timing
 * console is not. `OBS_OVERLAY=off` in competition-day.env skips it entirely.
 */
async function startOverlayBridge(): Promise<void> {
  if (process.env.OBS_OVERLAY?.trim().toLowerCase() === "off") return;
  const outDir = process.env.OBS_OUT_DIR?.trim() || join(app.getPath("userData"), "obs");
  // A packaged application has no console the operator can read, so the
  // bridge's own account of itself goes in a file beside the text files it
  // writes. Blank overlay sources are otherwise indistinguishable from a
  // stopped API, a wrong port, or nobody signed in.
  const logPath = join(outDir, "bridge.log");
  const record = (level: string, message: string) => {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    console.log(line.trimEnd());
    appendFile(logPath, line).catch(() => { /* logging must never break the overlay */ });
  };
  try {
    const { startObsBridge } = await import("../../ops/src/obs-bridge-runner.js");
    obsBridge = await startObsBridge({
      apiUrl: `http://127.0.0.1:${APP_PORT}`,
      outDir,
      log: (message) => record("INFO", message),
      logError: (message) => record("WARN", message),
    });
  } catch (error) {
    record("ERROR", `OBS overlay bridge did not start: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function startServices(): Promise<void> {
  const [appModule, runModule, hardwareModule, gateModule, spoolModule, unoCore, configModule, credentialsModule] = await Promise.all([
    import("../../backend/src/app.js"),
    import("../../backend/src/runs/repo.js"),
    import("../../backend/src/hardware/repo.js"),
    import("../../backend/src/runs/repo.js"),
    import("../../ops/src/serial-bridge-core.js"),
    import("../../ops/src/uno-bridge-core.js"),
    import("../../backend/src/config.js"),
    import("../../backend/src/db/credentials.js"),
  ]);

  configModule.config.lanes;
  configModule.config.deviceKeys;
  const expressApp = appModule.createApp({ staticFrontendDir: frontendDirectory() });
  server = await new Promise<Server>((resolveServer, reject) => {
    const listening = expressApp.listen(APP_PORT, process.env.API_BIND_HOST?.trim() || "127.0.0.1", () => resolveServer(listening));
    listening.once("error", reject);
  });

  await startOverlayBridge();

  /**
   * True once DynamoDB can actually be reached. In identity-pool mode there are
   * no AWS credentials until a staff operator signs in — and they sign in
   * through the window that startup has not opened yet, so anything at boot
   * that assumes a working table deadlocks the application into "Startup
   * failed" before anyone can log in.
   */
  const canReachTable = (): boolean =>
    !credentialsModule.usesOperatorCredentials() || credentialsModule.hasOperatorCredentials();

  const sweep = async (): Promise<void> => {
    if (!canReachTable()) return;
    await runModule.sweepTimedOutRuns();
  };
  await sweep().catch(console.error);
  const sweepTimer = setInterval(() => { void sweep().catch(console.error); }, 1000);
  sweepTimer.unref(); timers.push(sweepTimer);

  const deviceId = process.env.UNO_DEVICE_ID ?? "uno-lane1";
  const laneId = process.env.UNO_LANE_ID ?? "1";
  const requestedPort = process.env.UNO_SERIAL_PORT?.trim();
  const available = await SerialPort.list();
  const portPath = requestedPort || available.find((port) =>
    /arduino|uno|com\d+/i.test(`${port.manufacturer ?? ""} ${port.path}`))?.path;
  const bridgeSession = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const spool = new spoolModule.DurableSpool(join(app.getPath("userData"), "serial-spool"));
  await spool.init();
  let sequence = 0;
  let buffer = "";
  let processing = Promise.resolve();
  let draining = false;

  const heartbeat = async (state: "CONNECTED" | "DISCONNECTED" | "ERROR", detail: string | null = null) => {
    // Same reason as the sweep: a heartbeat is a write, and there is nothing to
    // write with until an operator is signed in. The 10s timer re-reports the
    // real state once there is.
    if (!canReachTable()) return;
    await hardwareModule.recordDeviceHeartbeat({
      deviceId, laneId, serialPort: portPath ?? "AUTO", bridgeSession, state, detail,
      lastSeenAt: new Date().toISOString(),
    });
  };
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      for (const stored of await spool.pending()) {
        try {
          const result = await gateModule.processGateEvent(stored.event);
          await spool.finish(stored.event.eventId, "archive", result);
        } catch (error) {
          console.error("Pending gate event retained:", error);
          break;
        }
      }
    } finally { draining = false; }
  };
  // Gate events are persisted before delivery, so a network drop never loses a
  // time. Draining only on the next serial line, though, would leave a backlog
  // sitting on disk once connectivity returned — a lane that finished during
  // the outage would stay unrecorded until the next robot crossed the sensor.
  const drainTimer = setInterval(() => { void drain(); }, 5000);
  drainTimer.unref(); timers.push(drainTimer);

  const onLine = async (line: string) => {
    const parsed = unoCore.parseUnoLine(line, Math.floor(performance.now()) >>> 0);
    if (!parsed || parsed.command === "CLEAR") return;
    const laneState = await hardwareModule.getDeviceLaneState(deviceId, laneId);
    const type = unoCore.eventTypeForLane(laneState);
    if (!type) return;
    sequence += 1;
    const event = {
      eventId: `${deviceId}-${bridgeSession}-${sequence}`, deviceId, laneId,
      gateId: "finish-line", type, deviceTs: parsed.deviceTs,
    };
    await spool.persist(event);
    await drain();
  };

  if (!portPath) {
    await heartbeat("ERROR", "No Arduino COM port found").catch(console.error);
    const missingPortTimer = setInterval(
      () => { void heartbeat("ERROR", "No Arduino COM port found").catch(console.error); }, 10_000);
    missingPortTimer.unref(); timers.push(missingPortTimer);
  } else {
    serial = new SerialPort({ path: portPath, baudRate: 115200 });
    serial.on("open", () => heartbeat("CONNECTED").catch(console.error));
    serial.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 8192) buffer = buffer.slice(-2048);
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        processing = processing.then(() => onLine(line)).catch((error) => console.error("UNO line failed:", error));
      }
    });
    serial.on("error", (error) => heartbeat("ERROR", error.message).catch(console.error));
    serial.on("close", () => heartbeat("DISCONNECTED", "COM port closed").catch(console.error));
    const heartbeatTimer = setInterval(() => heartbeat("CONNECTED").catch(console.error), 10_000);
    heartbeatTimer.unref(); timers.push(heartbeatTimer);
  }
}

async function shutdown(): Promise<void> {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  obsBridge?.stop(); obsBridge = null;
  if (serial?.isOpen) await new Promise<void>((resolveClose) => serial!.close(() => resolveClose()));
  if (server) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // `window` outliving the BrowserWindow it points at is normal — Electron
  // destroys the native window on close and leaves the reference behind. Every
  // use has to say so, or launching a second copy of the application crashes
  // the first with "Object has been destroyed".
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    try {
      console.log(`SKRC Competition Day starting — logging to ${teeConsoleToFile()}`);
      await loadRuntimeConfiguration();
      await startServices();
      await createDesktopWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dialog.showMessageBox({ type: "error", title: "SKRC Competition Day", message: "Startup failed", detail: message });
      app.quit();
    }
  });
  app.on("before-quit", (event) => {
    if (!server && !serial) return;
    event.preventDefault();
    const closingServer = server; const closingSerial = serial;
    server = null; serial = null;
    obsBridge?.stop(); obsBridge = null;
    for (const timer of timers) clearInterval(timer);
    timers = [];
    Promise.all([
      closingSerial?.isOpen ? new Promise<void>((resolveClose) => closingSerial.close(() => resolveClose())) : Promise.resolve(),
      closingServer ? new Promise<void>((resolveClose) => closingServer.close(() => resolveClose())) : Promise.resolve(),
    ]).finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
