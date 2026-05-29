import { z } from 'zod';
import type { HaEntitiesConfig, HaAgentConfig, HaEntityConfig } from './ha-types.js';
import haEntitiesRaw from '../../../ha-entities.json';

const entitySchema = z.object({
  entity_id: z.string().regex(
    /^(light|switch|scene|input_boolean|fan|media_player)\.[a-zA-Z0-9_]+$/,
    'entity_id must be in domain.entity_id format (e.g., light.bedroom)'
  ),
  type: z.enum(['light', 'switch', 'scene', 'input_boolean', 'fan', 'media_player']),
  description: z.string().min(1),
  capabilities: z.array(z.enum(['brightness', 'color', 'color_temp'])).optional(),
  unit_entity_id: z.string().regex(
    /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/,
    'unit_entity_id must be in domain.entity_id format (e.g., media_player.satellite1)'
  ).optional(),
});

const agentSchema = z.object({
  displayName: z.string().min(1),
  entities: z.record(z.string(), entitySchema),
});

const configSchema = z.record(z.string(), agentSchema);

let config: HaEntitiesConfig;

try {
  const validated = configSchema.parse(haEntitiesRaw);
  config = validated as HaEntitiesConfig;
  console.log(`[ha-config] loaded config for agents: ${Object.keys(config).join(', ')}`);
} catch (err: any) {
  if (err instanceof z.ZodError) {
    console.error('[ha-config] ha-entities.json validation failed:', err.errors);
    throw new Error(`Invalid ha-entities.json: ${err.errors.map((e: any) => e.message).join(', ')}`);
  } else {
    console.error('[ha-config] failed to validate ha-entities.json:', err.message);
    config = {};
  }
}

export function getAgentConfig(agentId: string): HaAgentConfig | null {
  return config[agentId] ?? null;
}

export function getAllAgentIds(): string[] {
  return Object.keys(config);
}

export function resolveNickname(agentId: string, nickname: string): HaEntityConfig | null {
  const agentConfig = config[agentId];
  if (!agentConfig) return null;
  const normalized = nickname.toLowerCase().trim();
  return agentConfig.entities[normalized] ?? null;
}

export function getEntityNicknames(agentId: string): string[] {
  const agentConfig = config[agentId];
  if (!agentConfig) return [];
  return Object.keys(agentConfig.entities);
}

export function buildDynamicDescription(agentId: string): string {
  const agentConfig = config[agentId];
  if (!agentConfig || Object.keys(agentConfig.entities).length === 0) {
    return 'Control things in your room. No room devices are configured yet.';
  }

  const displayName = agentConfig.displayName;
  const lines: string[] = [`Control things in ${displayName}'s room! ${displayName} can:`];

  const controllable: string[] = [];
  const scenes: string[] = [];

  for (const [nickname, entity] of Object.entries(agentConfig.entities)) {
    if (entity.type === 'media_player') continue;
    const entry = `"${nickname}" (${entity.description})`;
    if (entity.type === 'scene') {
      scenes.push(entry);
    } else {
      controllable.push(entry);
    }
  }

  if (controllable.length > 0) {
    lines.push(`Turn on, turn off, or toggle: ${controllable.join(', ')}`);
  }
  if (scenes.length > 0) {
    lines.push(`Activate: ${scenes.join(', ')}`);
  }

  lines.push(`Just say what ${displayName} wants! Like "turn on ${Object.keys(agentConfig.entities)[0]}" or "make the bedroom-lamp blue".`);

  return lines.join('\n');
}
