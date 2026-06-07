#[test_only]
module pols_core::world_tests;

use std::string::{Self, String};
use sui::test_scenario as ts;
use pols_core::environment::{Self as world, Environment};

const OWNER: address = @0xA11CE;

// ---- registry metadata fixtures ----------------------------------------

fun sample_tags(): vector<String> {
    vector[string::utf8(b"single-turn"), string::utf8(b"toy")]
}

fun create_with_meta(name: vector<u8>, ctx: &mut TxContext): world::EnvironmentCap {
    world::create_world(
        string::utf8(name),
        string::utf8(b"a toy reference environment"),
        sample_tags(),
        string::utf8(b"walrus://blob-abc"),
        ctx,
    )
}

// ---- registry metadata tests -------------------------------------------

#[test]
fun create_exposes_metadata() {
    let mut sc = ts::begin(OWNER);
    let cap = create_with_meta(b"toybench", sc.ctx());

    sc.next_tx(OWNER);
    let env = sc.take_shared<Environment>();

    assert!(world::name(&env) == string::utf8(b"toybench"), 0);
    assert!(world::description(&env) == string::utf8(b"a toy reference environment"), 1);
    assert!(world::tags(&env) == sample_tags(), 2);
    assert!(world::artifact_uri(&env) == string::utf8(b"walrus://blob-abc"), 3);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    sc.end();
}

#[test]
fun update_metadata_changes_descriptive_fields() {
    let mut sc = ts::begin(OWNER);
    let cap = create_with_meta(b"toybench", sc.ctx());

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
    sc.end();
}

#[test]
fun publish_artifact_changes_pointer_only() {
    let mut sc = ts::begin(OWNER);
    let cap = create_with_meta(b"toybench", sc.ctx());

    sc.next_tx(OWNER);
    let mut env = sc.take_shared<Environment>();

    world::publish_artifact(&mut env, &cap, string::utf8(b"walrus://blob-xyz"));

    assert!(world::artifact_uri(&env) == string::utf8(b"walrus://blob-xyz"), 0);
    // descriptive fields untouched by publish_artifact
    assert!(world::name(&env) == string::utf8(b"toybench"), 1);

    ts::return_shared(env);
    transfer::public_transfer(cap, OWNER);
    sc.end();
}

#[test]
#[expected_failure(abort_code = world::E_WRONG_CAP)]
fun update_metadata_wrong_cap_rejected() {
    let mut sc = ts::begin(OWNER);

    let cap_a = create_with_meta(b"world-a", sc.ctx());
    sc.next_tx(OWNER);
    let id_a = ts::most_recent_id_shared<Environment>().extract();

    let cap_b = create_with_meta(b"world-b", sc.ctx());
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
    sc.end();
}
