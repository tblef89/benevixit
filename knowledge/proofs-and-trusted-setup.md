# Zero-knowledge proofs and the trusted setup

## What a zero-knowledge proof does
A zero-knowledge proof convinces someone that a statement is true without
revealing why it is true. In Zcash, each shielded payment carries a proof that
the payer owns the coins, that they have not been spent before, and that no
money was created, without revealing the payer, the recipient or the amount.
The proofs Zcash uses are called zk-SNARKs: short, and quick to check.

## The trusted setup, and its end
The original Sprout and Sapling proving systems needed a one-time setup
ceremony to generate public parameters. If every participant in a ceremony
had colluded and kept their secret material, they could in principle have
forged coins, though not broken anyone's privacy. The ceremonies were run
with several independent participants, so that a single honest one was enough.
Orchard, introduced in 2022, uses the Halo 2 proving system, which removed 
the trusted setup entirely. Ironwood, which replaced Orchard in 2026, keeps
Halo 2. Modern Zcash does not rely on trusted setups.
