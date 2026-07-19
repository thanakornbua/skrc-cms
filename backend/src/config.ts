function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see docs/spec/ENV.md)`);
  }
  return value;
}

export const config = {
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-7",
  dynamoTable: process.env.DYNAMO_TABLE ?? "robo-compet",
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  get cognitoUserPoolId(): string {
    return required("COGNITO_USER_POOL_ID");
  },
  get cognitoClientId(): string {
    return required("COGNITO_CLIENT_ID");
  },
  get deviceKeys(): Record<string, string> {
    const raw = process.env.DEVICE_KEYS ?? "{}";
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new Error("DEVICE_KEYS env var is not valid JSON (see docs/spec/ENV.md)");
    }
  },
  // Operator decided a single lane at launch; entries are either "1" or
  // {"laneId":"1","deviceId":"esp32-lane1"} so the device mapping can be
  // added when hardware is provisioned without reshaping the var.
  get lanes(): Array<{ laneId: string; deviceId: string | null }> {
    const raw = process.env.LANES ?? '["1"]';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("LANES env var is not valid JSON (see docs/spec/ENV.md)");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("LANES env var must be a non-empty JSON array (see docs/spec/ENV.md)");
    }
    const lanes = parsed.map((entry) => {
      if (typeof entry === "string") return { laneId: entry, deviceId: null };
      if (!entry || typeof entry !== "object") {
        throw new Error("LANES entries must be a string laneId or {laneId, deviceId?}");
      }
      const obj = entry as { laneId?: unknown; deviceId?: unknown };
      if (typeof obj.laneId !== "string" || !obj.laneId) {
        throw new Error("LANES entries must be a string laneId or {laneId, deviceId?}");
      }
      return {
        laneId: obj.laneId,
        deviceId: typeof obj.deviceId === "string" ? obj.deviceId : null,
      };
    });
    const seen = new Set<string>();
    for (const lane of lanes) {
      if (seen.has(lane.laneId)) {
        throw new Error(`LANES contains duplicate laneId "${lane.laneId}"`);
      }
      seen.add(lane.laneId);
    }
    return lanes;
  },
};
