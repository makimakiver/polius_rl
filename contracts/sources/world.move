/// pols_core v0.0.1 — the on-chain environment registry the frontend uses.
/// An `Environment` is a plain on-chain object representing a registered RL
/// environment, carrying Prime Intellect-style registry metadata
/// (name/description/tags/artifact_uri) plus a fee pool.
///
/// Ownership legend:
///   `Environment`     -> shared   (the commons; readable by anyone)
///   `EnvironmentCap`  -> key,store (owned, tradable authority over one world)
///
/// Upgrade discipline (matches the project's `book::upgradable` rules):
///   * Public structs / public fn signatures are FROZEN.
///   * All real logic lives in private `*_internal` fns whose bodies may change.
///   * `Environment.version` + `assert_version` gate every mutating entry; a
///     cap-gated `migrate` bumps the version after a package upgrade.
module pols_core::environment;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use pols_core::events;

/// Current on-chain logic version. Bump on each breaking package upgrade.
const VERSION: u64 = 1;

/// Caller is interacting through a stale/!= logic version; run `migrate` first.
const E_WRONG_VERSION: u64 = 0;
/// The provided `EnvironmentCap` does not authorize this `Environment`.
const E_WRONG_CAP: u64 = 1;

/// Owned, tradable authority over exactly one world. Authority travels with the
/// capability, never with `tx_context::sender()`.
public struct EnvironmentCap has key, store {
    id: UID,
    env: ID,
}

/// The shared commons. Holds the registry metadata and the real fee pool. This
/// is the only on-chain contract the frontend talks to.
public struct Environment has key {
    id: UID,
    owner: address,        // logical owner = the address that minted the cap
    // ---- Prime Intellect-style registry metadata (Slice 1) --------------
    name: String,          // registry identity, e.g. "automationbench"
    description: String,   // short human summary
    tags: vector<String>,  // categorization, e.g. ["single-turn", "toy"]
    artifact_uri: String,  // pointer to the off-chain env package + dataset
                           // + reward code (Walrus/IPFS/HTTPS)
    version: u64,
    fee_pool: Balance<SUI>, // real value, filled by activity fees later
    legit_until: u64,       // legitimacy gate; 0 until set by a later phase
}

// ---- creation -----------------------------------------------------------

/// Create a world with its registry metadata, share it, and return its
/// authority cap to the caller.
public fun create_world(
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
    ctx: &mut TxContext,
): EnvironmentCap {
    create_world_internal(name, description, tags, artifact_uri, ctx)
}

/// Convenience entry: shares the world and sends the cap to the sender.
/// `entry`/non-public, so it may change on upgrade.
entry fun create_world_entry(
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
    ctx: &mut TxContext,
) {
    let cap = create_world_internal(name, description, tags, artifact_uri, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

fun create_world_internal(
    name: String,
    description: String,
    tags: vector<String>,
    artifact_uri: String,
    ctx: &mut TxContext,
): EnvironmentCap {
    let owner = ctx.sender();
    let env = Environment {
        id: object::new(ctx),
        owner,
        name,
        description,
        tags,
        artifact_uri,
        version: VERSION,
        fee_pool: balance::zero<SUI>(),
        legit_until: 0,
    };
    let env_id = object::id(&env);
    let cap = EnvironmentCap { id: object::new(ctx), env: env_id };
    events::emit_world_created(env_id, owner);
    events::emit_env_registered(
        env_id, owner, env.name, env.description, env.tags, env.artifact_uri,
    );
    transfer::share_object(env);
    cap
}

// ---- registry metadata mutation (cap-gated) -----------------------------

/// Update the descriptive metadata (name/description/tags). Cap-gated; the
/// artifact pointer is untouched. Mirrors a Prime Intellect re-describe.
public fun update_metadata(
    env: &mut Environment,
    cap: &EnvironmentCap,
    name: String,
    description: String,
    tags: vector<String>,
) {
    assert_version(env);
    assert!(cap.env == object::id(env), E_WRONG_CAP);
    env.name = name;
    env.description = description;
    env.tags = tags;
    events::emit_env_metadata_updated(
        object::id(env), env.name, env.description, env.tags, env.artifact_uri,
    );
}

/// Publish a new artifact pointer (uri). Cap-gated; the descriptive fields are
/// untouched. Mirrors a Prime Intellect re-publish.
public fun publish_artifact(
    env: &mut Environment,
    cap: &EnvironmentCap,
    artifact_uri: String,
) {
    assert_version(env);
    assert!(cap.env == object::id(env), E_WRONG_CAP);
    env.artifact_uri = artifact_uri;
    events::emit_env_metadata_updated(
        object::id(env), env.name, env.description, env.tags, env.artifact_uri,
    );
}

/// No-op demo entry. Does nothing on-chain — exists purely so the frontend can
/// demonstrate signing + executing a Move call (works for both zkLogin/Enoki
/// and normal wallets). Not published until you rebuild + publish the package.
entry fun ping(_ctx: &TxContext) {}

// ---- upgrade plumbing ---------------------------------------------------

fun assert_version(env: &Environment) {
    assert!(env.version == VERSION, E_WRONG_VERSION);
}

/// Cap-gated migration hook. After a package upgrade bumps `VERSION`, the cap
/// holder calls this once per world to advance its stored version.
public fun migrate(env: &mut Environment, cap: &EnvironmentCap) {
    assert!(cap.env == object::id(env), E_WRONG_CAP);
    assert!(env.version < VERSION, E_WRONG_VERSION);
    env.version = VERSION;
}

// ---- views --------------------------------------------------------------

public fun owner(env: &Environment): address { env.owner }

public fun name(env: &Environment): String { env.name }

public fun description(env: &Environment): String { env.description }

public fun tags(env: &Environment): vector<String> { env.tags }

public fun artifact_uri(env: &Environment): String { env.artifact_uri }

public fun legit_until(env: &Environment): u64 { env.legit_until }

public fun version(env: &Environment): u64 { env.version }

public fun fee_pool_value(env: &Environment): u64 { balance::value(&env.fee_pool) }

// ---- fee intake ---------------------------------------------------------

/// Deposit SUI into this environment's fee pool. Used by the inference market to
/// route the environment's cut of each paid inference back to the env creator.
public fun deposit_fees(env: &mut Environment, payment: Coin<SUI>) {
    assert_version(env);
    balance::join(&mut env.fee_pool, coin::into_balance(payment));
}
