import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERNAMES_PATH = path.resolve(__dirname, "../../../data/usernames.json");

const USERNAME_MAX_LENGTH = 32;
const USERNAME_REGEX = /^[\p{L}\p{N} \-'']+$/u; // Unicode letters, numbers, spaces, hyphens, apostrophes

function sanitizeUsername(name: string): string {
  const trimmed = name.trim();
  // Strip any embedded newlines/carriage returns
  const cleaned = trimmed.replace(/[\r\n]/g, " ");
  return cleaned;
}

const DEFAULTS: Record<string, string> = {
  "zoe-agent": "zoe",
  "max-agent": "max",
  "ai-buddy": "kiddo",
  "kids-agent": "kiddo",
};

export async function getUsername(agentId: string): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(USERNAMES_PATH, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return DEFAULTS[agentId] ?? "friend";
    }
    return DEFAULTS[agentId] ?? "friend";
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULTS[agentId] ?? "friend";
  }

  const rawName = data[agentId] ?? DEFAULTS[agentId] ?? "friend";
  // Defense in depth: strip any newlines that might have gotten in
  return rawName.replace(/[\r\n]/g, " ");
}

export async function setUsername(
  agentId: string,
  name: string,
): Promise<void> {
  await fs.mkdir(path.dirname(USERNAMES_PATH), { recursive: true });

  let raw: string;
  try {
    raw = await fs.readFile(USERNAMES_PATH, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      raw = "{}";
    } else {
      raw = "{}";
    }
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  data[agentId] = name;
  await fs.writeFile(USERNAMES_PATH, JSON.stringify(data, null, 2) + "\n");
}

export function createChangeUsernameTool(agentId: string) {
  return createTool({
    id: "change-username",
    description:
      "Change what the AI buddy calls the user. Use this when the user asks to be called by a different name.",
    inputSchema: z.object({
      new_name: z.string()
        .trim()
        .min(1, "Name can't be empty")
        .max(32, "Name is too long — try something shorter!")
        .regex(/^[\p{L}\p{N} \-'']+$/u, "Only letters, numbers, spaces, hyphens, and apostrophes allowed")
        .describe("The new name to call the user"),
    }),
    outputSchema: z.object({
      report: z.string(),
    }),
    execute: async (inputData) => {
      try {
        const sanitizedName = sanitizeUsername(inputData.new_name);
        await setUsername(agentId, sanitizedName);
        return {
          report: `Done! I'll call you ${sanitizedName} from now on!`,
        };
      } catch {
        return {
          report:
            "Hmm, I had trouble changing your name. Let's try again!",
        };
      }
    },
  });
}
