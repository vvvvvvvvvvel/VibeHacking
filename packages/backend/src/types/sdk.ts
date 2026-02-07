import type { SDK } from "caido:plugin";

import type { API } from "./api";
import type { BackendEvents } from "./events";

export type MCPSDK = SDK<API, BackendEvents>;
