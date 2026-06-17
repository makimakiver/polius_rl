/// Shared event structs for the whole package.
///
/// Public structs are frozen by the upgrade policy (cannot be removed, fields
/// cannot change), so we centralize them here. The `emit_*` helpers are
/// `public(package)`, meaning they CAN be changed or removed on a later
/// upgrade — only the event shapes themselves are the stable contract.
module pols_core::events;

use std::string::String;
use sui::event;

/// Emitted once when a world is created.
public struct WorldCreated has copy, drop {
    env: ID,
    owner: address,
}

/// Emitted once when a world is registered, carrying the full metadata
/// snapshot so the off-chain registry indexer can build entries from events
/// alone (no per-object RPC).
public struct EnvRegistered has copy, drop {
    env: ID,
    owner: address,
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
}

/// Emitted whenever registry metadata changes (update_metadata or
/// publish_artifact). Carries the full current snapshot for the indexer.
public struct EnvMetadataUpdated has copy, drop {
    env: ID,
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
}

public(package) fun emit_world_created(env: ID, owner: address) {
    event::emit(WorldCreated { env, owner });
}

public(package) fun emit_env_registered(
    env: ID,
    owner: address,
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
) {
    event::emit(EnvRegistered {
        env, owner, name, description, tags, artifact_uri,
    });
}

public(package) fun emit_env_metadata_updated(
    env: ID,
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
) {
    event::emit(EnvMetadataUpdated {
        env, name, description, tags, artifact_uri,
    });
}

// ---- inference market events -------------------------------------------

/// Emitted when a model registry (one served model) is created for an env.
public struct RegistryCreated has copy, drop {
    registry: ID,
    environment: ID,
    creator: address,
}

/// Emitted when the RL publisher promotes a new checkpoint. Carries the full
/// snapshot so the indexer can build the version history from events alone.
public struct CheckpointPublished has copy, drop {
    registry: ID,
    version: u64,
    walrus_blob_id: String,
    pass_rate_bps: u64,
}

/// Emitted when a buyer pays for one inference. `to_env` / `to_registry` record
/// the fee split (environment fee pool vs the model's own pool).
public struct InferencePaid has copy, drop {
    registry: ID,
    buyer: address,
    version: u64,
    theorem_id: u64,
    amount: u64,
    to_env: u64,
    to_registry: u64,
}

public(package) fun emit_registry_created(registry: ID, environment: ID, creator: address) {
    event::emit(RegistryCreated { registry, environment, creator });
}

public(package) fun emit_checkpoint_published(
    registry: ID,
    version: u64,
    walrus_blob_id: String,
    pass_rate_bps: u64,
) {
    event::emit(CheckpointPublished { registry, version, walrus_blob_id, pass_rate_bps });
}

public(package) fun emit_inference_paid(
    registry: ID,
    buyer: address,
    version: u64,
    theorem_id: u64,
    amount: u64,
    to_env: u64,
    to_registry: u64,
) {
    event::emit(InferencePaid {
        registry, buyer, version, theorem_id, amount, to_env, to_registry,
    });
}
