#[test_only]
module pols_core::agent_tests;

use std::string;
use sui::clock;
use sui::test_scenario as ts;
use pols_core::decay;
use pols_core::environment::{Self as world, Environment};
use pols_core::agent::{Self, AgentBook, AgentSBT, EnvMembership};

const ALICE: address = @0xA11CE;
const BOB: address = @0xB0B;

// Spin up a world and an AgentBook, returning to a fresh tx ready to act.
fun setup(sc: &mut ts::Scenario, clk: &clock::Clock) {
    agent::init_for_testing(sc.ctx());
    let cap = world::create_world(
        string::utf8(b"w"), string::utf8(b""), vector[], string::utf8(b""),
        decay::new_config(0, 0, 1_000_000), 1_000, clk, sc.ctx(),
    );
    transfer::public_transfer(cap, ALICE);
}

#[test]
fun mint_then_bind_then_step() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    setup(&mut sc, &clk);

    // Alice mints her soulbound SBT.
    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx());
    assert!(agent::is_minted(&book, ALICE), 0);

    // Alice binds to the world.
    sc.next_tx(ALICE);
    let sbt = sc.take_from_sender<AgentSBT>();
    let env = sc.take_shared<Environment>();
    agent::bind(&mut book, &sbt, &env, sc.ctx());
    ts::return_shared(env);

    // Alice steps the world through her owned membership.
    sc.next_tx(ALICE);
    let mut env = sc.take_shared<Environment>();
    let mut m = sc.take_from_sender<EnvMembership>();
    agent::step(&mut env, &sbt, &mut m, decay::drain(100), &clk);
    assert!(agent::steps(&m) == 1, 1);
    assert!(world::state_value(&env) == 900, 2);

    ts::return_shared(env);
    sc.return_to_sender(m);
    sc.return_to_sender(sbt);
    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = agent::E_ALREADY_MINTED)]
fun cannot_mint_twice() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    agent::init_for_testing(sc.ctx());

    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx());
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx()); // second -> abort

    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = agent::E_ALREADY_BOUND)]
fun cannot_bind_twice_to_same_world() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    setup(&mut sc, &clk);

    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx());

    sc.next_tx(ALICE);
    let sbt = sc.take_from_sender<AgentSBT>();
    let env = sc.take_shared<Environment>();
    agent::bind(&mut book, &sbt, &env, sc.ctx());
    agent::bind(&mut book, &sbt, &env, sc.ctx()); // duplicate -> abort

    ts::return_shared(env);
    sc.return_to_sender(sbt);
    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = agent::E_ACTION_TOO_LARGE)]
fun step_respects_risk_cap() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    setup(&mut sc, &clk);

    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(50), sc.ctx()); // cap 50

    sc.next_tx(ALICE);
    let sbt = sc.take_from_sender<AgentSBT>();
    let mut env = sc.take_shared<Environment>();
    agent::bind(&mut book, &sbt, &env, sc.ctx());

    sc.next_tx(ALICE);
    let mut m = sc.take_from_sender<EnvMembership>();
    agent::step(&mut env, &sbt, &mut m, decay::drain(100), &clk); // 100 > 50 -> abort

    ts::return_shared(env);
    sc.return_to_sender(m);
    sc.return_to_sender(sbt);
    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}

#[test]
#[expected_failure(abort_code = agent::E_WRONG_AGENT)]
fun cannot_step_with_foreign_sbt() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    setup(&mut sc, &clk);

    // Alice mints + binds.
    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx());
    sc.next_tx(ALICE);
    let alice_sbt = sc.take_from_sender<AgentSBT>();
    let env = sc.take_shared<Environment>();
    agent::bind(&mut book, &alice_sbt, &env, sc.ctx());
    ts::return_shared(env);

    // Bob mints his own SBT.
    sc.next_tx(BOB);
    agent::mint_for_testing(&mut book, agent::new_caps(500), sc.ctx());
    sc.next_tx(BOB);
    let bob_sbt = sc.take_from_sender<AgentSBT>();

    // Alice's membership + Bob's SBT -> mismatch abort.
    sc.next_tx(ALICE);
    let mut env = sc.take_shared<Environment>();
    let mut m = sc.take_from_sender<EnvMembership>();
    agent::step(&mut env, &bob_sbt, &mut m, decay::drain(1), &clk);

    ts::return_shared(env);
    sc.return_to_sender(m);
    sc.return_to_sender(alice_sbt);
    ts::return_to_address(BOB, bob_sbt);
    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}

// Two agents step the SAME world, each through its OWN owned membership.
// Proves per-agent state is independent (no shared contention on membership).
#[test]
fun two_agents_step_one_world() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    setup(&mut sc, &clk);

    sc.next_tx(ALICE);
    let mut book = sc.take_shared<AgentBook>();
    agent::mint_for_testing(&mut book, agent::new_caps(1_000), sc.ctx());
    sc.next_tx(BOB);
    agent::mint_for_testing(&mut book, agent::new_caps(1_000), sc.ctx());

    // Alice binds + steps.
    sc.next_tx(ALICE);
    let a_sbt = sc.take_from_sender<AgentSBT>();
    let env = sc.take_shared<Environment>();
    agent::bind(&mut book, &a_sbt, &env, sc.ctx());
    ts::return_shared(env);
    sc.next_tx(ALICE);
    let mut env = sc.take_shared<Environment>();
    let mut a_m = sc.take_from_sender<EnvMembership>();
    agent::step(&mut env, &a_sbt, &mut a_m, decay::drain(100), &clk);
    ts::return_shared(env);

    // Bob binds + steps.
    sc.next_tx(BOB);
    let b_sbt = sc.take_from_sender<AgentSBT>();
    let env = sc.take_shared<Environment>();
    agent::bind(&mut book, &b_sbt, &env, sc.ctx());
    ts::return_shared(env);
    sc.next_tx(BOB);
    let mut env = sc.take_shared<Environment>();
    let mut b_m = sc.take_from_sender<EnvMembership>();
    agent::step(&mut env, &b_sbt, &mut b_m, decay::drain(100), &clk);

    // Each membership tracks only its own agent's steps.
    assert!(agent::steps(&a_m) == 1, 0);
    assert!(agent::steps(&b_m) == 1, 1);
    assert!(world::state_value(&env) == 800, 2); // both drains hit the commons

    ts::return_shared(env);
    ts::return_to_address(ALICE, a_m);
    ts::return_to_address(ALICE, a_sbt);
    ts::return_to_address(BOB, b_m);
    ts::return_to_address(BOB, b_sbt);
    ts::return_shared(book);
    clock::destroy_for_testing(clk);
    sc.end();
}
