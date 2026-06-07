/// Phase 1 — agent identity & membership.
///
/// Gives an agent an on-chain self (`AgentSBT`, soulbound) and a parallel way
/// to act on a world (`EnvMembership`, owned by the agent). The shared
/// `Environment` carries only the commons; per-agent work rides the owned
/// membership on the fast path, so many agents step one world concurrently.
///
/// Belief is GLOBAL: `belief_score` lives on the soulbound `AgentSBT` and
/// travels with the agent across all worlds.
///
/// Minting is gated by the pre-existing enclave-attested `register::AgentRegistry`.
///
/// Upgrade discipline mirrors `world`: public structs / public fn signatures
/// frozen; logic in private fns; each object carries `version` with a gated
/// `migrate`.
module pols_core::agent;

use sui::table::{Self, Table};
use sui::clock::Clock;
use pols_core::decay::{Self, Action};
use pols_core::environment::{Self, Environment};
use pols_core::register::{Self, AgentRegistry, REGISTER};

const VERSION: u64 = 1;

const E_WRONG_VERSION: u64 = 0;
const E_NOT_REGISTERED: u64 = 1;
const E_ALREADY_MINTED: u64 = 2;
const E_ALREADY_BOUND: u64 = 3;
const E_WRONG_OWNER: u64 = 4;
const E_WRONG_AGENT: u64 = 5;
const E_WRONG_ENV: u64 = 6;
const E_ACTION_TOO_LARGE: u64 = 7;

/// Per-agent risk limits. Enforced in `step`. Illustrative for Phase 1.
public struct RiskCaps has store, copy, drop {
    max_action: u64,
}

/// Soulbound agent identity. `key` only, no `store` -> no `public_transfer`
/// exists for it, so it can never be sold. Holds the global belief score.
public struct AgentSBT has key {
    id: UID,
    owner: address,
    version: u64,
    belief_score: u64,
    caps: RiskCaps,
}

/// Per-agent local state inside one world.
public struct AgentLocal has store, copy, drop {
    steps: u64,
}

/// An agent's non-transferable slot in one world. Owned by the agent's address
/// so it can be used as an owned input (fast path) while stepping.
public struct EnvMembership has key {
    id: UID,
    version: u64,
    agent: ID,
    env: ID,
    local_state: AgentLocal,
    last_step: u64,
}

/// Composite key for the (agent, env) uniqueness guard.
public struct MembershipKey has copy, drop, store {
    agent: ID,
    env: ID,
}

/// Shared singleton enforcing one SBT per address and one membership per
/// (agent, env).
public struct AgentBook has key {
    id: UID,
    version: u64,
    minted: Table<address, ID>,
    memberships: Table<MembershipKey, ID>,
}

/// Authority to migrate the shared `AgentBook` after a package upgrade.
public struct AgentBookCap has key, store {
    id: UID,
}

fun init(ctx: &mut TxContext) {
    let book = AgentBook {
        id: object::new(ctx),
        version: VERSION,
        minted: table::new<address, ID>(ctx),
        memberships: table::new<MembershipKey, ID>(ctx),
    };
    transfer::share_object(book);
    transfer::transfer(AgentBookCap { id: object::new(ctx) }, ctx.sender());
}

public fun new_caps(max_action: u64): RiskCaps {
    RiskCaps { max_action }
}

// ---- mint & bind --------------------------------------------------------

/// Mint a soulbound agent identity. Gated by the enclave-attested registry:
/// the sender must be the address registered at `timestamp_ms`. One per address.
public fun mint_agent(
    book: &mut AgentBook,
    registry: &AgentRegistry<REGISTER>,
    timestamp_ms: u64,
    caps: RiskCaps,
    ctx: &mut TxContext,
) {
    assert_book_version(book);
    let sender = ctx.sender();
    assert!(register::is_registered(registry, timestamp_ms), E_NOT_REGISTERED);
    assert!(register::registered_address(registry, timestamp_ms) == sender, E_NOT_REGISTERED);
    mint_internal(book, caps, sender, ctx);
}

fun mint_internal(book: &mut AgentBook, caps: RiskCaps, owner: address, ctx: &mut TxContext) {
    assert!(!book.minted.contains(owner), E_ALREADY_MINTED);
    let sbt = AgentSBT {
        id: object::new(ctx),
        owner,
        version: VERSION,
        belief_score: 0,
        caps,
    };
    book.minted.add(owner, object::id(&sbt));
    transfer::transfer(sbt, owner); // soulbound: key-only, internal transfer only
}

