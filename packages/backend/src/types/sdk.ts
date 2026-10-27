/* eslint-disable @typescript-eslint/no-restricted-types */
import type { SDK } from "caido:plugin";

import type { API } from "./api";
import type { BackendEvents } from "./events";

export type KVValue = string | number | boolean | KVValue[] | null | { [key: string]: KVValue };

export type KVSDK = {
    define(key: string, options: { exportable?: boolean }): Promise<void>;
    get<T extends KVValue>(key: string): Promise<T | null | undefined>;
    set<T extends KVValue>(key: string, value: T): Promise<void>;
    del(key: string): Promise<void>;
};

export type MCPSDK = SDK<API, BackendEvents>;

export const getKvSdk = (sdk: MCPSDK) => (sdk as MCPSDK & { kv: KVSDK }).kv;
