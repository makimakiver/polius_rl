/// Phase 0 — world substrate: a lazy-accrual living world that ages and bites
/// with zero agent intelligence.
///
/// Ownership legend:
///   `Environment`     -> shared   (the commons; many agents write it later)
///   `EnvironmentCap`  -> key,store (owned, tradable authority over one world)
///
/// Upgrade discipline (matches the project's `book::upgradable` rules):
///   * Public structs / public fn signatures are FROZEN.
///   * All real logic lives in private `*_internal` fns whose bodies may change.
///   * `Environment.version` + `assert_version` gate every mutating entry; a
///     cap-gated `migrate` bumps the version after a package upgrade.
module pols_core::environment;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::sui::SUI;
use pols_core::decay::{Self, WorldState, Config, Action};
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

/// The shared commons. Holds the decayable state, the real fee pool, and the
/// legitimacy gate (filled in later phases). Kept deliberately thin: per-agent
/// work will live on owned `EnvMembership` objects (Phase 1).
public struct Environment has key {
    id: UID,
    owner: address,        // logical owner = the address that minted the cap
    version: u64,
    state: WorldState,
    last_touched: u64,     // ms, from Clock
    epoch: u64,
    config: Config,
    fee_pool: Balance<SUI>, // real value, filled by activity fees later
    legit_until: u64,       // 0 until Phase 5 (Nautilus legitimacy)
    delisted: bool,         // set true by the lazy floor-breach consequence
}

// ---- creation -----------------------------------------------------------

/// Create a world, share it, and return its authority cap to the caller.
public fun create_world(
    config: Config,
    init_value: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): EnvironmentCap {
    create_world_internal(config, init_value, clock, ctx)
}

/// Convenience entry: builds the config from scalars, shares the world, and
/// sends the cap to the sender. `entry`/non-public, so it may change on upgrade.
entry fun create_world_entry(
    decay_bps_per_day: u64,
    floor: u64,
    ceil: u64,
    init_value: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let config = decay::new_config(decay_bps_per_day, floor, ceil);
    let cap = create_world_internal(config, init_value, clock, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

fun create_world_internal(
    config: Config,
    init_value: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): EnvironmentCap {
    let owner = ctx.sender();
    let env = Environment {
        id: object::new(ctx),
        owner,
        version: VERSION,
        state: decay::new_state(init_value),
        last_touched: clock.timestamp_ms(),
        epoch: 0,
        config,
        fee_pool: balance::zero<SUI>(),
        legit_until: 0,
        delisted: false,
    };
    let env_id = object::id(&env);
    let cap = EnvironmentCap { id: object::new(ctx), env: env_id };
    events::emit_world_created(env_id, owner);
    transfer::share_object(env);
    cap
}

// ---- read path (lazy, no write, no gas beyond RPC) ----------------------

/// Lazily derive the world's true current value as a pure function of time.
/// Equal to `{ settle_aging(env, clock); state }` for the same `clock` reading.
public fun read_value(env: &Environment, clock: &Clock): WorldState {
    decay::decay(&env.state, clock.timestamp_ms() - env.last_touched, &env.config)
}

// ---- write path ---------------------------------------------------------

/// Settle elapsed aging into stored state, then run the lazy consequence check.
/// Idempotent within a single `clock` reading (second call sees `dt == 0`).
public fun settle_aging(env: &mut Environment, clock: &Clock) {
    assert_version(env);
    settle_aging_internal(env, clock);
}

/// Authorized actor applies an action: settle aging first, then mutate, then
/// check the threshold (lazy consequence), then emit. Cap-gated, not sender.
public fun apply_action(
    env: &mut Environment,
    cap: &EnvironmentCap,
    action: Action,
    clock: &Clock,
) {
    assert_version(env);
    assert!(cap.env == object::id(env), E_WRONG_CAP);
    settle_aging_internal(env, clock);
    env.state = decay::apply_action_to_state(&env.state, action, &env.config);
    check_threshold(env);
    events::emit_world_updated(object::id(env), env.epoch, decay::value(&env.state));
}

/// Agent-authorized action path (Phase 1). Agents do not hold the
/// `EnvironmentCap`; authority comes from a valid `EnvMembership`, which the
/// caller (`agent::step`) verifies before calling this. `public(package)` so
/// only modules in this package can reach it — and it may change on upgrade.
public(package) fun apply_agent_action(
    env: &mut Environment,
    action: Action,
    clock: &Clock,
) {
    assert_version(env);
    settle_aging_internal(env, clock);
    env.state = decay::apply_action_to_state(&env.state, action, &env.config);
    check_threshold(env);
    events::emit_world_updated(object::id(env), env.epoch, decay::value(&env.state));
}

fun settle_aging_internal(env: &mut Environment, clock: &Clock) {
    let now = clock.timestamp_ms();
    let dt = now - env.last_touched;
    if (dt > 0) {
        env.state = decay::decay(&env.state, dt, &env.config);
        env.last_touched = now;
        check_threshold(env);
    }
}

/// Lazy keeper: the consequence fires the first time the world is touched after
/// it has decayed below the floor. Idempotent via the `delisted` latch.
fun check_threshold(env: &mut Environment) {
    if (!env.delisted && decay::below_floor(&env.state, &env.config)) {
        env.delisted = true;
        events::emit_consequence(object::id(env), env.epoch, 0);
    }
}

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

public fun epoch(env: &Environment): u64 { env.epoch }

public fun owner(env: &Environment): address { env.owner }

public fun legit_until(env: &Environment): u64 { env.legit_until }

public fun is_delisted(env: &Environment): bool { env.delisted }

public fun version(env: &Environment): u64 { env.version }

public fun last_touched(env: &Environment): u64 { env.last_touched }

public fun fee_pool_value(env: &Environment): u64 { balance::value(&env.fee_pool) }

/// The *stored* (last-settled) value. For the live value use `read_value`.
public fun state_value(env: &Environment): u64 { decay::value(&env.state) }
