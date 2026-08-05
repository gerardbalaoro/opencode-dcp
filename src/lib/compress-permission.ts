import type { Config } from "./config"
import { type HostPermissionSnapshot, resolveEffectiveCompressPermission } from "./host-permissions"
import type { SessionState, WithParts } from "./state"
import { getLastUserMessage } from "./messages/query"

export const compressPermission = (
    state: SessionState,
    config: Config,
): "ask" | "allow" | "deny" => {
    return state.compressPermission ?? config.compress.permission
}

export const syncCompressPermissionState = (
    state: SessionState,
    config: Config,
    hostPermissions: HostPermissionSnapshot,
    messages: WithParts[],
): void => {
    const activeAgent = getLastUserMessage(messages)?.info.agent
    state.compressPermission = resolveEffectiveCompressPermission(
        config.compress.permission,
        hostPermissions,
        activeAgent,
    )
}
