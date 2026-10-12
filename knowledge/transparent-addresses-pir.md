# Protecting transparent addresses: rotation and private queries

(Current as of October 2026. Based on a design published by Zakura, a team
that builds Zcash full-node software. Dates are plans, not promises; say so
when you speak of them.)

## The short answer
Shielded Zcash is the private path: sender, receiver and amount are
encrypted on-chain. Transparent addresses, the ones beginning with "t", are
public like Bitcoin. Zakura's work does not make transparent payments
private; it narrows two quieter leaks around them: wallets that reveal which
addresses they own when they look them up, and public keys left exposed by
reusing an address.

## The lookup leak
A light wallet does not read the whole blockchain itself; it asks a server
for the history and balance of its addresses. Even when nothing on-chain
links those addresses together, the server sees one wallet asking about all
of them, and learns that they share an owner. The server becomes the weak
point, not the chain.

## Private information retrieval
Private information retrieval (PIR) is a cryptographic technique that lets
a wallet fetch the records it needs without the server learning which
records it asked for. Applied to transparent addresses, a wallet can keep
track of its balances and history while the server stays blind to which
addresses are its own. In October 2026 an experimental, opt-in version was
reported to be arriving in the Vizor wallet, under a setting for private
queries.

## Rotating addresses
A transparent address holds only a fingerprint (a hash) of a public key. The
key itself appears on-chain the first time the owner spends from that
address. Reusing the address leaves that exposed key guarding whatever
arrives later. The design has wallets move to a fresh address after every
transaction, so each key is exposed once and then retired. It is good
practice for privacy too: fewer reused addresses means fewer links for an
observer to draw.

## A backup for a post-quantum future
Transparent addresses rely on elliptic-curve signatures, which a large
quantum computer could in principle break. The design pairs each address
with a hash-based backup signature (a Winternitz one-time signature, WOTS),
built on hash functions believed to resist quantum attack. Zakura says this
can be used today but has no finished wallet experience yet; signature
opcodes that would bring post-quantum signing to transparent payments were
reported as planned for January 2027, with no activation date confirmed.

## How it fits the house's view
These are welcome improvements for the transparent side, but the advice
does not change: keep funds shielded and pay shielded to shielded. Private
Key accepts only ZEC, and a shielded payment remains the way to keep a
purchase private.
