import { RegexFilterProcessor } from "@mastra/core/processors";

export const ttsOutputProcessor = new RegexFilterProcessor({
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
    {
      name: "code-blocks",
      pattern: /```[\s\S]*?```/g,
      replacement: "",
    },
    {
      name: "inline-code",
      pattern: /`([^`]+)`/g,
      replacement: "$1",
    },
    {
      name: "bold-italic",
      pattern: /\*\*\*(.+?)\*\*\*/g,
      replacement: "$1",
    },
    {
      name: "bold-asterisk",
      pattern: /\*\*(.+?)\*\*/g,
      replacement: "$1",
    },
    {
      name: "bold-underscore",
      pattern: /__(.+?)__/g,
      replacement: "$1",
    },
    {
      name: "italic-asterisk",
      pattern: /(?<!\w)\*(.+?)\*(?!\w)/g,
      replacement: "$1",
    },
    {
      name: "italic-underscore",
      pattern: /(?<!\w)_(.+?)_(?!\w)/g,
      replacement: "$1",
    },
    {
      name: "strikethrough",
      pattern: /~~(.+?)~~/g,
      replacement: "$1",
    },
    {
      name: "headings",
      pattern: /^#{1,6}\s+/gm,
      replacement: "",
    },
    {
      name: "links",
      pattern: /\[([^\]]+)\]\([^)]+\)/g,
      replacement: "$1",
    },
    {
      name: "blockquotes",
      pattern: /^>\s?/gm,
      replacement: "",
    },
    {
      name: "unordered-list-markers",
      pattern: /^[\-\*]\s+/gm,
      replacement: "",
    },
    {
      name: "ordered-list-markers",
      pattern: /^\d+\.\s+/gm,
      replacement: "",
    },
    {
      name: "horizontal-rules",
      pattern: /^(\-{3,}|\*{3,}|_{3,})$/gm,
      replacement: "",
    },
  ],
  strategy: "redact",
  phase: "output",
});
