import { BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";

export interface DeviceHeartbeat {
  deviceId: string;
  laneId: string;
  serialPort: string;
  bridgeSession: string;
  state: "CONNECTED" | "DISCONNECTED" | "ERROR";
  detail: string | null;
  lastSeenAt: string;
}

export async function getDeviceLaneState(deviceId: string, laneId: string): Promise<string> {
  const configured = config.lanes.find((lane) => lane.laneId === laneId);
  if (!configured || (configured.deviceId && configured.deviceId !== deviceId)) {
    throw new ApiError(403, "FORBIDDEN", "Device is not configured for this lane");
  }
  const response = await ddbDoc.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `LANE#${laneId}`, SK: "STATE" },
    ConsistentRead: true,
  }));
  return String(response.Item?.state ?? "IDLE");
}

export async function recordDeviceHeartbeat(heartbeat: DeviceHeartbeat): Promise<void> {
  const configured = config.lanes.find((lane) => lane.laneId === heartbeat.laneId);
  if (!configured || (configured.deviceId && configured.deviceId !== heartbeat.deviceId)) {
    throw new ApiError(403, "FORBIDDEN", "Device is not configured for this lane");
  }
  await ddbDoc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `DEVICE#${heartbeat.deviceId}`, SK: "STATUS", ...heartbeat },
  }));
}

export async function listHardwareStatus(): Promise<Array<DeviceHeartbeat & { online: boolean }>> {
  const devices = [...new Set(config.lanes.map((lane) => lane.deviceId).filter((id): id is string => Boolean(id)))];
  if (devices.length === 0) return [];
  const response = await ddbDoc.send(new BatchGetCommand({
    RequestItems: {
      [TABLE_NAME]: {
        Keys: devices.map((deviceId) => ({ PK: `DEVICE#${deviceId}`, SK: "STATUS" })),
        ConsistentRead: true,
      },
    },
  }));
  const records = (response.Responses?.[TABLE_NAME] ?? []) as Array<DeviceHeartbeat & { PK: string; SK: string }>;
  const byDevice = new Map(records.map((record) => [record.deviceId, record]));
  const now = Date.now();
  return devices.map((deviceId) => {
    const record = byDevice.get(deviceId);
    const laneId = config.lanes.find((lane) => lane.deviceId === deviceId)?.laneId ?? "";
    const fallback: DeviceHeartbeat = {
      deviceId, laneId, serialPort: "", bridgeSession: "", state: "DISCONNECTED",
      detail: "No heartbeat received", lastSeenAt: "",
    };
    const value = record ?? fallback;
    return {
      deviceId: value.deviceId,
      laneId: value.laneId,
      serialPort: value.serialPort,
      bridgeSession: value.bridgeSession,
      state: value.state,
      detail: value.detail,
      lastSeenAt: value.lastSeenAt,
      online: value.state === "CONNECTED" && Number.isFinite(Date.parse(value.lastSeenAt)) &&
        now - Date.parse(value.lastSeenAt) < 30_000,
    };
  });
}
