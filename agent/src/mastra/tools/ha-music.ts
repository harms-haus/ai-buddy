import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { callService } from "home-assistant-js-websocket";
import { getHaConnection } from "./ha-connection.js";
import {
  getMaConfigEntryId,
  buildMusicToolDescription,
  resolveMediaPlayer,
  getMediaPlayerNicknames,
} from "./ha-music-config.js";
import { getAgentConfig } from "./ha-config.js";

const MEDIA_TYPE_KEYWORDS: Record<string, string> = {
  playlist: "playlist",
  mix: "playlist",
  mixtape: "playlist",
  track: "track",
  song: "track",
  tune: "track",
  jam: "track",
  album: "album",
  record: "album",
  lp: "album",
  artist: "artist",
  singer: "artist",
  musician: "artist",
  performer: "artist",
  vocalist: "artist",
};

/**
 * Detects a preferred media type from keywords in a search query.
 * Maps words like "song"/"tune" → "track", "playlist"/"mix" → "playlist",
 * "album"/"record" → "album", "artist"/"singer" → "artist".
 * Returns null if no type keyword is found, or if multiple different types are detected.
 */
export function detectMediaType(query: string): string | null {
  const words = query
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const detectedTypes: string[] = [];
  for (const word of words) {
    if (MEDIA_TYPE_KEYWORDS[word]) {
      detectedTypes.push(MEDIA_TYPE_KEYWORDS[word]);
    }
  }
  // If exactly one unique type found, use it. Multiple types → null (search all).
  const uniqueTypes = [...new Set(detectedTypes)];
  return uniqueTypes.length === 1 ? uniqueTypes[0] : null;
}

/**
 * Computes a word-overlap score between a query and a candidate name.
 * Returns the fraction of the candidate's name words that appear in the query.
 * Returns 0 if the candidate name is empty.
 */
export function nameMatchScore(query: string, name: string): number {
  const queryWords = new Set(
    query.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").split(/\s+/).filter(Boolean)
  );
  const nameWords = name
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (nameWords.length === 0) return 0;
  const matchCount = nameWords.filter((w) => queryWords.has(w)).length;
  return matchCount / nameWords.length;
}

const CATEGORY_LABELS: Record<string, string> = {
  playlist: "playlists",
  track: "songs",
  album: "albums",
  artist: "artists",
};

async function typeAwareSearch(
  connection: any,
  configEntryId: string,
  query: string,
  options: {
    artist?: string;
    limit?: number;
    explicitMediaType?: string;
  }
): Promise<{
  data: any;
  detectedType: string | null;
}> {
  const detectedType = detectMediaType(query);
  // Priority: explicitMediaType from LLM > detected type from query
  const preferredType = options.explicitMediaType ?? detectedType;

  if (preferredType) {
    // First: search ONLY the preferred type
    const filteredResults = await callService(
      connection,
      "music_assistant",
      "search",
      {
        config_entry_id: configEntryId,
        name: query,
        media_type: preferredType,
        ...(options.artist && { artist: options.artist }),
        limit: options.limit ?? 5,
      },
      {},
      true
    );
    const filteredData = (filteredResults as any)?.response ?? filteredResults;

    // Check if results in the preferred category meet the threshold
    const categoryKey = preferredType === "track" ? "tracks" : preferredType + "s";
    const preferredResults = Array.isArray((filteredData as any)?.[categoryKey])
      ? (filteredData as any)[categoryKey]
      : [];

    if (preferredResults.length > 0) {
      // Check best score
      const bestScore = Math.max(
        ...preferredResults.map((item: any) =>
          nameMatchScore(query, item.name ?? "")
        )
      );
      if (bestScore >= 0.5) {
        console.log(
          `[ha-music] type-aware: preferredType=${preferredType}, bestScore=${bestScore.toFixed(2)}, query="${query}"`
        );
        return { data: filteredData, detectedType: preferredType };
      }
    }

    // Fallback: search all types
    console.log(
      `[ha-music] type-aware: fallback from ${preferredType}, query="${query}"`
    );
    const fallbackResults = await callService(
      connection,
      "music_assistant",
      "search",
      {
        config_entry_id: configEntryId,
        name: query,
        ...(options.artist && { artist: options.artist }),
        limit: options.limit ?? 5,
      },
      {},
      true
    );
    const fallbackData = (fallbackResults as any)?.response ?? fallbackResults;
    // Check if fallback actually returned results in the preferred category
    const fallbackCategoryKey = preferredType === "track" ? "tracks" : preferredType + "s";
    const fallbackPreferredResults = Array.isArray((fallbackData as any)?.[fallbackCategoryKey])
      ? (fallbackData as any)[fallbackCategoryKey]
      : [];
    return {
      data: fallbackData,
      detectedType: fallbackPreferredResults.length > 0 ? preferredType : null,
    };
  }

  // No type preference — standard search
  const results = await callService(
    connection,
    "music_assistant",
    "search",
    {
      config_entry_id: configEntryId,
      name: query,
      ...(options.artist && { artist: options.artist }),
      limit: options.limit ?? 5,
    },
    {},
    true
  );
  const searchData = (results as any)?.response ?? results;
  return { data: searchData, detectedType: null };
}

