# Ragu: the careful engineering beneath Tachyon

(Based on "Folding Tachyon with Ragu: High Assurance Cryptography for Zcash"
by Sean Bowe and Tal Derei. Tachyon is still in development; speak of it as
work in progress.)

## What Ragu is
Tachyon, Zcash's next shielded protocol, is built on Ragu, a new toolkit for
recursive zero-knowledge proofs written in the Rust language. A recursive
proof can check other proofs inside itself, which is what lets Tachyon fold
the proofs of many payments into one. Ragu aims to be a production-grade
version of Halo, the 2019 research that first made efficient recursive
proofs possible without a trusted setup.

## Simpler, older, proven foundations
Ragu deliberately leans on cryptography Zcash has already shipped and lived
with: the Pasta elliptic curves, the Poseidon hash function, and the
polynomial commitment schemes deployed in Orchard years ago. It largely
avoids cryptography newer than 2021, sticking to familiar assumptions and
security models. Where Orchard's proofs used a hand-optimised and intricate
circuit design, Ragu uses a simpler, more uniform one, and gets comparable
performance from well-understood techniques rather than novel ones. The
team's rule: concentrate complexity only where it cannot be avoided, and
keep everything else as simple as possible.

## Built for Tachyon's needs
Ragu lets each step of a computation pay only for the features it actually
uses, splits work across many simple circuits running together instead of
one complicated one, and needs no special pre-processing to verify proofs.
It also avoids the heavy number-crunching (FFTs) many proof systems depend
on, except at a few boundaries.

## High assurance, several ways at once
The team does not rely on any single safeguard:
- Audits and extensive testing, including AI-assisted analysis.
- Fuzzing: throwing huge volumes of generated inputs at the circuits to find
  edge cases, drawing on zkSecurity's research and on techniques from
  Aztec.
- Formal verification: machine-checked mathematical proofs, written in the
  Lean language with zkSecurity's "clean" framework and run automatically
  with every change, that Ragu's circuit components do exactly what their
  specifications say. The boundary of what is trusted is drawn precisely,
  so that untrusted parts can be checked rather than believed.
- Documentation: a detailed book on Ragu's cryptography, written alongside
  the code. Writing it has already exposed real improvements to both the
  code and the protocol.

## Why the specification still matters
Formal verification proves that a program matches its specification, not
that the specification is right; as Brian Cantwell Smith put it in 1985, it
proves "relative consistency". So the specification must be written and
reviewed with as much care as the code. Tachyon will be fully specified
through Zcash's public ZIP process, and Ragu more rigorously than its
predecessor, halo2, was. As Edsger Dijkstra argued in 1978, a careful formal
treatment is the clearest way to capture and convey why something is
correct.

## Why it matters to the house
Money that people trust with their privacy must also be money they can
trust to be sound. Zcash's habit of conservative, verified engineering,
seen in Ironwood's formal proof and now in Ragu, is part of why the house
accepts it, and only it, as the currency of a private life.
