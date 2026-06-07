#[test_only]
module pols_core::world_tests;

use std::string::{Self, String};
use sui::clock;
use sui::test_scenario as ts;
use pols_core::decay;
use pols_core::environment::{Self as world, Environment};

const OWNER: address = @0xA11CE;
const DAY_MS: u64 = 86_400_000;

// ---- registry metadata fixtures ----------------------------------------

fun sample_tags(): vector<String> {
    vector[string::utf8(b"single-turn"), string::utf8(b"toy")]
}

// Create a world with placeholder metadata for the decay-focused tests that
// don't care about the registry fields.
fun bare(
    config: decay::Config,
    init: u64,
    clk: &clock::Clock,
    ctx: &mut TxContext,
): world::EnvironmentCap {
    world::create_world(
        string::utf8(b"w"), string::utf8(b""), vector[], string::utf8(b""),
        config, init, clk, ctx,
    )
}

fun create_with_meta(
    name: vector<u8>,
    clk: &clock::Clock,
    ctx: &mut TxContext,
): world::EnvironmentCap {
    world::create_world(
        string::utf8(name),
        string::utf8(b"a toy reference environment"),
        sample_tags(),
        string::utf8(b"walrus://blob-abc"),
        decay::new_config(0, 0, 1_000),
        1_000,
        clk,
        ctx,
    )
}

// ---- registry metadata tests -------------------------------------------

#[test]
fun create_exposes_metadata() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());
    let cap = create_with_meta(b"toybench", &clk, sc.ctx());

    sc.next_tx(OWNER);
    let env = sc.take_shared<Environment>();

    assert!(world::name(&env) == string::utf8(b"toybench"), 0);
    assert!(world::description(&env) == string::utf8(b"a toy reference environment"), 1);
    assert!(world::tags(&env) == sample_tags(), 2);
    assert!(world::artifact_uri(&env) == string::utf8(b"walrus://blob-abc"), 3);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun update_metadata_changes_descriptive_fields() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());
    let cap = create_with_meta(b"toybench", &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    let new_tags = vector[string::utf8(b"multi-turn")];
    world::update_metadata(
        &mut env,
        &cap,
        string::utf8(b"toybench-v2"),
        string::utf8(b"now multi-turn"),
        new_tags,
    );

    assert!(world::name(&env) == string::utf8(b"toybench-v2"), 0);
    assert!(world::description(&env) == string::utf8(b"now multi-turn"), 1);
    assert!(world::tags(&env) == vector[string::utf8(b"multi-turn")], 2);
    // artifact pointer is untouched by update_metadata
    assert!(world::artifact_uri(&env) == string::utf8(b"walrus://blob-abc"), 3);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun publish_artifact_changes_pointer_only() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());
    let cap = create_with_meta(b"toybench", &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    world::publish_artifact(&mut env, &cap, string::utf8(b"walrus://blob-xyz"));

    assert!(world::artifact_uri(&env) == string::utf8(b"walrus://blob-xyz"), 0);
    // descriptive fields untouched by publish_artifact
    assert!(world::name(&env) == string::utf8(b"toybench"), 1);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = world::E_WRONG_CAP)]
