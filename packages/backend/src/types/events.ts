import type { DefineEvents } from "caido:plugin";

export type BackendEvents = DefineEvents<{
    "vibe-hacking:projectChange": (timestamp: string) => void;
    "vibe-hacking:confirm-action": (action: string, details: string, id: number) => void;
}>;
