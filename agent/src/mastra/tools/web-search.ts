import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const safe = (s: string) => s.replace(/[\r\n\t]/g, " ");

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const webSearchTool = createTool({
  id: "web-search",
  description:
    "Search the web for information. Returns a list of relevant results with titles, descriptions, and links. Useful for answering questions about facts, current events, or topics the assistant doesn't know about.",
  inputSchema: z.object({
    query: z.string().describe("What to search for"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Maximum number of results to return. Default is 5."),
  }),
  outputSchema: z.object({
    report: z.string().describe("Kid-friendly search results summary"),
  }),
  execute: async (inputData) => {
    const SEARCH_API_URL = process.env.SEARCH_API_URL;
    if (!SEARCH_API_URL) {
      return {
        report:
          "I can't search the web right now. Ask a grown-up to set that up!",
      };
    }

    try {
      const maxResults = inputData.max_results ?? 5;
      const searchUrl = `${SEARCH_API_URL}/search?q=${encodeURIComponent(inputData.query)}&format=json&categories=general`;

      const res = await fetchWithTimeout(searchUrl, {});
      if (!res.ok) {
        return {
          report:
            "I couldn't search the web right now. Let's try again in a little bit!",
        };
      }

      const data = await res.json();
      const results: Array<{
        title?: string;
        content?: string;
        url?: string;
      }> = data.results ?? [];

      if (results.length === 0) {
        return {
          report:
            "I searched but couldn't find anything about that. Want to try different words?",
        };
      }

      const taken = results.slice(0, maxResults);
      const lines = taken.map((item, i) => {
        const title = item.title ?? "No title";
        const snippet =
          item.content && item.content.length > 150
            ? item.content.slice(0, 150) + "..."
            : (item.content ?? "");
        const url = item.url ?? "";
        return `${i + 1}. **${title}**\n   ${snippet}\n   Link: ${url}`;
      });

      const report = `Here's what I found about '${inputData.query}':\n\n${lines.join("\n\n")}`;

      console.log(
        `[web-search] query=${safe(inputData.query)} | results=${taken.length}`,
      );

      return { report };
    } catch {
      return {
        report:
          "Hmm, I couldn't search the web right now. Let's try again in a little bit!",
      };
    }
  },
});
