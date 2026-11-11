# Privacy Policy

**Last updated: October 5, 2026**

This privacy policy explains what data Boyk, Inc. ("Boyk," "we," "us," or "our") collects when you use our website at boyk.org, our iOS app, and related services (together, the "Service"). We believe you deserve to know exactly what happens with your data, so we wrote this policy in plain language.

Boyk is a Delaware C-Corporation. If you have questions about this policy, contact us at privacy@boyk.org.

---

## What We Collect

### Account Information

When you create an account, we collect:

- **Email address** -- provided directly or via Google OAuth sign-in
- **Display name and username** -- chosen by you during signup
- **Profile picture** -- if you upload one (stored in Cloudflare R2)
- **Authentication credentials** -- your password is hashed and stored securely; we never see or store your plaintext password

### User Content

When you use the Service, we store content you create:

- **Boycotts** -- boycotts you create or adopt, including target companies and block types
- **Posts** -- text, images, and other content you publish
- **Comments and replies** -- responses you leave on other users' content
- **Direct messages** -- private messages you exchange with other users
- **Feedback** -- bug reports or suggestions you submit through the app

All user content you post is visible to other Boyk users unless stated otherwise.

### Direct Messages

Direct messages are **private**: they are visible only to the participants in the conversation, enforced at the database level (row-level security), and are transmitted over HTTPS. They are not end-to-end encrypted -- like most messaging features, they are stored on our servers (Supabase) so they can sync across your devices, and we can access them only where necessary to operate the Service or comply with law. Your messages are deleted when you delete your account.

### Financial Data (Optional -- Only If You Opt In)

If you choose to connect your bank account through Plaid:

- **Bank account connection metadata** -- the institution name and connection status
- **Transaction data** -- your transactions are used to show spending at boycotted companies

**This data is only collected if you actively connect your bank. Most users never do this.** You can disconnect your bank at any time in Settings, and we will delete your financial data.

### Usage Data

We use **Plausible Analytics** to understand how people use Boyk in aggregate. Plausible is a privacy-friendly analytics tool that:

- Does **not** use cookies
- Does **not** collect personal data or track individuals
- **Respects Do Not Track** browser settings
- Is hosted in the **European Union**

We collect aggregated data such as pages visited, features used, and session duration. None of this is tied to your identity.

### Error and Debugging Data

When something breaks in the website, the iOS app, or our API, we send an error report to **Sentry**, an error-monitoring service, so we can find and fix the bug. A report contains:

- **Error details** -- the error message and stack trace (where in our code it happened)
- **Device and app details** -- browser or device model, operating system, and app version
- **Recent app activity** -- a short trail of what led up to the error, such as which screens or pages were opened, which buttons were tapped, and which of our servers the app was talking to
- **An anonymous account ID** (iOS app only) -- a random identifier for your account, so we can tell whether one bug affects one person or many. It is not your name, email, or username.

The iOS app also tells Sentry when an app session starts and whether it ended in a crash, so we can measure how stable the app is.

We **do not** send your name, email address, IP address, cookies, passwords, or the content of your posts and messages, and we **do not** record your screen or session. Reports from the website and iOS app pass through our Cloudflare servers on the way to Sentry.

### Barcode Scans

When you scan a product barcode, the barcode is **processed locally on your device**. The decoded barcode value is sent to our API to look up product information, but the camera image itself is not uploaded or stored on our servers. We keep an anonymous tally of which barcodes are scanned and whether we could identify the product's owner, so we know which products to add next. The tally records only the barcode and a count, never who scanned it or from which device.

