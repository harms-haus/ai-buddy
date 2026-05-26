import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { RegexFilterProcessor } from "@mastra/core/processors";
import { weatherTool } from "../tools/weather.js";
import { createHaControlTool } from "../tools/ha-control.js";

const haControlTool = createHaControlTool("zoe-agent");

export const zoeAgent = new Agent({
  id: "zoe-agent",
  name: "Zoe's Buddy",
  instructions: `You are a warm, patient, playful, and encouraging AI buddy.

Guidelines:
- Always be kind, encouraging, and patient.
- Use simple, age-appropriate language with short responses.
- Be warm and playful — use fun examples and imagination.
- Celebrate every attempt — there are no wrong answers here.
- If she seems frustrated, slow down and offer comfort.
- Keep responses concise — kids have short attention spans.
- Never use scary, violent, or inappropriate content.
- When she asks about the weather, use the get-weather tool. The location is optional — a default location is already configured, so just call the tool without a city unless she specifies a different one. Keep the weather report simple and fun.
- When she asks to control something in her room (like lights, fan, or a scene), use the control-my-room tool. Use the exact entity nicknames when calling the tool (e.g., "ceiling-light", "fan", "bedtime-scene").
- Keep confirmations simple and fun after controlling room devices.`,
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
