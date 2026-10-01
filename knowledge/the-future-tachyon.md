# The future of Zcash: Tachyon and planetary scale

(Current as of October 2026. Roadmap items are plans, not promises; say so
when you speak of them.)

## The aim
Project Tachyon, proposed in April 2025 by the Zcash cryptographer Sean Bowe,
sets out to make Zcash a private payment network that can serve billions of
people without giving up privacy. The long-term target is more than 50,000
private payments per second, the scale of the major card networks, still
secured by proof of work. Today Zcash carries far less than that: in
September 2026 it averaged roughly 11,700 transactions involving shielded
funds a day. Tachyon is the plan to close that gap.

## Why privacy has been hard to scale
In Zcash today, a wallet has to scan every new block to find the payments
that belong to it, because only the owner can recognise them. That is what
keeps it private, but it gets slower as the chain gets busier. And every node
must check every payment's proof and keep a growing record of spent notes.
At 50,000 payments a second, today's methods would have each node take in
more than 500 megabytes every second.

## Tachyon's three ideas
- Oblivious synchronisation: a wallet can hand the heavy work of following
  the chain to an outside server that learns nothing about the wallet: not
  its address, its balance, or which payments are its own. Wallets stay
  fast and light even on a very busy network.
- No secrets on the chain: payment details travel directly between sender
  and recipient instead of being stored on the blockchain in encrypted form.
  Nothing is left on-chain for anyone to try to decrypt later, including a
  future quantum computer.
- Aggregated proofs: the proofs for many payments in a block are folded into
  a single recursive proof (proof-carrying data), so a node checks one proof
  instead of thousands, and old state can be pruned rather than kept forever.

## Where it stands
Tachyon is not live yet. Its proof system, a Rust library called Ragu,
follows the original Halo design. In late September 2026 a first Tachyon
component, named Udon, was released into Zakura Common, a cryptography
library shared across Zcash projects; Zakura is built jointly by Bowe's team
and Dev Ojha's Valar Group. Separately, the next network upgrade, NU7, is
planned for November 2026 and would cut the time between blocks from 75
seconds to 25, making payments confirm up to three times faster.

## Quantum readiness
Zcash is not yet safe against a large quantum computer, but it has a
staged plan: wallets that can recover funds if today's elliptic-curve
cryptography were ever broken, then Tachyon's removal of on-chain secrets,
which leaves nothing for a future attacker to harvest and decrypt.

## Why it matters to the house
Privacy that works only for a few is a luxury. Tachyon is the attempt to make
it ordinary: private money that ordinary people use every day, at the scale
of a card network, with nothing about them left behind.
