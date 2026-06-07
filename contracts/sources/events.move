/// Shared event structs for the whole package.
///
/// Public structs are frozen by the upgrade policy (cannot be removed, fields
/// cannot change), so we centralize them here. The `emit_*` helpers are
/// `public(package)`, meaning they CAN be changed or removed on a later
/// upgrade — only the event shapes themselves are the stable contract.
module pols_core::events;

use sui::event;

/// Emitted once when a world is created.
public struct WorldCreated has copy, drop {
    env: ID,
    owner: address,
}

/// Emitted whenever a world's commons is mutated (action applied, etc.).
public struct WorldUpdated has copy, drop {
    env: ID,
    epoch: u64,
    value: u64,
}

/// Emitted when a lazy consequence fires. `kind` discriminates the cause:
/// 0 = decayed below floor (delist).
public struct ConsequenceTriggered has copy, drop {
    env: ID,
    epoch: u64,
    kind: u8,
}

public(package) fun emit_world_created(env: ID, owner: address) {
    event::emit(WorldCreated { env, owner });
}

public(package) fun emit_world_updated(env: ID, epoch: u64, value: u64) {
    event::emit(WorldUpdated { env, epoch, value });
}

public(package) fun emit_consequence(env: ID, epoch: u64, kind: u8) {
    event::emit(ConsequenceTriggered { env, epoch, kind });
}
