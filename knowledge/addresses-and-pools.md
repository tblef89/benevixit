# Addresses and shielded pools

## Transparent addresses
Transparent addresses begin with "t". They work like Bitcoin: the sender,
receiver and amount of every payment are public on the blockchain forever,
for anyone to read.

## Shielded addresses
Shielded addresses keep their funds in an encrypted pool. A payment between
shielded addresses reveals nothing on the blockchain about who paid whom or
how much; a zero-knowledge proof shows the network the payment is valid
without showing what is in it. This is privacy built into the protocol, not
mixing or tumbling coins together.

## Unified addresses
Unified addresses begin with "u". A single unified address bundles several
receivers, so a wallet can share one address and let the payer's wallet
choose the most private way to pay it.

## The pools, in order
- Sprout (2016): the original shielded pool.
- Sapling (2018): made shielded payments fast and light enough for phones.
- Orchard (2022, the NU5 upgrade): built on the Halo 2 proving system, with
  no trusted setup. Since July 2026 Orchard is withdrawal-only (see below).
- Ironwood (July 2026): the current shielded pool, a formally verified
  version of Orchard.

## Why Ironwood replaced Orchard
On 29 May 2026 Taylor Hornby, a researcher at Shielded Labs, found a flaw in
Orchard's zero-knowledge circuit, present since 2022, that could in theory
have let someone create counterfeit ZEC without leaving a public trace.
Zcash responded with the Ironwood upgrade (NU6.3), activated on 28 July 2026
at block 3,428,143. Ironwood uses a corrected circuit, and a machine-checked
proof of more than 2,700 theorems, written in the Lean language by three
teams, shows it cannot create undetectable counterfeit ZEC under its design
assumptions. Orchard was sealed: funds can leave it but no new shielded
activity enters it.

## The turnstile
Funds leave Orchard through a turnstile, an accounting rule at the pool's
edge that never lets out more ZEC than verifiably went in. Any counterfeit
coins that might have been made inside Orchard would stay trapped there,
unable to reach Ironwood or the rest of the supply. Moving funds from Orchard
to Ironwood is the step every holder of shielded ZEC is asked to take.

## Shielded to shielded is the private path
The strongest privacy comes when funds stay shielded from end to end. Moving
coins from a transparent address into a shielded one (shielding), or back
out, is visible at the boundary, so the habit worth forming is to keep
funds shielded and pay from shielded to shielded.
