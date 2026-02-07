import { type Caido } from "@caido/sdk-frontend";
import { type BackendAPI, type BackendEvents } from "shared";

export type FrontendSDK = Caido<BackendAPI, BackendEvents>;
