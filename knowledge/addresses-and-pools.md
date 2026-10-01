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
  no trusted setup. Since July 2026 Orchard is withdrawal-only.
- Ironwood (July 2026): the current shielded pool, a formally verified
  successor to Orchard.

## Ironwood: the first formally verified shielded pool
Ironwood (the NU6.3 upgrade, activated on 28 July 2026) is the first privacy
pool in production whose correctness is proven by machine: more than 2,700
theorems, checked in the Lean language by three independent teams, show it
cannot create counterfeit ZEC. It came about because Zcash's own researchers
found a weakness in Orchard's circuit and the community chose to replace the
pool outright rather than patch around it, moving from discovery to a
proven successor in about two months. It is a mark of how seriously Zcash
treats the soundness of its money.

## The turnstile
Orchard is now withdrawal-only. Funds move from Orchard to Ironwood through
a turnstile, an accounting rule at the pool's edge that never lets out more
ZEC than verifiably went in, so Ironwood starts clean. Holders of shielded
ZEC simply move their funds across; their privacy carries over with them.

## Shielded to shielded is the private path
The strongest privacy comes when funds stay shielded from end to end. Moving
coins from a transparent address into a shielded one (shielding), or back
out, is visible at the boundary, so the habit worth forming is to keep
funds shielded and pay from shielded to shielded.
