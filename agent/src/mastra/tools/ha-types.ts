/** A single entity entry from ha-entities.json */
export interface HaEntityConfig {
  entity_id: string;
  type: "light" | "switch" | "scene" | "input_boolean" | "fan";
  description: string;
  capabilities?: ("brightness" | "color" | "color_temp")[];
}

/** Per-agent config from ha-entities.json */
export interface HaAgentConfig {
  displayName: string;
  entities: Record<string, HaEntityConfig>; // keyed by nickname slug
}

/** Top-level ha-entities.json structure */
export type HaEntitiesConfig = Record<string, HaAgentConfig>; // keyed by agent id