Some product lookups are answered from a dataset derived from **Open Food Facts** (https://world.openfoodfacts.org), © Open Food Facts contributors, licensed under the Open Database License (ODbL) v1.0. Our derived barcode-to-brand extract is published openly under the same license (linked from scan results in the app). No personal data is involved in these lookups.

### Device Information

We automatically collect:

- **Browser type and version**
- **Operating system**
- **IP address** -- used for security (detecting abuse, enforcing rate limits) and complying with U.S. sanctions regulations

We do not use this information to build advertising profiles.

---

## How We Use Your Data

We use the data we collect to:

- **Provide the Service** -- display your boycotts, posts, and profile to other users; power product lookups and corporate ownership maps
- **Improve the Service** -- understand usage patterns (via aggregated analytics) and fix bugs (via error tracking)
- **Display user content** -- boycotts and posts you create are visible to other Boyk users as part of the core product experience
- **Detect and prevent abuse** -- identify spam, fraud, and violations of our terms of service
- **Comply with legal obligations** -- respond to lawful requests from authorities and enforce U.S. sanctions requirements
- **Communicate with you** -- send transactional emails (password resets, account notifications) when necessary

---

## Third-Party Processors

We share data with the following service providers, each for a specific purpose. We do not share data beyond what each processor needs to perform its function.

| Processor        | What They Do                                                        | Data They Access                                                                                              | Location                      |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Supabase**     | Authentication, database, user data storage                         | Account info, user content, financial data                                                                    | United States                 |
| **Cloudflare**   | CDN, edge caching, Workers (API proxy), R2 file storage, KV cache   | Profile pictures, cached API responses, IP addresses                                                          | United States / Global        |
| **Neo4j AuraDB** | Corporate knowledge graph (company, brand, and product data)        | **No personal user data** -- only public corporate information                                                | United States (AWS us-east-1) |
| **Plaid**        | Bank account connections and transaction data for spending tracking | Bank connection metadata, transaction history                                                                 | United States                 |
| **Sentry**       | Error monitoring for debugging                                      | Error details, device and app details, recent app activity, anonymous account ID                              | United States                 |
| **Plausible**    | Privacy-friendly web analytics                                      | Aggregated, anonymous page view data (no personal data)                                                       | European Union                |
| **Anthropic**    | AI features (e.g. suggesting alternatives to boycotted companies)   | The product/company query and boycott context you submit when using an AI feature -- not your account details | United States                 |

Stripe (payment processing) is not currently in use; if we add paid features, we will update this policy before enabling them.

### AI Features

When you use an AI-powered feature (such as "Find Alternatives"), the text of your request -- the product or company you're asking about and relevant boycott context -- is sent to Anthropic's Claude API to generate the response. We do not send your name, email, or account identifiers with these requests, and Anthropic does not use API data to train its models per its commercial terms.

---

## What We Don't Do

We want to be clear about practices we reject:

- **We do NOT sell your personal data.** Not now, not ever.
- **We do NOT serve ads** or use any ad-tracking technology.
- **We do NOT build advertising profiles** about you.
- **We do NOT share your data with data brokers.**

---

## Data Retention

- **Account data** -- kept until you delete your account
- **User content (boycotts, posts, comments)** -- kept until you delete your account. When you delete your account, boycotts you created are reassigned to keep them available for users who follow them; your name is removed and replaced with "[Deleted User]"
- **Financial data (Plaid)** -- kept until you disconnect your bank account or delete your account, whichever comes first
- **Analytics data** -- aggregated and never tied to individuals; retained by Plausible per their data policy
- **Error reports** -- retained by Sentry for up to **90 days**, then automatically deleted

---

## Your Rights

### Delete Your Account

You can delete your account at any time from **Settings** in the app. When you delete your account:

- Your profile, posts, comments, feedback, and personal data are permanently removed
- Your boycotts are reassigned to a sentinel account so followers can continue participating
- Your Plaid bank connection and financial data are deleted
- This action is irreversible

### Request a Data Export

To receive a copy of all personal data we hold about you, email **privacy@boyk.org**. We will respond within 30 days.

### Disconnect Your Bank

You can remove your Plaid bank connection at any time in **Settings**. This deletes your stored transaction data.

---

## California Residents (CCPA)

If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):

- **Right to know** -- You can request the categories and specific pieces of personal information we have collected about you.
- **Right to delete** -- You can request that we delete your personal information. You can do this directly in Settings or by emailing us.
- **Right to opt out of sale** -- We do not sell your personal information to anyone, so there is nothing to opt out of.
- **Right to non-discrimination** -- We will not treat you differently for exercising your privacy rights.

We honor these rights for all California residents regardless of whether CCPA revenue or data volume thresholds apply to us.

To exercise any of these rights, email **privacy@boyk.org** or use the in-app account deletion feature.

---

## Children's Privacy

Boyk is not directed at children under 13 years of age. We do not knowingly collect personal information from children under 13. If we learn that we have collected data from a child under 13, we will delete it promptly.

If you are a parent or guardian and believe your child has provided personal data to Boyk, please contact us at **privacy@boyk.org** so we can take appropriate action.

---

## International Data Transfers

Your data is primarily stored and processed in the **United States**:

- **Supabase** (database and auth) -- United States
- **Neo4j AuraDB** (corporate knowledge graph) -- AWS us-east-1 (United States)
- **Cloudflare** (CDN and file storage) -- distributed globally, with origin in the United States
- **Sentry** (error tracking) -- United States
- **Plaid** and **Stripe** -- United States

Analytics data is processed in the **European Union** by Plausible.

By using Boyk, you consent to the transfer and processing of your data in the United States. If you are located outside the United States, be aware that U.S. data protection laws may differ from those in your jurisdiction.

---

## Security

We take the security of your data seriously. Our measures include:

- **Password hashing** -- passwords are hashed using bcrypt via Supabase Auth; we never store plaintext passwords
- **Row-Level Security** -- all database tables enforce row-level security policies so users can only access their own data
- **Encryption in transit** -- HTTPS is enforced on all connections
- **Rate limiting** -- API endpoints are rate-limited to prevent abuse (200 requests per 15 minutes per IP)
- **Access controls** -- administrative functions require verified admin roles
- **Regular security audits** -- we review our security practices and address vulnerabilities promptly
- **Input sanitization** -- search queries and user inputs are sanitized to prevent injection attacks

No system is perfectly secure. If you discover a security vulnerability, please report it to **privacy@boyk.org**.

---

## Changes to This Policy

We may update this privacy policy from time to time. When we do:

- The "Last updated" date at the top will change.
- For **material changes** (new data categories, new processors, changes to how we use your data), we will notify you through the app.
- Continued use of the Service after changes are posted constitutes your acceptance of the updated policy.

We encourage you to review this policy periodically.

---

## Contact Us

- **Privacy questions**: privacy@boyk.org
- **General inquiries**: hello@boyk.org

---

_This privacy policy is version 1.0, effective March 24, 2026._
