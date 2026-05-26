import { getHaConnection } from "./ha-connection.js";
import { getAgentConfig } from "./ha-config.js";
import type { HaEntityConfig } from "./ha-types.js";

let cachedConfigEntryId: string | null | undefined = undefined;

export async function getMaConfigEntryId(): Promise<string | null> {
  if (cachedConfigEntryId !== undefined) {
    return cachedConfigEntryId;
  }

  try {
    const conn = await getHaConnection();
    const entries = await conn.sendMessagePromise<
      Array<{ entry_id: string; domain: string }>
    >({ type: "config_entries/get" });

    const entry = entries.find((e) => e.domain === "music_assistant");
    if (!entry) {
      cachedConfigEntryId = null;
      return null;
    }

    cachedConfigEntryId = entry.entry_id;
    return cachedConfigEntryId;
  } catch (err) {
    cachedConfigEntryId = undefined;
    throw err;
  }
}

export function buildMusicToolDescription(agentId: string): string {
  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) {
    return "Play and control music. No music players are configured yet.";
  }

  const mediaPlayers = Object.entries(agentConfig.entities).filter(
    ([, entity]) => entity.type === "media_player"
  );

  if (mediaPlayers.length === 0) {
    return "Play and control music. No music players are configured yet.";
  }

  const displayName = agentConfig.displayName;
  const lines: string[] = [
    `Play and control music in ${displayName}'s room! ${displayName} can:`,
    "Search for songs, artists, albums, or playlists",
  ];

  const playerList = mediaPlayers
    .map(([nickname, entity]) => `"${nickname}" (${entity.description})`)
    .join(", ");
  lines.push(`Play music on: ${playerList}`);

  lines.push(
    "Pause the music, skip to the next song, go back to the previous song, or stop"
  );
  lines.push(
    `Just say what ${displayName} wants to hear! Like "play Taylor Swift" or "search for Frozen songs"`
  );

  return lines.join("\n");
}

export function resolveMediaPlayer(
  agentId: string,
  nickname?: string
): HaEntityConfig | null {
  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) return null;

  const mediaPlayers = Object.entries(agentConfig.entities).filter(
    ([, entity]) => entity.type === "media_player"
  );

  if (nickname && nickname.trim() !== "") {
    const normalized = nickname.toLowerCase().trim();
    const match = mediaPlayers.find(
      ([key]) => key.toLowerCase() === normalized
    );
    return match?.[1] ?? null;
  }

  return mediaPlayers.length > 0 ? mediaPlayers[0][1] : null;
}

export function getMediaPlayerNicknames(agentId: string): string[] {
  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) return [];

  return Object.entries(agentConfig.entities)
    .filter(([, entity]) => entity.type === "media_player")
    .map(([nickname]) => nickname);
}
