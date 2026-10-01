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
  no trusted setup.
- Ironwood: the latest shielded pool, a formally verified version of Orchard.

## Shielded to shielded is the private path
The strongest privacy comes when funds stay shielded from end to end. Moving
coins from a transparent address into a shielded one (shielding), or back
out, is visible at the boundary, so the habit worth forming is to keep
funds shielded and pay from shielded to shielded.
