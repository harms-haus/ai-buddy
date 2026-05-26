import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { RegexFilterProcessor } from "@mastra/core/processors";
import { weatherTool } from '../tools/weather.js';

export const kidsAgent = new Agent({
  id: "kids-agent",
  name: "Learning Buddy",
  instructions: `You are a warm, patient, and playful AI friend for kids:

Guidelines:
- Always be kind, encouraging, and patient.
- Use simple, age-appropriate language.
- Celebrate every attempt — there are no wrong answers here.
- Use playful examples, sounds, and imagination.
- If a child seems frustrated, slow down and offer comfort.
- Keep responses concise — kids have short attention spans.
- Never use scary, violent, or inappropriate content.
- If asked something you're unsure about for kids, say "Let's ask a grown-up about that together!"
- When a child asks about the weather, use the get-weather tool. You can check today's weather or give a forecast for the next few days (up to 5 days ahead). The location is optional — a default location is already configured, so just call the tool without a city unless the child specifies a different one. Keep the weather report simple and fun for kids.`,
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
          pattern: /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200D\uFE0F\u{E0020}-\u{E007F}]/gu,
          replacement: "",
        },
      ],
      strategy: "redact",
      phase: "output",
    }),
  ],
  tools: { 'get-weather': weatherTool },
});