/// Bind an agent to a world, creating its owned membership slot. One per
/// (agent, env). Possession of `&AgentSBT` + owner check authorizes.
public fun bind(
    book: &mut AgentBook,
    sbt: &AgentSBT,
    env: &Environment,
    ctx: &mut TxContext,
) {
    assert_book_version(book);
    assert!(sbt.owner == ctx.sender(), E_WRONG_OWNER);
    let key = MembershipKey { agent: object::id(sbt), env: object::id(env) };
    assert!(!book.memberships.contains(key), E_ALREADY_BOUND);
    let m = EnvMembership {
        id: object::new(ctx),
        version: VERSION,
        agent: object::id(sbt),
        env: object::id(env),
        local_state: AgentLocal { steps: 0 },
        last_step: 0,
    };
    book.memberships.add(key, object::id(&m));
    transfer::transfer(m, ctx.sender());
}

// ---- step (the parallel fast path) --------------------------------------

/// Step the world through this agent's owned membership. The shared
/// `Environment` is the only contended input; all per-agent writes hit the
/// owned `EnvMembership`. Authorized by the membership (not a cap, not sender).
public fun step(
    env: &mut Environment,
    sbt: &AgentSBT,
    m: &mut EnvMembership,
    action: Action,
    clock: &Clock,
) {
    assert_membership_version(m);
    assert!(m.agent == object::id(sbt), E_WRONG_AGENT);
    assert!(m.env == object::id(env), E_WRONG_ENV);
    assert!(decay::magnitude(&action) <= sbt.caps.max_action, E_ACTION_TOO_LARGE);
    environment::apply_agent_action(env, action, clock);
    m.last_step = clock.timestamp_ms();
    m.local_state.steps = m.local_state.steps + 1;
}

// ---- belief (written by Phase 2 settlement) -----------------------------

public(package) fun add_belief(sbt: &mut AgentSBT, delta: u64) {
    sbt.belief_score = sbt.belief_score + delta;
}

/// Saturating subtraction so belief never underflows.
public(package) fun sub_belief(sbt: &mut AgentSBT, delta: u64) {
    sbt.belief_score = if (delta >= sbt.belief_score) { 0 } else { sbt.belief_score - delta };
}

// ---- upgrade plumbing ---------------------------------------------------

fun assert_book_version(book: &AgentBook) {
    assert!(book.version == VERSION, E_WRONG_VERSION);
}

fun assert_membership_version(m: &EnvMembership) {
    assert!(m.version == VERSION, E_WRONG_VERSION);
}

/// Owner-gated SBT migration (possession of `&mut AgentSBT` + owner match).
public fun migrate_sbt(sbt: &mut AgentSBT, ctx: &TxContext) {
    assert!(sbt.owner == ctx.sender(), E_WRONG_OWNER);
    assert!(sbt.version < VERSION, E_WRONG_VERSION);
    sbt.version = VERSION;
}

/// Migration of an owned membership (possession authorizes).
public fun migrate_membership(m: &mut EnvMembership) {
    assert!(m.version < VERSION, E_WRONG_VERSION);
    m.version = VERSION;
}

/// Cap-gated migration of the shared book.
public fun migrate_book(book: &mut AgentBook, _cap: &AgentBookCap) {
    assert!(book.version < VERSION, E_WRONG_VERSION);
    book.version = VERSION;
}

// ---- views --------------------------------------------------------------

public fun belief_score(sbt: &AgentSBT): u64 { sbt.belief_score }

public fun agent_owner(sbt: &AgentSBT): address { sbt.owner }

public fun max_action(sbt: &AgentSBT): u64 { sbt.caps.max_action }

public fun membership_agent(m: &EnvMembership): ID { m.agent }

public fun membership_env(m: &EnvMembership): ID { m.env }

public fun steps(m: &EnvMembership): u64 { m.local_state.steps }

public fun last_step(m: &EnvMembership): u64 { m.last_step }

public fun is_minted(book: &AgentBook, owner: address): bool {
    book.minted.contains(owner)
}

// ---- test-only ----------------------------------------------------------

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

/// Mint bypassing the registry gate, for exercising bind/step/belief in tests.
/// Still enforces the one-per-address book guard.
#[test_only]
public fun mint_for_testing(book: &mut AgentBook, caps: RiskCaps, ctx: &mut TxContext) {
    mint_internal(book, caps, ctx.sender(), ctx);
}
