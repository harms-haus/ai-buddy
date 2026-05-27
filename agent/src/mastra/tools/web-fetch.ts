import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const BLOCKED_HOSTS = new Set([
  '127.0.0.1', '::1', '0.0.0.0', 'localhost',
  '169.254.169.254', // cloud metadata
]);

function validateUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (BLOCKED_HOSTS.has(url.hostname)) {
    throw new Error('This URL is not allowed');
  }
  // Block private IP ranges
  const host = url.hostname;
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)) {
    throw new Error('Private network addresses are not allowed');
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const safe = (s: string) => s.replace(/[\r\n\t]/g, ' ');

const fetchCache = new Map<string, { content: string; ts: number }>();
const CACHE_TTL = parseInt(process.env.WEB_FETCH_CACHE_TTL || "600000", 10);
const CACHE_MAX_SIZE = 100;

function extractContent(html: string, url: string): string {
  // Normalize the HTML: wrap fragments in a full document
  let normalizedHtml = html;
  if (
    !html.match(/^<html/i) &&
    !html.toLowerCase().includes("<!doctype")
  ) {
    normalizedHtml = `<!doctype html><html><head></head><body>${html}</body></html>`;
  }

  const { document } = parseHTML(normalizedHtml);

  // Set <base href> element
  if (document.head) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head.prepend(base);
  }

  // Try Readability first
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (article && article.content) {
    const markdown = NodeHtmlMarkdown.translate(article.content, {
      ignore: ["nav", "footer", "aside"],
    });
    return `# ${article.title}\n\n${markdown}`;
  }

  // Fallback: full-page conversion for non-article pages
  return NodeHtmlMarkdown.translate(
    normalizedHtml,
    { ignore: ["nav", "footer", "aside", "header"] },
  );
}

export const webFetchTool = createTool({
  id: "web-fetch",
  description:
    "Fetch and read the content of a web page. Returns a portion of the page content as text. If the content is long, you can request more by calling again with a higher start number.",
  inputSchema: z.object({
    url: z
      .string()
      .describe("The web address to fetch"),
    start: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Character position to start reading from. Default is 0 (beginning).",
      ),
    count: z
      .number()
      .int()
      .min(500)
      .max(16000)
      .optional()
      .describe("How many characters to return. Default is 8000."),
  }),
  outputSchema: z.object({
    report: z.string().describe("Extracted page content with pagination info"),
  }),
  execute: async (inputData) => {
    const start = inputData.start ?? 0;
    const count = inputData.count ?? 8000;

    try {
      validateUrl(inputData.url);

      // Check cache
      const cached = fetchCache.get(inputData.url);
      let content: string;

      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        content = cached.content;
      } else {
        fetchCache.delete(inputData.url);

        // Fetch the URL
        const res = await fetchWithTimeout(inputData.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Buddy/1.0)" },
        });

        if (!res.ok) {
          return {
            report:
              "I couldn't load that page. The website might be down or the link might be wrong.",
          };
        }

        const html = await res.text();
        const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2 MB
        if (html.length > MAX_HTML_SIZE) {
          return { report: 'That page is too big for me to read right now!' };
        }
        content = extractContent(html, inputData.url);

        // Evict oldest entries if cache is full
        if (fetchCache.size >= CACHE_MAX_SIZE) {
          let oldestKey: string | null = null;
          let oldestTs = Infinity;
          for (const [k, v] of fetchCache) {
            if (v.ts < oldestTs) {
              oldestTs = v.ts;
              oldestKey = k;
            }
          }
          if (oldestKey) fetchCache.delete(oldestKey);
        }

        const MAX_CACHE_ENTRY_SIZE = 500_000; // ~500 KB
        const cacheContent = content.length <= MAX_CACHE_ENTRY_SIZE ? content : content.substring(0, MAX_CACHE_ENTRY_SIZE);
        fetchCache.set(inputData.url, { content: cacheContent, ts: Date.now() });
        console.log(
          `[web-fetch] url=${safe(inputData.url)} | contentLength=${content.length}`,
        );
      }

      // Extract the window
      const chunk = content.substring(start, start + count);

      if (!chunk) {
        return {
          report:
            "There's nothing more to read on that page. You've reached the end!",
        };
      }

      // Build pagination footer
      const totalLength = content.length;
      const end = Math.min(start + count, totalLength);
      let footer = "";
      if (end < totalLength) {
        footer = `\n\n---\nShowing characters ${start + 1} to ${end} of ${totalLength}. There's more to read! Call web-fetch again with start=${end} to continue reading.`;
      }

      return { report: chunk + footer };
    } catch {
      return {
        report:
          "Hmm, I couldn't read that page. Let's try a different link!",
      };
    }
  },
});
