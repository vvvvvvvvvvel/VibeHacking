export type PendingActionResult = {
    confirmed: boolean;
    action: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
};

export type ActionHandler = (params: Record<string, unknown>) => unknown;

type PendingAction = {
    action: string;
    params: Record<string, unknown>;
    resolve: (result: PendingActionResult) => void;
    execute: () => Promise<unknown>;
};

export class ConfirmActionStore {
    private readonly pendingActions = new Map<number, PendingAction>();
    private readonly actionHandlers = new Map<string, ActionHandler>();

    private generateId() {
        let id = Math.floor(Math.random() * 1_000_000);
        while (this.pendingActions.has(id)) {
            id = Math.floor(Math.random() * 1_000_000);
        }
        return id;
    }

    createPendingAction(
        action: string,
        params: Record<string, unknown>,
        execute: () => Promise<unknown>,
    ) {
        const id = this.generateId();
        const promise = new Promise<PendingActionResult>((resolve) => {
            this.pendingActions.set(id, { action, params, resolve, execute });
        });
        return { id, promise };
    }

    async resolvePendingAction(id: number, confirmed: boolean) {
        if (!Number.isFinite(id)) return null;
        const pending = this.pendingActions.get(id);
        if (!pending) return null;
        this.pendingActions.delete(id);
        const result: PendingActionResult = {
            confirmed,
            action: pending.action,
            params: pending.params,
        };
        if (confirmed) {
            try {
                result.result = await pending.execute();
            } catch (err) {
                result.error = err instanceof Error ? err.message : String(err);
            }
        }
        pending.resolve(result);
        return result;
    }

    registerAction(name: string, handler: ActionHandler) {
        this.actionHandlers.set(name, handler);
    }

    runAction(name: string, params: Record<string, unknown>) {
        const handler = this.actionHandlers.get(name);
        if (!handler) {
            throw new Error(`Unknown action "${name}"`);
        }
        return Promise.resolve(handler(params));
    }
}
