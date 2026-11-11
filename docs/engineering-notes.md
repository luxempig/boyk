# Engineering notes

Longer versions of the four problems summarized in the README, written as what broke, how it was
found, why it happened and what changed.

## 1. The Kit Kat problem: a build that silently changed who owns a brand

**Context.** The barcode index maps about 3.05 million barcodes (Open Food Facts plus USDA
FoodData Central) to the company that ultimately owns the brand. It is built offline by
`pipeline/tools/off-ingest/build.py`, split into 1,000 files by barcode prefix, and served from
Cloudflare R2 by the Worker when the graph itself cannot name an owner.

**What broke.** A rebuild added a reviewed list of 216 USDA owner-name spellings. The new build
moved 183 US Kit Kat barcodes from Hershey to Nestlé. Hershey makes and sells Kit Kat in the US
under license; Nestlé owns it everywhere else. No test failed and no error was logged.

**How it was found.** Publishing is a separate step (`publish.py`) that first diffs the new build
against the live index and groups every changed barcode by "from company → to company". About
15,000 barcodes moved in that build. Nearly all were corrections: Whole Foods → Amazon, Harris
Teeter → Kroger. Hershey → Nestlé, 183 barcodes, was not.

**Why it happened.** The ownership rules treated "some USDA record backs this owner" as a yes/no
question. Of 155 Kit Kat records, 144 named Hershey and 2 named Froneri, Nestlé's ice-cream
licensee. Two was enough to count as backing. The same yes/no check existed in three separate
rules, so fixing the first one did not fix the result: a second run still moved the barcodes
through the brand-consensus pass.

**What changed.** The check is now share-weighted: an owner has to account for at least 25% of a
brand's records (`MIN_BRAND_SUPPORT`) before it can override, in all three rules. The publish
routine became build → diff → read the largest moves → back up the live index → publish →
spot-check known barcodes.

**Result.** The corrected index shipped with 22.7% of barcodes resolving to a company, up from
20.3%: about 74,000 barcodes gained an owner and 224 lost one.

## 2. Error reports that never arrived

**What broke.** During beta preparation, Sentry showed no errors from the web app or the iPhone
app. That reads as "no errors".

**How it was found.** A deliberate test error did not arrive either. Sending one by hand failed
in the TLS handshake, and the certificate presented was self-signed, even when connecting to
Sentry's real IP address. The network was inspecting the TLS hostname and blocking `*.sentry.io`.

**Why it mattered.** Any user on a network that does the same would be invisible to monitoring,
and the dashboard would keep saying everything was fine.

**What changed.** The Cloudflare Worker that already fronts the site got a route,
`/sentry-relay`, that forwards error envelopes to Sentry. Error reports now travel to the site's
own domain. The route accepts only POST and only the three project IDs that belong to this
project, so it cannot be used to relay anything else. The web and iPhone apps point at the relay;
the API server on AWS reports directly.

## 3. Stages that ran past the Lambda limit

**What broke.** The nightly scoring batch was killed at exactly 900 seconds, the Lambda maximum,
three times a night: the original invocation and two automatic retries. One stage had started
against an endpoint that refused every connection, and the stages after it never ran.

**Why the obvious fixes did not work.** Checking the time budget before starting a stage cannot
stop a stage that overruns after it starts. Raising an exception mid-stage did not work either,
for two reasons that only showed up in production:

1. Six enrichment modules fan out over a thread pool and queue every company before doing any
   work. Leaving the pool's `with` block waits for every queued task, so the exception could not
   surface until the whole queue drained.
2. The drain was dominated by rate limiting, not HTTP. One source is paced at 40 requests a
   minute, so a few hundred queued companies meant minutes of sleeping, longer than the time left.

**What changed.** The deadline is re-checked in the progress callback that all 18 enrichment
stages already call once per company. Hitting it sets a halt flag that makes pending HTTP calls
return immediately and makes the rate limiter stop waiting, so the pool drains in seconds. The
stage is recorded as cut short, not failed. A retry loop that never counted HTTP 429 responses
against its attempt limit was also capped.

**Result.** The first night after the change: one stage cut short with 73 seconds left, the pool
drained in about 3 seconds, the batch finished in 831 seconds with a full summary, and nothing
timed out or retried.

## 4. Same name, different company

**What was wrong.** Hundreds of identifiers that should each name one company pointed at several.
A lookup by one of those IDs could not say which company was meant.

**Why it happened.** Enrichment that matched companies by name had stamped the same Wikidata ID
onto several distinct legal entities. Twelve companies called "FNB Corporation", each with its own
LEI, shared one ID. In total 309 company IDs were spread over 640 nodes. The uniqueness
constraints that should have prevented this had failed to create, because the data already
violated them, and that failure was logged at debug level. They had never been enforced.

**What changed.** `pipeline/tools/rebuild/rebuild.mjs` resolves every collision by rule and then
asserts the result:

- For each contested ID, the best-connected node keeps it.
- A loser that has its own LEI is a real, distinct company: it keeps its node and loses the ID.
- A loser without an LEI is a ghost: it is merged into the winner and its relationships rewired.

The writer now checks that no other node holds an ID before stamping it, refuses to merge on name
alone, and logs unenforced constraints as warnings. A nightly check logs an error if an LEI node
turns up holding the wrong ID again.

**Result.** 323 nodes merged, 324 IDs removed from the wrong entities, and no public link broke,
because every merged ID still resolves to the surviving node.