export function createHaMusicTool(agentId: string) {
  const description = buildMusicToolDescription(agentId);

  return createTool({
    id: "control-music",
    description,
    inputSchema: z.object({
      action: z
        .enum(["search", "play", "pause", "resume", "next", "previous", "stop"])
        .describe(
          "What to do: search for music, play something, pause, resume, skip to next/previous song, or stop"
        ),
      query: z
        .string()
        .optional()
        .describe(
          "What to search for — a song name, artist name, album, or playlist. Used for search and play actions."
        ),
      media_id: z
        .string()
        .optional()
        .describe(
          "A specific URI or identifier to play (from search results). If provided for play action, this is used instead of query."
        ),
      media_type: z
        .string()
        .optional()
        .describe(
          "Type of media: artist, album, track, or playlist. Optional — the tool auto-detects type from keywords like 'song', 'playlist', 'album', 'artist'. Only set this for types not auto-detected."
        ),
      artist: z
        .string()
        .optional()
        .describe("Artist name to help find the right song."),
      nickname: z
        .string()
        .optional()
        .describe(
          "Which speaker to use. If not specified, uses the default speaker."
        ),
    }),
    outputSchema: z.object({
      report: z
        .string()
        .describe("Kid-friendly confirmation or error message"),
    }),
    execute: async (inputData) => {
      try {
        // 1. Get display name once
        const agentConfig = getAgentConfig(agentId);
        const displayName = agentConfig?.displayName ?? "your";

        // 2. Get HA connection
        let connection;
        try {
          connection = await getHaConnection();
        } catch {
          return {
            report:
              "I can't connect to the music right now. Ask a grown-up for help!",
          };
        }

        // 3. Branch by action
        switch (inputData.action) {
          case "search": {
            if (!inputData.query || inputData.query.trim() === "") {
              return {
                report:
                  "What song or artist would you like me to look for? Tell me a name!",
              };
            }

            const configEntryId = await getMaConfigEntryId();
            if (!configEntryId) {
              return {
                report:
                  "I don't have music set up yet! Ask a grown-up to help add Music Assistant.",
              };
            }

            const { data: searchData, detectedType } = await typeAwareSearch(
              connection,
              configEntryId,
              inputData.query,
              { artist: inputData.artist, limit: 5, explicitMediaType: inputData.media_type }
            );

            // Format results into a kid-friendly report
            const sections: string[] = [];

            const tracks = (searchData as any)?.tracks;
            if (Array.isArray(tracks) && tracks.length > 0) {
              const items = tracks
                .map(
                  (t: any, i: number) =>
                    `${i + 1}. "${t.name}" by ${t.artist ?? "unknown"} (id: ${t.uri})`
                )
                .join(", ");
              sections.push(`Songs: ${items}`);
            }

            const albums = (searchData as any)?.albums;
            if (Array.isArray(albums) && albums.length > 0) {
              const items = albums
                .map(
                  (a: any, i: number) =>
                    `${i + 1}. "${a.name}" by ${a.artist ?? "unknown"} (id: ${a.uri})`
                )
                .join(", ");
              sections.push(`Albums: ${items}`);
            }

            const artists = (searchData as any)?.artists;
            if (Array.isArray(artists) && artists.length > 0) {
              const items = artists
                .map(
                  (a: any, i: number) =>
                    `${i + 1}. ${a.name} (id: ${a.uri})`
                )
                .join(", ");
              sections.push(`Artists: ${items}`);
            }

            const playlists = (searchData as any)?.playlists;
            if (Array.isArray(playlists) && playlists.length > 0) {
              const items = playlists
                .map(
                  (p: any, i: number) =>
                    `${i + 1}. "${p.name}" (id: ${p.uri})`
                )
                .join(", ");
              sections.push(`Playlists: ${items}`);
            }

            if (sections.length === 0) {
              return {
                report: `I couldn't find anything for "${inputData.query}". Try a different name!`,
              };
            }

            const typeLabel = detectedType && CATEGORY_LABELS[detectedType];
            const header = typeLabel ? `I found some ${typeLabel}!` : "I found some music!";
            return {
              report: `${header}\n${sections.join("\n")}`,
            };
          }

          case "play": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            const configEntryId = await getMaConfigEntryId();
            if (!configEntryId) {
              return {
                report:
                  "I don't have music set up yet! Ask a grown-up to help add Music Assistant.",
              };
            }

            const rawInput = inputData.media_id || inputData.query;
            if (!rawInput || rawInput.trim() === "") {
              return {
                report:
                  "What would you like me to play? Tell me a song name, artist, or playlist!",
              };
            }

            // Determine if the input is a URI (from search results) or a plain name
            const isUri = rawInput.includes("://");
            let mediaId = rawInput;
            // Use the original query as display name when media_id is a URI
            let foundName = (inputData.media_id && inputData.query) || rawInput;

            if (!isUri) {
              // Not a URI — search first to resolve the name to something playable
              const { data: searchData, detectedType: playDetectedType } = await typeAwareSearch(
                connection,
                configEntryId,
                rawInput,
                { artist: inputData.artist, limit: 3, explicitMediaType: inputData.media_type }
              );
              console.log(
                `[ha-music] type-aware play: preferredType=${playDetectedType}, query="${rawInput}"`
              );

              const playlists = (searchData as any)?.playlists ?? [];
              const albums = (searchData as any)?.albums ?? [];
              const tracks = (searchData as any)?.tracks ?? [];
              const artists = (searchData as any)?.artists ?? [];

              // Score each result by how much of its name appears in the query.
              // Playlists and albums get a category boost so they win when scores are close.
              // But if a track has a very high raw match score (≥ 0.9), it still wins outright.
              // Examples with "Golden from K-pop Demon Hunters":
              //   track "Golden"             → raw 1.0, effective 1.0 (high-track override wins)
              //   playlist "K-Pop Demon Hunters Playlist" → raw ~0.75, effective 1.0 (boosted, but track wins)
              // Examples with "K-pop Demon Hunters":
              //   track "Golden"             → raw 0.0, effective 0.0
              //   playlist "K-Pop Demon Hunters Playlist" → raw ~0.75, effective 1.0 (playlist wins)
              // Collect top candidates from each category
              const candidates: Array<{ item: any; score: number; category: string; effectiveScore: number }> = [];
              for (const t of tracks) {
                candidates.push({ item: t, score: nameMatchScore(rawInput, t.name ?? ""), category: "track", effectiveScore: 0 });
              }
              for (const a of albums) {
                candidates.push({ item: a, score: nameMatchScore(rawInput, a.name ?? ""), category: "album", effectiveScore: 0 });
              }
              for (const p of playlists) {
                candidates.push({ item: p, score: nameMatchScore(rawInput, p.name ?? ""), category: "playlist", effectiveScore: 0 });
              }
              for (const a of artists) {
                candidates.push({ item: a, score: nameMatchScore(rawInput, a.name ?? ""), category: "artist", effectiveScore: 0 });
              }

              if (candidates.length === 0) {
                return {
                  report: `I couldn't find anything called "${rawInput}". Try a different song or artist name!`,
                };
              }

              // Compute effective scores with category boosts
              const categoryBoost: Record<string, number> = { playlist: 0.25, album: 0.10, track: 0, artist: 0 };
              for (const c of candidates) {
                c.effectiveScore = c.score + (categoryBoost[c.category] ?? 0);
              }

              // Sort: high-scoring tracks (≥ 0.9) win over everything;
              // otherwise sort by effectiveScore (desc); ties broken by category rank.
              const categoryRank: Record<string, number> = { playlist: 0, album: 1, track: 2, artist: 3 };
              candidates.sort((a, b) => {
                const aHighTrack = a.category === "track" && a.score >= 0.9;
                const bHighTrack = b.category === "track" && b.score >= 0.9;
                if (aHighTrack !== bHighTrack) return aHighTrack ? -1 : 1;
                const aEff = a.effectiveScore;
                const bEff = b.effectiveScore;
                if (bEff !== aEff) return bEff - aEff;
                return (categoryRank[a.category] ?? 9) - (categoryRank[b.category] ?? 9);
              });

              const bestMatch = candidates[0];
              mediaId = bestMatch.item.uri ?? bestMatch.item.item_id ?? rawInput;
              foundName = bestMatch.item.name ?? rawInput;
              console.log(`[ha-music] search resolved: type=${bestMatch.category}, score=${bestMatch.score.toFixed(2)}, effectiveScore=${bestMatch.effectiveScore.toFixed(2)}, name=${foundName}, uri=${mediaId}`);
            }

            console.log(`[ha-music] play_media: entity=${mediaPlayer.entity_id}, media_id=${mediaId}, name=${foundName}`);

            try {
              await callService(
                connection,
                "music_assistant",
                "play_media",
                {
                  media_id: mediaId,
                  ...(inputData.media_type && { media_type: inputData.media_type }),
                  ...(inputData.artist && { artist: inputData.artist }),
                },
                { entity_id: mediaPlayer.entity_id }
                // NOTE: no returnResponse — play_media is fire-and-forget
              );
            } catch (playErr: any) {
              console.error(`[ha-music] play_media error:`, playErr?.message ?? playErr);
              return {
                report: `Oops! Something went wrong trying to play "${foundName}". Try asking again or pick something else!`,
              };
            }

            return {
              report: `Done! Now playing ${foundName} on ${mediaPlayer.description} in ${displayName}'s room. Enjoy the music!`,
            };
          }

          case "pause": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            await callService(
              connection,
              "media_player",
              "media_pause",
              {},
              { entity_id: mediaPlayer.entity_id }
            );

            return {
              report: `Done! I paused the music in ${displayName}'s room.`,
            };
          }

          case "resume": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            await callService(
              connection,
              "media_player",
              "media_play",
              {},
              { entity_id: mediaPlayer.entity_id }
            );

            return {
              report: `Done! The music is playing again in ${displayName}'s room.`,
            };
          }

          case "next": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            await callService(
              connection,
              "media_player",
              "media_next_track",
              {},
              { entity_id: mediaPlayer.entity_id }
            );

            return {
              report: `Done! Skipping to the next song in ${displayName}'s room.`,
            };
          }

          case "previous": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            await callService(
              connection,
              "media_player",
              "media_previous_track",
              {},
              { entity_id: mediaPlayer.entity_id }
            );

            return {
              report: `Done! Going back to the previous song in ${displayName}'s room.`,
            };
          }

          case "stop": {
            const mediaPlayer = resolveMediaPlayer(agentId, inputData.nickname);
            if (!mediaPlayer) {
              return {
                report: `I don't know which speaker to use! Available speakers: ${getMediaPlayerNicknames(agentId).join(", ") || "none configured"}`,
              };
            }

            await callService(
              connection,
              "media_player",
              "media_stop",
              {},
              { entity_id: mediaPlayer.entity_id }
            );

            return {
              report: `Done! I stopped the music in ${displayName}'s room.`,
            };
          }
        }
      } catch {
        return {
          report:
            "Hmm, something went wrong with the music. Let's try again in a little bit!",
        };
      }
    },
  });
}
