# The keeper's library

Reference passages the keeper looks up during a conversation
(`src/gate/library.js`). Each turn, Cloudflare AI Search finds the few
passages closest to what the visitor just said, and only those are added to
the keeper's and the judge's prompts. The small core in the manifest
(`zcashFacts`) is always sent; everything deeper lives here.

## Rules for what goes in

- **Only verified facts.** The keeper treats this as ground truth and will
  say it to visitors. If unsure, leave it out.
- **Our words, our files.** Nothing a visitor writes is ever added here.
- **One topic per file, short sections.** AI Search splits files into
  chunks; a section that stands on its own retrieves well.
- **No prices, shipping or order details.** The keeper does not discuss
  them at the door.

## Publishing

Run **Actions → Setup → sync-library**. It uploads every `.md` file here
(except this README) to the R2 bucket `keeper-library`, and AI Search
re-indexes it. Removing a file here does not delete it from the bucket;
delete it in R2 as well.
