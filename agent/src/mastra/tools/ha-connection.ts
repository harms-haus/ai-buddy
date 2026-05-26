import WS from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = WS;
}

import {
  createLongLivedTokenAuth,
  createConnection,
  type Connection,
} from "home-assistant-js-websocket";

let connection: Connection | null = null;
let connecting: Promise<Connection> | null = null;

export async function getHaConnection(): Promise<Connection> {
  if (connection) {
    return connection;
  }

  if (connecting) {
    return connecting;
  }

  const haUrl = process.env.HA_URL;
  const haToken = process.env.HA_TOKEN;

  if (!haUrl || !haToken) {
    throw new Error("HA_URL and HA_TOKEN environment variables are required");
  }

  console.log("[ha-connection] connecting to Home Assistant...");

  connecting = (async () => {
    try {
      const auth = createLongLivedTokenAuth(haUrl, haToken);
      const conn = await createConnection({ auth });

      conn.addEventListener("ready", () => {
        console.log("[ha-connection] connected to Home Assistant");
      });

      conn.addEventListener("disconnected", () => {
        console.log("[ha-connection] disconnected from Home Assistant");
      });

      conn.addEventListener("reconnect-error", (err: any) => {
        console.error("[ha-connection] reconnect error:", err?.message ?? "unknown error");
        if (connection === conn) {
          connection = null;
          connecting = null;
        }
      });

      connection = conn;
      connecting = null;
      return conn;
    } catch (err) {
      connection = null;
      connecting = null;
      throw err;
    }
  })();

  return connecting;
}

export async function resetHaConnection(): Promise<void> {
  if (connection) {
    const conn = connection;
    connection = null;
    connecting = null;
    try {
      await conn.close();
    } catch {
      // Ignore close errors — we're resetting anyway
    }
  }
  connection = null;
  connecting = null;
}
