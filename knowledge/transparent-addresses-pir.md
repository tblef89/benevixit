# Protecting transparent addresses: rotation and private queries

(Current as of October 2026. Based on "A Privacy Layer for Transparent
Wallets" by Roman Akhtariev of Zakura, a team that builds Zcash full-node
software. Dates are plans, not promises; say so when you speak of them.)

## The short answer
Shielded Zcash is the private path: sender, receiver and amount are
encrypted on-chain. Transparent addresses, the ones beginning with "t", are
public like Bitcoin, and this work does not change that. It closes two
quieter leaks around them: public keys left exposed by reusing an address,
and wallets that reveal which addresses they own when they look them up.

## Why hidden public keys matter
A standard transparent address (t1...) holds a hash of a public key, not the
key itself. The key appears on-chain only when the owner spends from that
address. Anyone worried that advances in cryptography, whether from quantum
computers or AI-assisted research, might one day recover private keys from
public ones has reason to keep public keys out of sight. A key that is still
hidden behind its hash keeps that extra protection.

## Rotating addresses
The habit is simple: use a fresh address for every transaction, and move any
remaining funds to a new address after spending. Once a public key is
exposed, everything left at that address, or sent there later, sits behind a
key that is now public; a fresh address puts it back behind a hash.
Rotation needs no new wallet or seed phrase. One seed derives a whole tree of
distinct key pairs, and spending from one address reveals only that
address's public key, not the others and not the seed. The same backup
regenerates every address.

## One caution: the extended public key
An account's extended public key (also present, in effect, inside the
transparent part of a Unified Full Viewing Key) can derive all of its public
keys. Sharing it exposes far more than an ordinary spend. Worse, anyone who
holds it and recovers a single transparent private key can work back to the
account's root key and every key beneath it. It should be guarded as
carefully as the keys themselves.

## The lookup leak
Fresh addresses only help if the wallet can still watch them. A light wallet
asks a server for each address's history, in effect: "show me A, then B,
then C." Encryption protects the request in transit, but the server reads
it, and learns that addresses which look unrelated on-chain all belong to
one person.

## Private information retrieval
Private information retrieval (PIR) lets a wallet fetch a record from a
server's database while hiding which record it fetched. Zakura's design
splits confirmed transparent activity into block ranges, each served by a
shard. The wallet works out locally where its addresses' records would sit
and retrieves them privately; the server never learns which ones.
To avoid a private lookup in every range, each shard also publishes a small
public filter (like a Bloom filter): about 15 KB for a range with 10,000
distinct addresses. The wallet checks its addresses against the filters on
its own device and makes private lookups only where there may be a match.
Long histories come back in further private pages.

## Recovery and details
Restoring a wallet from its seed means finding the history of old
addresses, including ones now empty because their funds were spent or
shielded. PIR lets the wallet do that without naming them. Once it knows a
transaction, it can privately fetch more about it, such as fees and where
the outputs went, without sending the transaction ID as a readable search.

## Two protections, two risks
Rotation limits how many public keys are ever exposed, guarding against a
future key-recovery attack. PIR stops a server from learning which addresses
belong together, guarding against profiling and targeting. Neither replaces
the other; together they cover both.

## Where it stands
Zakura says post-quantum-safe rotating transparent addresses are possible
today, using a hash-based backup signature (WOTS, a Winternitz one-time
signature) alongside the usual elliptic-curve key, though there is no
integrated wallet experience for it yet. Its PIR component was coming to the
Vizor wallet in October 2026, as an experimental "Private queries" setting.
Zakura plans post-quantum signature opcodes for Zcash's transparent payments
in January 2027.

## How it fits the house's view
These are welcome improvements for the transparent side, and a sign of how
seriously Zcash keeps its security current. The advice does not change: keep
funds shielded and pay shielded to shielded. Private Key accepts only ZEC,
and a shielded payment remains the way to keep a purchase private.
