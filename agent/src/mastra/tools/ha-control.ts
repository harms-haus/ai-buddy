import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { callService } from "home-assistant-js-websocket";
import { getHaConnection } from "./ha-connection.js";
import {
  getAgentConfig,
  resolveNickname,
  getEntityNicknames,
  buildDynamicDescription,
} from "./ha-config.js";

const VALID_COLORS = [
  "white",
  "warm white",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "cyan",
  "magenta",
];

export function createHaControlTool(agentId: string) {
  const agentConfig = getAgentConfig(agentId);
  const description = buildDynamicDescription(agentId);

  return createTool({
    id: "control-my-room",
    description,
    inputSchema: z.object({
      nickname: z
        .string()
        .describe(
          "The name of the thing to control, like 'ceiling-light' or 'fan'"
        ),
      action: z
        .enum(["turn_on", "turn_off", "toggle", "activate"])
        .describe(
          "What to do: turn_on, turn_off, toggle, or activate (for scenes)"
        ),
      brightness: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("How bright from 0 to 100. Only for lights."),
      color: z
        .string()
        .optional()
        .describe(
          "Color name like 'red', 'blue', 'green'. Only for lights that can change color."
        ),
    }),
    outputSchema: z.object({
      report: z
        .string()
        .describe("Kid-friendly confirmation or error message"),
    }),
    execute: async (inputData) => {
      try {
        // 1. Validate agent has config
        if (!agentConfig) {
          return {
            report:
              "I don't have any room devices set up yet! Ask a grown-up to help configure them.",
          };
        }

        // 2. Resolve nickname to entity config
        const normalizedNickname = inputData.nickname.toLowerCase().trim();
        const entityConfig = resolveNickname(agentId, normalizedNickname);

        if (!entityConfig) {
          const available = getEntityNicknames(agentId);
          const list = available.join(", ");
          return {
            report: `I don't know what "${inputData.nickname}" is. Try one of these: ${list}`,
          };
        }

        // 3. Validate action against entity type
        if (
          entityConfig.type === "scene" &&
          inputData.action !== "activate" &&
          inputData.action !== "turn_on"
        ) {
          return {
            report: `${entityConfig.description} is a special scene! I can only activate it for you.`,
          };
        }

        // 4. Get HA connection
        let connection;
        try {
          connection = await getHaConnection();
        } catch {
          return {
            report:
              "I can't connect to the house right now. Ask a grown-up for help!",
          };
        }

        // 5. Build and execute service call
        const domain = entityConfig.entity_id.split(".")[0];
        const entity_id = entityConfig.entity_id;
        const displayName = agentConfig.displayName;

        // Handle scenes
        if (entityConfig.type === "scene") {
          await callService(
            connection,
            "scene",
            "turn_on",
            {},
            { entity_id }
          );
          return {
            report: `Done! I activated ${entityConfig.description} in ${displayName}'s room. Enjoy!`,
          };
        }

        // Build service data for non-scene entities
        const serviceData: Record<string, any> = {};

        if (
          inputData.action === "turn_on" ||
          inputData.action === "toggle"
        ) {
          if (
            inputData.brightness !== undefined &&
            entityConfig.capabilities?.includes("brightness")
          ) {
            serviceData.brightness_pct = inputData.brightness;
          }

          if (
            inputData.color &&
            entityConfig.capabilities?.includes("color")
          ) {
            const normalizedColor = inputData.color.toLowerCase().trim();
            if (!VALID_COLORS.includes(normalizedColor)) {
              return {
                report: `I don't know that color. Try: ${VALID_COLORS.join(", ")}!`,
              };
            }
            serviceData.color_name = normalizedColor;
          }
        }

        let service: string;
        if (inputData.action === "toggle") {
          service = "toggle";
        } else {
          service = inputData.action;
        }

        await callService(
          connection,
          domain,
          service,
          serviceData,
          { entity_id }
        );

        // 6. Build success message
        const thing = entityConfig.description;
        let report: string;

        switch (inputData.action) {
          case "turn_on": {
            const extras: string[] = [];
            if (
              inputData.brightness !== undefined &&
              entityConfig.capabilities?.includes("brightness")
            ) {
              extras.push(`set to ${inputData.brightness}% brightness`);
            }
            if (
              inputData.color &&
              entityConfig.capabilities?.includes("color")
            ) {
              extras.push(`made it ${inputData.color}`);
            }
            const extraText =
              extras.length > 0 ? ` and ${extras.join(" and ")}` : "";
            report = `Done! I turned on ${thing}${extraText} in ${displayName}'s room.`;
            break;
          }
          case "turn_off":
            report = `Done! I turned off ${thing} in ${displayName}'s room.`;
            break;
          case "toggle":
            report = `Done! I toggled ${thing} in ${displayName}'s room.`;
            break;
          default:
            report = `Done! ${thing} in ${displayName}'s room.`;
        }

        return { report };
      } catch {
        return {
          report:
            "Hmm, something went wrong with the room controls. Let's try again in a little bit!",
        };
      }
    },
  });
}