fun update_metadata_wrong_cap_rejected() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());

    let cap_a = create_with_meta(b"world-a", &clk, sc.ctx());
    sc.next_tx(OWNER);
    let id_a = ts::most_recent_id_shared<Environment>().extract();

    let cap_b = create_with_meta(b"world-b", &clk, sc.ctx());
    sc.next_tx(OWNER);

    let mut env_a = sc.take_shared_by_id<Environment>(id_a);
    world::update_metadata(
        &mut env_a,
        &cap_b, // wrong cap
        string::utf8(b"hijack"),
        string::utf8(b""),
        vector[],
    );

    ts::return_shared(env_a);
    transfer::public_transfer(cap_a, OWNER);
    transfer::public_transfer(cap_b, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

// ---- pure decay unit tests ---------------------------------------------

#[test]
fun decay_never_increases() {
    let c = decay::new_config(5_000, 10, 1_000); // 50%/day
    let mut v = 0;
    while (v <= 1_000) {
        let s = decay::new_state(v);
        let mut dt = 0;
        while (dt <= 3 * DAY_MS) {
            let after = decay::decay(&s, dt, &c);
            assert!(decay::value(&after) <= v, 0);
            dt = dt + DAY_MS / 3;
        };
        v = v + 137;
    }
}

#[test]
fun decay_dt_zero_is_noop() {
    let c = decay::new_config(9_999, 0, 1_000);
    let s = decay::new_state(500);
    assert!(decay::value(&decay::decay(&s, 0, &c)) == 500, 0);
}

#[test]
fun decay_saturates_at_zero() {
    let c = decay::new_config(10_000, 0, 1_000); // 100%/day
    let s = decay::new_state(1_000);
    // Many days out, value can never go negative; clamps at 0.
    assert!(decay::value(&decay::decay(&s, 100 * DAY_MS, &c)) == 0, 0);
}

#[test]
fun replenish_capped_at_ceil() {
    let c = decay::new_config(0, 0, 1_000);
    let s = decay::new_state(900);
    let after = decay::apply_action_to_state(&s, decay::replenish(500), &c);
    assert!(decay::value(&after) == 1_000, 0); // capped, no unbounded mint
}

#[test]
fun drain_saturates_at_zero() {
    let c = decay::new_config(0, 0, 1_000);
    let s = decay::new_state(100);
    let after = decay::apply_action_to_state(&s, decay::drain(999), &c);
    assert!(decay::value(&after) == 0, 0);
}

// ---- world invariants (test_scenario) ----------------------------------

#[test]
fun lazy_read_equals_settled_write() {
    let mut sc = ts::begin(OWNER);
    let mut clk = clock::create_for_testing(sc.ctx());

    let cap = bare(decay::new_config(5_000, 10, 1_000), 1_000, &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    // advance time by a non-trivial, arbitrary amount
    clk.increment_for_testing(7 * DAY_MS + 12_345);

    let lazy = decay::value(&world::read_value(&env, &clk));
    world::settle_aging(&mut env, &clk);
    let settled = world::state_value(&env);
    assert!(lazy == settled, 0);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun settle_is_idempotent_within_now() {
    let mut sc = ts::begin(OWNER);
    let mut clk = clock::create_for_testing(sc.ctx());
    let cap = bare(decay::new_config(5_000, 10, 1_000), 1_000, &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    clk.increment_for_testing(2 * DAY_MS);
    world::settle_aging(&mut env, &clk);
    let once = world::state_value(&env);
    world::settle_aging(&mut env, &clk); // same `now` -> dt == 0
    let twice = world::state_value(&env);
    assert!(once == twice, 0);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun decay_below_floor_triggers_delist() {
    let mut sc = ts::begin(OWNER);
    let mut clk = clock::create_for_testing(sc.ctx());
    // floor 500, 90%/day decay, start at 1000.
    let cap = bare(decay::new_config(9_000, 500, 1_000), 1_000, &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();
    assert!(!world::is_delisted(&env), 0);

    clk.increment_for_testing(2 * DAY_MS); // decays well under the floor
    world::settle_aging(&mut env, &clk);
    assert!(world::is_delisted(&env), 1); // lazy consequence fired on touch

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
fun drain_action_can_trigger_delist() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());
    let cap = bare(decay::new_config(0, 500, 1_000), 1_000, &clk, sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    world::apply_action(&mut env, &cap, decay::drain(600), &clk); // 1000 -> 400 < 500
    assert!(world::is_delisted(&env), 0);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = world::E_WRONG_CAP)]
fun wrong_cap_rejected() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(sc.ctx());

    // World A, then capture its shared id before world B exists.
    let cap_a = bare(decay::new_config(0, 0, 1_000), 1_000, &clk, sc.ctx());
    sc.next_tx(OWNER);
    let id_a = ts::most_recent_id_shared<Environment>().extract();

    // World B yields a cap that does NOT authorize world A.
    let cap_b = bare(decay::new_config(0, 0, 1_000), 1_000, &clk, sc.ctx());
    sc.next_tx(OWNER);

    let mut env_a = sc.take_shared_by_id<Environment>(id_a);
    world::apply_action(&mut env_a, &cap_b, decay::drain(1), &clk); // wrong cap -> abort

    ts::return_shared(env_a);
    transfer::public_transfer(cap_a, OWNER);
    transfer::public_transfer(cap_b, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}
