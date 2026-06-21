# pollius-env

Deploy reinforcement-learning environments **on-chain** on [Sui](https://sui.io), the
way Pollius does it: validate the dataset, upload it to [Walrus](https://walrus.xyz)
decentralized storage, register an `Environment` object, and (optionally) run one
verification epoch on a sample OSS LLM that is **attested by a TEE** (Nautilus / AWS
Nitro enclave) and recorded on-chain as an `EpochAttestation`.

## Install

```bash
npm i -g pollius-env
# or run without installing:
npx pollius-env deploy ./my-env --epoch
```

## Usage

```bash
pollius-env deploy <dir> [--epoch]
```

- `<dir>` — an environment bundle directory (see layout below).
- `--epoch` — also run one attested verification epoch and mint an on-chain
  `EpochAttestation` bound to the new environment.

### Bundle layout

```
my-env/
  manifest.json   { "name", "description"?, "tags"?, "system"?, "grader"? }
  dataset.json    [ { "question": "...", "answer": "..." }, ... ]
  reward.py       (optional) grader code, uploaded to Walrus for transparency
```

### Configuration

Read from the environment, or from a `.env.local` file in the current directory:

| Variable                  | Required | Default                                      |
| ------------------------- | -------- | -------------------------------------------- |
| `NEXT_PUBLIC_PKG_ID`      | yes      | —                                            |
| `NEXT_PUBLIC_SUI_NETWORK` | no       | `testnet`                                    |
| `PY_VERIFIER_URL`         | no       | `http://localhost:8077`                      |
| `WALRUS_PUBLISHER`        | no       | `https://publisher.walrus-testnet.walrus.space` |

On-chain registration uses your local **Sui CLI** keystore (`sui client active-address`);
the tool never handles private keys.

## What it produces

```
✓ Environment deployed on testnet
  env object  : 0xde75…              # shared Environment (anyone can read)
  artifact    : walrus://3Znq…       # manifest blob → dataset + reward.py
  suiscan     : https://suiscan.xyz/testnet/object/0xde75…
  attestation : https://suiscan.xyz/testnet/object/0x9b79…   # with --epoch
```

You receive an owned, tradable `EnvironmentCap` (authority over the env) and, with
`--epoch`, an `EpochAttestation` proving the env ran a TEE-attested baseline epoch.

## License

MIT
