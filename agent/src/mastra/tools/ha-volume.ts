import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { callService, getStates } from "home-assistant-js-websocket";
import { getHaConnection } from "./ha-connection.js";
import { getAgentConfig } from "./ha-config.js";
import type { HaEntityConfig } from "./ha-types.js";

function buildVolumeToolDescription(agentId: string): string {
  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) {
    return "Control the speaker volume. No volume-controllable speakers are configured yet.";
  }

  const hasVolumeEntity = Object.values(agentConfig.entities).some(
    (entity) => entity.type === "media_player" && entity.unit_entity_id
  );

  if (!hasVolumeEntity) {
    return "Control the speaker volume. No volume-controllable speakers are configured yet.";
  }

  const displayName = agentConfig.displayName;
  const volumeNicknames = Object.entries(agentConfig.entities)
    .filter(([, e]) => e.type === "media_player" && e.unit_entity_id)
    .map(([key]) => key);

  const lines = [
    `Control the speaker volume in ${displayName}'s room! ${displayName} can:`,
    "Set the volume to a specific level (0–10, where 0 is silent and 10 is max).",
    "Make the music louder or quieter by a number of steps (1–10).",
    "Mute or unmute the speaker.",
  ];
  if (volumeNicknames.length > 1) {
    lines.push(`Available speakers: ${volumeNicknames.map(n => `"${n}"`).join(', ')}`);
  }
  lines.push(`Just say something like "set it to 5" or "turn it up" or "make it quieter".`);
  return lines.join('\n');
}

function resolveVolumeEntity(
  agentId: string,
  nickname?: string
): { mediaPlayer: HaEntityConfig; unitEntityId: string } | null {
  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) return null;

  let entity: HaEntityConfig | undefined;

  if (nickname && nickname.trim() !== "") {
    const normalized = nickname.toLowerCase().trim();
    const match = Object.entries(agentConfig.entities).find(
      ([key]) => key.toLowerCase() === normalized
    );
    entity = match?.[1];
  } else {
    entity = Object.values(agentConfig.entities).find(
      (e) => e.type === "media_player"
    );
  }

  if (!entity || !entity.unit_entity_id) return null;

  return { mediaPlayer: entity, unitEntityId: entity.unit_entity_id };
}

export function createHaVolumeTool(agentId: string) {
  const description = buildVolumeToolDescription(agentId);

  return createTool({
    id: "control-volume",
    description,
    inputSchema: z
      .object({
        increase: z
          .number()
          .min(0)
          .max(10)
          .int()
          .optional()
          .describe(
            "How much to turn up the volume, from 0 to 10. Each step adds about 10% volume."
          ),
        decrease: z
          .number()
          .min(0)
          .max(10)
          .int()
          .optional()
          .describe(
            "How much to turn down the volume, from 0 to 10. Each step removes about 10% volume."
          ),
        set_volume: z
          .number()
          .min(0)
          .max(10)
          .int()
          .optional()
          .describe(
            "Set the volume to a specific level, from 0 to 10. 0 is silent, 10 is maximum volume. Use this when the user wants a specific volume number like 'set volume to 8' or 'turn it to 3'."
          ),
        mute: z
          .boolean()
          .optional()
          .describe(
            "Set to true to mute the speaker, or false to unmute it."
          ),
        nickname: z
          .string()
          .optional()
          .describe(
            "Which speaker to adjust. If not specified, uses the default speaker."
          ),
      })
      .refine(
        (data) => {
          const count = [data.increase, data.decrease, data.mute, data.set_volume].filter(
            (v) => v !== undefined
          ).length;
          return count === 1;
        },
        { message: "Exactly one of increase, decrease, mute, or set_volume must be provided" }
      ),
    outputSchema: z.object({
      report: z.string().describe("Kid-friendly confirmation or error message"),
    }),
    execute: async (inputData) => {
      try {
        // 1. Get display name
        const agentConfig = getAgentConfig(agentId);
        const displayName = agentConfig?.displayName ?? "your";

        // 2. Get HA connection
        let connection;
        try {
          connection = await getHaConnection();
        } catch {
          return {
            report:
              "I can't connect to the speaker right now. Ask a grown-up for help!",
          };
        }

        // 3. Resolve volume entity
        const resolved = resolveVolumeEntity(agentId, inputData.nickname);
        if (!resolved) {
          return {
            report:
              "I don't have a speaker set up for volume control yet! Ask a grown-up to help configure it.",
          };
        }

        // 4. Mute action
        if (inputData.mute !== undefined) {
          await callService(
            connection,
            "media_player",
            "volume_mute",
            { is_volume_muted: inputData.mute },
            { entity_id: resolved.unitEntityId }
          );
          return {
            report: `Done! I ${inputData.mute ? "muted" : "unmuted"} the speaker in ${displayName}'s room.`,
          };
        }

        // 4.5. Set absolute volume
        if (inputData.set_volume !== undefined) {
          const newPct = inputData.set_volume * 10; // 0-10 → 0-100%
          await callService(
            connection,
            "media_player",
            "volume_set",
            { volume_level: newPct / 100 },
            { entity_id: resolved.unitEntityId }
          );
          if (inputData.set_volume === 0) {
            return {
              report: `Done! I turned the speaker all the way off in ${displayName}'s room.`,
            };
          }
          if (inputData.set_volume === 10) {
            return {
              report: `Done! I turned the speaker all the way up in ${displayName}'s room!`,
            };
          }
          return {
            report: `Done! I set the speaker in ${displayName}'s room to volume ${inputData.set_volume}.`,
          };
        }

        // 5. Increase / decrease
        const states = await getStates(connection);
        const entityState = states.find(
          (s) => s.entity_id === resolved.unitEntityId
        );
        const currentLevel =
          (entityState as any)?.attributes?.volume_level ?? 0;
        const currentPct = Math.round(currentLevel * 100);

        const delta =
          (inputData.increase ?? 0) * 10 - (inputData.decrease ?? 0) * 10;
        const newPct = Math.max(0, Math.min(100, currentPct + delta));

        await callService(
          connection,
          "media_player",
          "volume_set",
          { volume_level: newPct / 100 },
          { entity_id: resolved.unitEntityId }
        );

        if (newPct === currentPct && delta > 0) {
          return {
            report: `The speaker is already at max volume in ${displayName}'s room!`,
          };
        }
        if (newPct === currentPct && delta < 0) {
          return {
            report: `The speaker is already as quiet as it can be in ${displayName}'s room!`,
          };
        }
        if (inputData.increase !== undefined) {
          return {
            report: `Done! I turned up the speaker in ${displayName}'s room.`,
          };
        }
        // decrease
        return {
          report: `Done! I turned down the speaker in ${displayName}'s room.`,
        };
      } catch {
        return {
          report:
            "Hmm, something went wrong with the volume. Let's try again in a little bit!",
        };
      }
    },
  });
}
