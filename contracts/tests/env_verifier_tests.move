#[test_only]
module pols_core::env_verifier_tests;

use std::string;
use sui::test_scenario as ts;
use pols_core::env_verifier::{Self as ev, EpochAttestation};

const OWNER: address = @0xA11CE;

// Canonical Nautilus epoch-attestation vector (sk = 0x01..0x20):
//   env=id(@0x07) model="qwen-0.5b" n=8 reward_bps=6200 pass_bps=5000
//   dataset_hash=sha256("sort-list-v1") intent=0 ts=1718000000000
const APK: vector<u8> = x"0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0";
const DHASH: vector<u8> = x"15807d009418e61f90965ab7da54843fd8ef582721df67f613effb502b340060";
const SIG: vector<u8> = x"40c4b22f7a0052d13632c609267bfb31ce4fde4996b9eba5c5732c4ccbd5cb8b3d8cfaa47126b9998429808c3513aabdcfcf9f7c39307bb70aae3de172d93eb6";
const TS: u64 = 1718000000000;

#[test]
fun verify_epoch_mints_attestation() {
    let mut sc = ts::begin(OWNER);
    let env = object::id_from_address(@0x07);
    ev::verify_epoch(
        env, APK, 0, TS, string::utf8(b"qwen-0.5b"), 8, 6200, 5000, DHASH, SIG, sc.ctx(),
    );
    sc.next_tx(OWNER);
    let a = sc.take_from_sender<EpochAttestation>();
    assert!(ev::att_reward_bps(&a) == 6200, 0);
    assert!(ev::att_pass_bps(&a) == 5000, 1);
    assert!(ev::att_n_samples(&a) == 8, 2);
    assert!(ev::att_env(&a) == env, 3);
    sc.return_to_sender(a);
    sc.end();
}

#[test]
#[expected_failure(abort_code = ev::E_BAD_ATTESTATION)]
fun verify_epoch_bad_sig_aborts() {
    let mut sc = ts::begin(OWNER);
    let env = object::id_from_address(@0x07);
    // tamper: pass_bps 5000 -> 9999, signature no longer matches
    ev::verify_epoch(
        env, APK, 0, TS, string::utf8(b"qwen-0.5b"), 8, 6200, 9999, DHASH, SIG, sc.ctx(),
    );
    sc.end();
}
