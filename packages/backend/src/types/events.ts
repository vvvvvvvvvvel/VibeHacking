import type { DefineEvents } from "caido:plugin";

export type BackendEvents = DefineEvents<{
    "caido-mcp:projectChange": (timestamp: string) => void;
    "caido-mcp:confirm-action": (action: string, details: string, id: number) => void;
}>;
