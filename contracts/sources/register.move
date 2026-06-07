module pols_core::register;

use std::bcs;
use std::string::String;
use sui::table::{Self, Table};
use sui::event;
use sui::ecdsa_k1;
use pols_core::enclave::{Self, Enclave};

// Error codes
const EInvalidSignature: u64 = 0;
const EAgentAlreadyRegistered: u64 = 1;

/// One-time witness for module initialization
public struct REGISTER has drop {}

/// IntentMessage wrapper (must match Rust IntentMessage structure)
public struct IntentMessage<T: copy + drop> has copy, drop {
    intent: u8,
    timestamp_ms: u64,
    data: T,
}

/// Registry of agents that have been registered via an enclave attestation.
/// `registrations` maps the attestation `timestamp_ms` to the registered
/// agent address; it doubles as a replay guard (a given timestamp can only
/// be claimed once).
public struct AgentRegistry<phantom T> has key {
    id: UID,
    registrations: Table<u64, address>,
    latest_timestamp: u64,
}

/// Agent profile payload signed by the enclave. Field order/types must
/// match the Rust `AgentProfilePayload` and the JSON returned by
/// `/api/verify-token` so BCS encodings line up byte-for-byte.
public struct AgentProfile has copy, drop {
    name: String,
    role: String,
    description: String,
    addr: address,
}

// Events
public struct AgentRegistered has copy, drop {
    registry: ID,
    addr: address,
    timestamp_ms: u64,
}

public struct RegistryCreated has copy, drop {
    registry_id: ID,
}

/// Create the agent registry
fun create_registry<T>(ctx: &mut TxContext): AgentRegistry<T> {
    let registry = AgentRegistry<T> {
        id: object::new(ctx),
        registrations: table::new(ctx),
        latest_timestamp: 0,
    };

    event::emit(RegistryCreated {
        registry_id: object::id(&registry),
    });

    registry
}

/// Share the registry to make it publicly accessible
fun share_registry<T>(registry: AgentRegistry<T>) {
    transfer::share_object(registry);
}

/// Verify the enclave's attestation over an `AgentProfile` and register
/// the agent. The enclave fetches the profile from `/api/verify-token`,
/// wraps it in an `IntentMessage`, BCS-encodes it, and signs the SHA256
/// digest with secp256k1. We reconstruct the same bytes here and verify.
fun verify_and_register<T: drop>(
    registry: &mut AgentRegistry<T>,
    enclave: &Enclave<T>,
    name: String,
    role: String,
    description: String,
    addr: address,
    timestamp_ms: u64,
    signature: vector<u8>,
) {
    let payload = AgentProfile {
        name,
        role,
        description,
        addr,
    };

    let intent_message = IntentMessage {
        intent: 0u8,
        timestamp_ms,
        data: payload,
    };
    let message_bytes = bcs::to_bytes(&intent_message);

    let enclave_pk = enclave.pk();

    let is_valid = ecdsa_k1::secp256k1_verify(
        &signature,
        enclave_pk,
        &message_bytes,
        1 // SHA256
    );
    assert!(is_valid, EInvalidSignature);

    // Record the registration so a given (registry, timestamp_ms) can only
    // be claimed once, preventing trivial replays.
    assert!(!table::contains(&registry.registrations, timestamp_ms), EAgentAlreadyRegistered);
    table::add(&mut registry.registrations, timestamp_ms, addr);

    if (timestamp_ms > registry.latest_timestamp) {
        registry.latest_timestamp = timestamp_ms;
    };

    event::emit(AgentRegistered {
        registry: *registry.id.as_inner(),
        addr,
        timestamp_ms,
    });
}

/// Whether an agent was registered at the given attestation timestamp
public fun is_registered<T>(registry: &AgentRegistry<T>, timestamp_ms: u64): bool {
    table::contains(&registry.registrations, timestamp_ms)
}

/// The agent address registered at the given attestation timestamp
public fun registered_address<T>(registry: &AgentRegistry<T>, timestamp_ms: u64): address {
    *table::borrow(&registry.registrations, timestamp_ms)
}

/// The timestamp of the most recent registration
public fun latest_timestamp<T>(registry: &AgentRegistry<T>): u64 {
    registry.latest_timestamp
}

/// Module initializer - sets up enclave config
/// The registry will be created after enclave registration
fun init(witness: REGISTER, ctx: &mut TxContext) {
    // Create the enclave capability
    let cap = enclave::new_cap(witness, ctx);

    // Create the enclave configuration with PCR values
    cap.create_enclave_config(
        b"Polius Agent Registry Enclave".to_string(),
        // PCR0: Enclave image file hash - update after building your enclave
        x"3aa0e6e6ed7d8301655fced7e6ddcc443a3e57bf62f070caa6becf337069e859c0f03d68136440ff1cab8adefd20634c",
        // PCR1: Enclave kernel hash - update after building your enclave
        x"b0d319fa64f9c2c9d7e9187bc21001ddacfab4077e737957fa1b8b97cc993bed43a79019aebfd40ee5f6f213147909f8",
        // PCR2: Enclave application hash - update after building your enclave
        x"fdb2295dc5d9b67a653ed5f3ead5fc8166ec3cae1de1c7c6f31c3b43b2eb26ab5d063f414f3d2b93163426805dfe057e",
        // PCR16: Application image hash - update after building your application
        x"94a33ba1298c64a16a1f4c9cc716525c86497017e09dd976afcaf812b0e2a3e8ba04ff6954167ad69a6413a1e6e44621",
        ctx,
    );

    // Transfer the capability to the deployer for future PCR updates
    transfer::public_transfer(cap, ctx.sender());
}

/// Entry function to create and share the registry after enclave registration
/// Call this once your enclave is registered on-chain
entry fun initialize_registry(ctx: &mut TxContext) {
    let registry = create_registry<REGISTER>(ctx);
    share_registry(registry);
}

/// Entry function: submit an enclave-attested agent profile and register it.
/// `signature` is the secp256k1 signature over BCS(IntentMessage { 0, ts, AgentProfile{..} }).
entry fun register_agent(
    registry: &mut AgentRegistry<REGISTER>,
    enclave: &Enclave<REGISTER>,
    name: String,
    role: String,
    description: String,
    addr: address,
    timestamp_ms: u64,
    signature: vector<u8>,
) {
    verify_and_register(
        registry,
        enclave,
        name,
        role,
        description,
        addr,
        timestamp_ms,
        signature,
    );
}

#[test_only]
public fun destroy_registry_for_testing<T>(registry: AgentRegistry<T>) {
    let AgentRegistry { id, registrations, latest_timestamp: _ } = registry;
    table::drop(registrations);
    object::delete(id);
}
