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
          "Type of media: artist, album, track, or playlist. Helps find the right thing."
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

            const results = await callService(
              connection,
              "music_assistant",
              "search",
              {
                config_entry_id: configEntryId,
                name: inputData.query,
                ...(inputData.artist && { artist: inputData.artist }),
                ...(inputData.media_type && { media_type: inputData.media_type }),
                limit: 5,
              },
              {},
              true
            );

            const searchData = (results as any)?.response ?? results;

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

            return {
              report: `I found some music!\n${sections.join("\n")}`,
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
              const searchResults = await callService(
                connection,
                "music_assistant",
                "search",
                {
                  config_entry_id: configEntryId,
                  name: rawInput,
                  ...(inputData.artist && { artist: inputData.artist }),
                  ...(inputData.media_type && { media_type: inputData.media_type }),
                  limit: 3,
                },
                {},
                true
              );

              const searchData = (searchResults as any)?.response ?? searchResults;

              const playlists = (searchData as any)?.playlists ?? [];
              const albums = (searchData as any)?.albums ?? [];
              const tracks = (searchData as any)?.tracks ?? [];
              const artists = (searchData as any)?.artists ?? [];

              // Score each result by how much of its name appears in the query.
              // Playlists and albums get a category boost so they win when scores are close.
              // But if a track has a very high raw match score (≥ 0.9), it still wins outright.
              // Examples with "Golden from K-pop Demon Hunters":
              //   track "Golden"             → raw 1.0, effective 1.0 (high-track override wins)
              //   playlist "K-Pop Demon Hunters" → raw ~0.75, effective 1.0 (boosted, but track wins)
              // Examples with "K-pop Demon Hunters":
              //   track "Golden"             → raw 0.0, effective 0.0
              //   playlist "K-Pop Demon Hunters" → raw ~0.75, effective 1.0 (playlist wins)
              const queryWords = new Set(
                rawInput.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").split(/\s+/).filter(Boolean)
              );

              function nameMatchScore(name: string): number {
                const nameWords = name.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").split(/\s+/).filter(Boolean);
                if (nameWords.length === 0) return 0;
                const matchCount = nameWords.filter((w: string) => queryWords.has(w)).length;
                return matchCount / nameWords.length;
              }

              // Collect top candidates from each category
              const candidates: Array<{ item: any; score: number; category: string; effectiveScore: number }> = [];
              for (const t of tracks) {
                candidates.push({ item: t, score: nameMatchScore(t.name ?? ""), category: "track", effectiveScore: 0 });
              }
              for (const a of albums) {
                candidates.push({ item: a, score: nameMatchScore(a.name ?? ""), category: "album", effectiveScore: 0 });
              }
              for (const p of playlists) {
                candidates.push({ item: p, score: nameMatchScore(p.name ?? ""), category: "playlist", effectiveScore: 0 });
              }
              for (const a of artists) {
                candidates.push({ item: a, score: nameMatchScore(a.name ?? ""), category: "artist", effectiveScore: 0 });
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
