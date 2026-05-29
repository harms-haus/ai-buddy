/** A single entity entry from ha-entities.json */
export interface HaEntityConfig {
  entity_id: string;
  type: "light" | "switch" | "scene" | "input_boolean" | "fan" | "media_player";
  description: string;
  capabilities?: ("brightness" | "color" | "color_temp")[];
  /** HA entity ID of the physical satellite unit (e.g. media_player.satellite1) whose volume can be controlled independently of the Music Assistant player entity. */
  unit_entity_id?: string;
}

/** Per-agent config from ha-entities.json */
export interface HaAgentConfig {
  displayName: string;
  entities: Record<string, HaEntityConfig>; // keyed by nickname slug
}

/** Top-level ha-entities.json structure */
export type HaEntitiesConfig = Record<string, HaAgentConfig>; // keyed by agent id
