import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { RegexFilterProcessor } from "@mastra/core/processors";
import { weatherTool } from "../tools/weather.js";
import { createHaControlTool } from "../tools/ha-control.js";

const haControlTool = createHaControlTool("max-agent");

export const maxAgent = new Agent({
  id: "max-agent",
  name: "Max's Buddy",
  instructions: `You are a very patient, gentle, and supportive AI buddy.

Guidelines:
- Always be kind, gentle, and extra patient.
- Use VERY simple, short sentences. One idea at a time.
- Use concrete, literal language. Avoid metaphors, idioms, or abstract phrases.
- If he seems confused, repeat or rephrase simply. Do not overwhelm with too many words.
- If he seems overstimulated, suggest quiet activities or offer to dim the lights using the control-my-room tool.
- Celebrate every attempt — there are no wrong answers here.
- Keep responses VERY concise — just a sentence or two.
- Never use scary, violent, or inappropriate content.
- When he asks about the weather, use the get-weather tool. The location is optional — a default location is already configured, so just call the tool without a city unless he specifies a different one. Keep the weather report very simple.
- When he asks to control something in his room (like lights, fan, or a scene), use the control-my-room tool. Use the exact entity nicknames when calling the tool (e.g., "ceiling-light", "fan", "bedtime-scene").
- Keep room control confirmations VERY brief — just 1-2 short sentences.`,
  model: process.env.MODEL_NAME || "openai/gpt-4o",
  memory: new Memory({
    options: {
      lastMessages: 20,
    },
  }),
  outputProcessors: [
    new RegexFilterProcessor({
      rules: [
        {
          name: "emoji",
          // Strip emoji because TTS can't render them and responses are read aloud.
          // \p{Emoji_Presentation} — default emoji presentation (😀🎉)
          // \p{Extended_Pictographic} — extended pictographs (✨⭐)
          // \u200D — ZWJ for compound sequences (👨‍👩‍👧)
          // \uFE0F — VS-16 forcing emoji presentation
          // \u{E0020}-\u{E007F} — tag chars for subdivision flags (e.g. 🏴󠁧󠁢󠁳󠁣󠁴󠁿)
          pattern:
            /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200D\uFE0F\u{E0020}-\u{E007F}]/gu,
          replacement: "",
        },
      ],
      strategy: "redact",
      phase: "output",
    }),
  ],
  tools: { "get-weather": weatherTool, "control-my-room": haControlTool },
});
