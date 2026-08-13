import { app, BrowserWindow, dialog, shell } from "electron";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Server } from "node:http";
import { SerialPort } from "serialport";

const APP_PORT = 3210;
let window: BrowserWindow | null = null;
let server: Server | null = null;
let serial: SerialPort | null = null;
let timers: NodeJS.Timeout[] = [];

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
  await window.loadURL(`http://127.0.0.1:${APP_PORT}/competition-day`);
  window.maximize();
  window.show();
}

async function startServices(): Promise<void> {
  const [appModule, runModule, hardwareModule, gateModule, spoolModule, unoCore, configModule] = await Promise.all([
    import("../../backend/src/app.js"),
    import("../../backend/src/runs/repo.js"),
    import("../../backend/src/hardware/repo.js"),
    import("../../backend/src/runs/repo.js"),
    import("../../ops/src/serial-bridge-core.js"),
    import("../../ops/src/uno-bridge-core.js"),
    import("../../backend/src/config.js"),
  ]);

  configModule.config.lanes;
  configModule.config.deviceKeys;
  const expressApp = appModule.createApp({ staticFrontendDir: frontendDirectory() });
  server = await new Promise<Server>((resolveServer, reject) => {
    const listening = expressApp.listen(APP_PORT, process.env.API_BIND_HOST?.trim() || "127.0.0.1", () => resolveServer(listening));
    listening.once("error", reject);
  });

  await runModule.sweepTimedOutRuns();
  const sweepTimer = setInterval(() => runModule.sweepTimedOutRuns().catch(console.error), 1000);
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
    await heartbeat("ERROR", "No Arduino COM port found");
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
  const drainTimer = setInterval(() => drain().catch(console.error), 500);
  drainTimer.unref(); timers.push(drainTimer);
}

async function shutdown(): Promise<void> {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  if (serial?.isOpen) await new Promise<void>((resolveClose) => serial!.close(() => resolveClose()));
  if (server) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    try {
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
    for (const timer of timers) clearInterval(timer);
    timers = [];
    Promise.all([
      closingSerial?.isOpen ? new Promise<void>((resolveClose) => closingSerial.close(() => resolveClose())) : Promise.resolve(),
      closingServer ? new Promise<void>((resolveClose) => closingServer.close(() => resolveClose())) : Promise.resolve(),
    ]).finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
