#[test_only]
module pols_core::inference_market_tests;

use std::string;
use sui::test_scenario as ts;
use sui::coin;
use sui::clock;
use sui::sui::SUI;
use pols_core::environment::{Self as world, Environment};
use pols_core::inference_market::{Self as market, ModelRegistry};

const OWNER: address = @0xA11CE;
const BUYER: address = @0xB0B;

fun new_env(ctx: &mut TxContext): world::EnvironmentCap {
    world::create_world(
        string::utf8(b"lean-proof"),
        string::utf8(b"lean theorem proving"),
        vector[],
        string::utf8(b"walrus://env"),
        ctx,
    )
}

#[test]
fun publish_advances_current_best() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());

    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, sc.ctx());

    sc.next_tx(OWNER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let clock = clock::create_for_testing(sc.ctx());

    market::publish_checkpoint(&mut registry, &pub_cap, string::utf8(b"blob-v0"), 2000, &clock);
    market::publish_checkpoint(&mut registry, &pub_cap, string::utf8(b"blob-v1"), 5500, &clock);

    assert!(market::version_count(&registry) == 2, 0);
    assert!(market::current_best(&registry) == 1, 1);
    assert!(market::pass_rate_of(&registry, 1) == 5500, 2);
    assert!(market::blob_of(&registry, 1) == string::utf8(b"blob-v1"), 3);

    clock::destroy_for_testing(clock);
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(registry);
    sc.end();
}

#[test]
fun buy_inference_splits_fee_and_issues_receipt() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());

    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, sc.ctx());

    sc.next_tx(OWNER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let clock = clock::create_for_testing(sc.ctx());
    market::publish_checkpoint(&mut registry, &pub_cap, string::utf8(b"blob-v0"), 2000, &clock);

    sc.next_tx(BUYER);
    let mut env = sc.take_shared_by_id<Environment>(env_id);
    let pay = coin::mint_for_testing<SUI>(1000, sc.ctx());

    let receipt = market::buy_inference(&mut registry, &mut env, 7, pay, sc.ctx());

    assert!(market::receipt_paid(&receipt) == 1000, 0);
    assert!(market::receipt_version(&receipt) == 0, 1);
    assert!(world::fee_pool_value(&env) == 300, 2); // 30% to env
    assert!(market::fee_pool_value(&registry) == 700, 3); // 70% to model
    assert!(market::total_calls(&registry) == 1, 4);

    clock::destroy_for_testing(clock);
    transfer::public_transfer(receipt, BUYER);
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(env);
    ts::return_shared(registry);
    sc.end();
}

#[test]
#[expected_failure(abort_code = market::E_NO_CHECKPOINT)]
fun buy_before_any_checkpoint_aborts() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());

    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, sc.ctx());

    sc.next_tx(BUYER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let mut env = sc.take_shared_by_id<Environment>(env_id);
    let pay = coin::mint_for_testing<SUI>(1000, sc.ctx());

    let receipt = market::buy_inference(&mut registry, &mut env, 1, pay, sc.ctx());

    transfer::public_transfer(receipt, BUYER);
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(env);
    ts::return_shared(registry);
    sc.end();
}

#[test]
#[expected_failure(abort_code = market::E_WRONG_CAP)]
fun publish_with_wrong_cap_aborts() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());

    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let cap_a = market::create_registry(env_id, sc.ctx());
    sc.next_tx(OWNER);
    let id_a = ts::most_recent_id_shared<ModelRegistry>().extract();

    let cap_b = market::create_registry(env_id, sc.ctx());
    sc.next_tx(OWNER);

    let mut reg_a = sc.take_shared_by_id<ModelRegistry>(id_a);
    let clock = clock::create_for_testing(sc.ctx());
    market::publish_checkpoint(&mut reg_a, &cap_b, string::utf8(b"x"), 1, &clock); // wrong cap

    clock::destroy_for_testing(clock);
    transfer::public_transfer(cap_a, OWNER);
    transfer::public_transfer(cap_b, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(reg_a);
    sc.end();
}
