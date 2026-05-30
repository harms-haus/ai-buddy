import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERNAMES_PATH = path.resolve(__dirname, "../../../data/usernames.json");

const NAME_MAX_LENGTH = 32;
const NAME_REGEX = /^[\p{L}\p{N} \-'']+$/u; // Unicode letters, numbers, spaces, hyphens, apostrophes

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  // Strip any embedded newlines/carriage returns
  const cleaned = trimmed.replace(/[\r\n]/g, " ");
  return cleaned;
}

const USERNAME_DEFAULTS: Record<string, string> = {
  "zoe-agent": "zoe",
  "max-agent": "max",
  "ai-buddy": "kiddo",
  "kids-agent": "kiddo",
};

const AGENT_NAME_DEFAULTS: Record<string, string> = {
  "zoe-agent": "Buddy",
  "max-agent": "Buddy",
  "ai-buddy": "Buddy",
  "kids-agent": "Buddy",
};

type NamesEntry = { username?: string; agentname?: string };

let namesCache: Record<string, NamesEntry> | null = null;

async function readNamesData(): Promise<Record<string, NamesEntry>> {
  if (namesCache !== null) {
    return namesCache;
  }

  let raw: string;
  try {
    raw = await fs.readFile(USERNAMES_PATH, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    return {};
  }

  let parsed: Record<string, NamesEntry | string>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  // Backward compatibility: convert old flat format (string values) to nested
  const data: Record<string, NamesEntry> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      data[key] = { username: value };
    } else {
      data[key] = value;
    }
  }

  namesCache = data;
  return data;
}

async function writeNamesData(
  data: Record<string, NamesEntry>,
): Promise<void> {
  await fs.mkdir(path.dirname(USERNAMES_PATH), { recursive: true });
  await fs.writeFile(
    USERNAMES_PATH,
    JSON.stringify(data, null, 2) + "\n",
  );
  namesCache = data;
}

export async function getUsername(agentId: string): Promise<string> {
  const data = await readNamesData();
  const rawName =
    data[agentId]?.username ?? USERNAME_DEFAULTS[agentId] ?? "friend";
  // Defense in depth: strip any newlines that might have gotten in
  return rawName.replace(/[\r\n]/g, " ");
}

export async function setUsername(
  agentId: string,
  name: string,
): Promise<void> {
  await setNames(agentId, { username: name });
}

export async function getAgentName(agentId: string): Promise<string> {
  const data = await readNamesData();
  const rawName =
    data[agentId]?.agentname ?? AGENT_NAME_DEFAULTS[agentId] ?? "Buddy";
  // Defense in depth: strip any newlines that might have gotten in
  return rawName.replace(/[\r\n]/g, " ");
}

export async function getNames(agentId: string): Promise<{ username: string; agentname: string }> {
  const data = await readNamesData();
  const entry = data[agentId];
  const rawUsername = entry?.username ?? USERNAME_DEFAULTS[agentId] ?? "friend";
  const rawAgentname = entry?.agentname ?? AGENT_NAME_DEFAULTS[agentId] ?? "Buddy";
  return {
    username: rawUsername.replace(/[\r\n]/g, " "),
    agentname: rawAgentname.replace(/[\r\n]/g, " "),
  };
}

export async function setAgentName(
  agentId: string,
  name: string,
): Promise<void> {
  await setNames(agentId, { agentname: name });
}

export async function setNames(
  agentId: string,
  updates: NamesEntry,
): Promise<void> {
  const data = await readNamesData();
  data[agentId] = { ...data[agentId], ...updates };
  await writeNamesData(data);
}

export function createChangeNamesTool(agentId: string) {
  return createTool({
    id: "change-names",
    description:
      "Change what the user or the AI buddy is called. Use this when the user asks to change their own nickname (new_username) or what they call the AI (new_agentname). Either or both can be provided.",
    inputSchema: z
      .object({
        new_username: z
          .string()
          .trim()
          .min(1, "Name can't be empty")
          .max(NAME_MAX_LENGTH, "Name is too long — try something shorter!")
          .regex(
            NAME_REGEX,
            "Only letters, numbers, spaces, hyphens, and apostrophes allowed",
          )
          .describe("The new name to call the user")
          .optional(),
        new_agentname: z
          .string()
          .trim()
          .min(1, "Name can't be empty")
          .max(NAME_MAX_LENGTH, "Name is too long — try something shorter!")
          .regex(
            NAME_REGEX,
            "Only letters, numbers, spaces, hyphens, and apostrophes allowed",
          )
          .describe("The new name for the AI buddy")
          .optional(),
      })
      .refine(
        (data) =>
          data.new_username !== undefined ||
          data.new_agentname !== undefined,
        {
          message:
            "Provide at least one of new_username or new_agentname",
        },
      ),
    outputSchema: z.object({
      report: z.string(),
    }),
    execute: async (inputData) => {
      try {
        const { new_username, new_agentname } = inputData;
        const updates: NamesEntry = {};

        if (new_username !== undefined) {
          updates.username = sanitizeName(new_username);
        }
        if (new_agentname !== undefined) {
          updates.agentname = sanitizeName(new_agentname);
        }

        await setNames(agentId, updates);

        let report: string;
        if (updates.username && updates.agentname) {
          report = `Done! I'll call you ${updates.username}, and you can call me ${updates.agentname}!`;
        } else if (updates.username) {
          report = `Done! I'll call you ${updates.username} from now on!`;
        } else if (updates.agentname) {
          report = `Done! From now on, you can call me ${updates.agentname}!`;
        } else {
          report = "Hmm, I had trouble changing names. Let's try again!";
        }

        return { report };
      } catch {
        return {
          report:
            "Hmm, I had trouble changing your name. Let's try again!",
        };
      }
    },
  });
}
