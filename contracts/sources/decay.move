/// Pure world dynamics. No Sui objects, no `key` abilities, no `Clock`, no I/O.
///
/// This module is the SINGLE source of dynamics: both the lazy read-path
/// (`world::read_value`) and the settling write-path (`world::settle_aging`)
/// call `decay` here, so they can never disagree about how a world ages.
///
/// Upgrade note: the public *signatures* below are frozen, but every function
/// body may be rewritten on a package upgrade. In particular `decay` can be
/// swapped from the current value-proportional shrink to a different curve
/// (e.g. true exponential fixed-point) without breaking any caller.
module pols_core::decay;

/// Milliseconds in a day. Rate constants are expressed per-day.
const MS_PER_DAY: u64 = 86_400_000;
/// Basis-point denominator (100% == 10_000 bps).
const BPS_DENOM: u64 = 10_000;

/// The decayable state of a world. Phase 0 ships a single resource value.
/// Adding fields later is an upgrade-compatible change (struct grows, never
/// removes/reorders public fields — we expose data via accessors, not fields).
public struct WorldState has store, copy, drop {
    value: u64,
}

/// Static dynamics + thresholds for a world.
/// `decay_bps_per_day` is the fraction of the *current* value lost per day.
/// `floor` is the consequence threshold (drop below it -> delist).
/// `ceil` caps replenishment so there is no unbounded mint path.
public struct Config has store, copy, drop {
    decay_bps_per_day: u64,
    floor: u64,
    ceil: u64,
}

/// The action space an authorized actor can apply to a world.
public enum Action has copy, drop {
    Replenish(u64),
    Drain(u64),
}

// ---- constructors -------------------------------------------------------

public fun new_state(value: u64): WorldState {
    WorldState { value }
}

public fun new_config(decay_bps_per_day: u64, floor: u64, ceil: u64): Config {
    Config { decay_bps_per_day, floor, ceil }
}

public fun replenish(amount: u64): Action {
    Action::Replenish(amount)
}

public fun drain(amount: u64): Action {
    Action::Drain(amount)
}

// ---- accessors ----------------------------------------------------------

public fun value(s: &WorldState): u64 {
    s.value
}

public fun decay_bps_per_day(c: &Config): u64 {
    c.decay_bps_per_day
}

public fun floor(c: &Config): u64 {
    c.floor
}

public fun ceil(c: &Config): u64 {
    c.ceil
}

// ---- dynamics -----------------------------------------------------------

/// Age `s` forward by `dt` milliseconds. Value shrinks toward 0 in proportion
/// to the time elapsed and the current value; it NEVER increases here (no mint
/// path lives in `decay`). Computed in u128 to avoid overflow, then clamped.
///
/// Invariant (tested): `decay(s, dt, c).value <= s.value` for all inputs.
public fun decay(s: &WorldState, dt: u64, c: &Config): WorldState {
    let v = s.value;
    if (v == 0 || dt == 0 || c.decay_bps_per_day == 0) {
        return WorldState { value: v }
    };
    // drop = v * decay_bps_per_day * dt / (BPS_DENOM * MS_PER_DAY)
    let numer = (v as u128) * (c.decay_bps_per_day as u128) * (dt as u128);
    let denom = (BPS_DENOM as u128) * (MS_PER_DAY as u128);
    let drop = numer / denom;
    let drop_u64 = if (drop >= (v as u128)) { v } else { (drop as u64) };
    WorldState { value: v - drop_u64 }
}

/// Apply an action to state, bounded by `[0, ceil]`. Replenish is capped at
/// `ceil` (no unbounded mint); Drain saturates at 0 (no underflow).
public fun apply_action_to_state(s: &WorldState, a: Action, c: &Config): WorldState {
    match (a) {
        Action::Replenish(amount) => {
            let raw = s.value + amount;
            let capped = if (raw > c.ceil) { c.ceil } else { raw };
            WorldState { value: capped }
        },
        Action::Drain(amount) => {
            let v = if (amount >= s.value) { 0 } else { s.value - amount };
            WorldState { value: v }
        },
    }
}

/// True when the world has decayed below its consequence threshold.
public fun below_floor(s: &WorldState, c: &Config): bool {
    s.value < c.floor
}

/// The size of an action, used by agent risk caps (Phase 1).
public fun magnitude(a: &Action): u64 {
    match (a) {
        Action::Replenish(amount) => *amount,
        Action::Drain(amount) => *amount,
    }
}
