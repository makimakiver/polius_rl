#[test_only]
module pols_core::world_tests;

use sui::clock;
use sui::test_scenario as ts;
use pols_core::decay;
use pols_core::world::{Self, Environment};

const OWNER: address = @0xA11CE;
const DAY_MS: u64 = 86_400_000;

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

    let cap = world::create_world(decay::new_config(5_000, 10, 1_000), 1_000, &clk, sc.ctx());

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
    let cap = world::create_world(decay::new_config(5_000, 10, 1_000), 1_000, &clk, sc.ctx());

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
    let cap = world::create_world(decay::new_config(9_000, 500, 1_000), 1_000, &clk, sc.ctx());

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
    let cap = world::create_world(decay::new_config(0, 500, 1_000), 1_000, &clk, sc.ctx());

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
    let cap_a = world::create_world(decay::new_config(0, 0, 1_000), 1_000, &clk, sc.ctx());
    sc.next_tx(OWNER);
    let id_a = ts::most_recent_id_shared<Environment>().extract();

    // World B yields a cap that does NOT authorize world A.
    let cap_b = world::create_world(decay::new_config(0, 0, 1_000), 1_000, &clk, sc.ctx());
    sc.next_tx(OWNER);

    let mut env_a = sc.take_shared_by_id<Environment>(id_a);
    world::apply_action(&mut env_a, &cap_b, decay::drain(1), &clk); // wrong cap -> abort

    ts::return_shared(env_a);
    transfer::public_transfer(cap_a, OWNER);
    transfer::public_transfer(cap_b, OWNER);
    clock::destroy_for_testing(clk);
    sc.end();
}
