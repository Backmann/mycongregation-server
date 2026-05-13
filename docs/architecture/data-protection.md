# Data Protection Architecture

**Status:** Design (Levels 1+2 + defense-in-depth targeted; Level 3 E2EE designed but deferred).
**Last updated:** 2026-05-13.
**Owner:** @Backmann.

## Goals

`mycongregation` stores personally identifying and pastorally sensitive
information about real people in real congregations: home addresses,
contact phone numbers, family relationships, baptism dates, health
flags, and free-form pastoral notes written by elders. The system must
protect this data against realistic threats while remaining maintainable
by a solo developer.

This document specifies the layered defense strategy across three
dimensions: data at rest, data in transit, and operational access
controls. The cryptographic key material is itself treated as a
sensitive asset requiring its own protection.

Three guiding principles:

1. **No single point of failure.** Compromise of any one layer (DB
   dump, server SSH, lost backup) should not expose all data.
2. **Defense in depth over silver bullets.** Multiple imperfect
   protections beat one perfect-looking scheme that fails silently.
3. **Maintainability matters more than theatrical complexity.** A
   clean AES-256-GCM column transformer the developer understands is
   more secure in practice than a Byzantine multi-cipher scheme
   nobody can debug.

The document covers the architecture for three security levels:

- **Level 1** — Server-side encryption (target)
- **Level 2** — Envelope encryption with KMS (target)
- **Level 3** — End-to-end encryption for `spiritualNotes` (designed,
  deferred to future Phase 5)

Plus a parallel **defense-in-depth** track (MFA, rate limiting, audit
logging, etc.) which is independent of encryption layers and is
implemented incrementally.

## Threat Model

We design against three concrete scenarios.

### Scenario 1: Leaked DB dump

An attacker obtains a `pg_dump` of the production database through SQL
injection returning all rows, misconfigured backup storage (an S3 bucket
left public), lost or stolen backup media, or insider exfiltration.
**Mitigation:** column-level encryption (Levels 1+2) plus encrypted
backups. An attacker who obtains the dump sees ciphertext they cannot
decrypt without the key, which lives elsewhere.

### Scenario 2: Compromised server (root/SSH access)

An attacker gains root or SSH access via stolen SSH key, server-side
vulnerability, or misconfigured service. **Mitigation is limited.** If
the application runs on the server, the decryption key must be
available to the running process. Level 2 (KMS) raises the bar: the
KEK lives in an external service and every decryption is audit-logged;
unusual access patterns can trigger alerts. But it does not eliminate
exposure. Defense-in-depth (MFA, IP allowlist, principle of least
privilege, hardened SSH) reduces the likelihood of this scenario.

### Scenario 3: Misuse by authorized parties

A legitimate user (developer, elder, admin) exfiltrates data outside
the application via screenshots, bulk export, or API abuse.
**Mitigation:** audit logging of all sensitive-data access, rate
limiting, no "give me all data" endpoints in the API, principle of
least privilege.

We do **not** design against: nation-state actors (out of scope for a
community application); side-channel attacks on cryptographic
implementations; compromised developer workstation (separate concern:
secrets hygiene); hardware-level attacks on the hosting provider
(would require Confidential Computing / TEE-based VMs, unavailable on
Hetzner CX22).

## Current State Assessment

As of May 2026, the production database stores:

- **Properly hashed:** `users.password_hash` using bcrypt cost 12.
  Irreversible, no migration needed.
- **Encrypted in transit:** All HTTPS traffic (browser/mobile →
  Cloudflare → 30sec-nginx → server container).
- **Plaintext at rest:** Everything else — names, contacts, addresses,
  spiritual notes, health flags, dates of birth, removal reasons.

Transport security is solid. The data-at-rest gap is the focus of
this design.

Production currently has 0 publishers and 1 admin user. **This is the
moment** to introduce encryption — any later migration would have to
re-encrypt existing plaintext rows, with all the operational risk that
entails. We design the schema and code paths for encryption from the
start.

## Field Classification

Every column is assigned a tier by sensitivity and operational
constraint. The tier determines treatment.

### Tier 1 — High sensitivity, free-text or PII (encrypted)

| Field | Why sensitive |
|-------|---------------|
| `publishers.address` | Home location |
| `publishers.mobile_phone` | Direct personal contact |
| `publishers.email` | Direct personal contact, identity |
| `publishers.notes` | Free text, can contain anything |
| `publishers.spiritual_notes` | Pastoral content from elders (also E2EE candidate in Level 3) |
| `publishers.removed_note` | Reasons for removal |
| `service_reports.notes` | Free text from publisher |
| `families.notes` | Free text |
| `service_groups.notes` | Free text |

All Tier 1 fields are encrypted with AES-256-GCM at the column level
(Levels 1+2). They remain typed as `text` in PostgreSQL, holding a
base64-encoded versioned ciphertext envelope.

### Tier 2 — Medium sensitivity, discrete values (deferred)

| Field | Why sensitive |
|-------|---------------|
| `publishers.is_prisoner` | Criminal status (very sensitive in some jurisdictions) |
| `publishers.is_elderly_or_infirm` | Health flag |
| `publishers.is_deaf`, `is_blind` | Health flags |
| `publishers.is_anointed` | Religious belief detail |

Boolean and small-enum fields leak information through encryption
metadata (cardinality is observable; same plaintext patterns under
deterministic encryption are distinguishable). Encrypting booleans in
isolation is *theatrical security*.

**Phase 3 strategy:** combine all Tier 2 fields into a single JSONB
column `sensitive_flags` encrypted as one blob with the same scheme
as Tier 1. Until that phase, accept the leak — these flags are
operational, and the *names* of affected individuals are plaintext
anyway (Tier 4, below).

### Tier 3 — Low-entropy operational fields (plaintext)

| Field | Why kept plaintext |
|-------|--------------------|
| `publishers.birth_date` | Sortable for age computation; ~30k possible values |
| `publishers.baptism_date` | Operational, low entropy |
| `publishers.pioneer_since` | Operational, low entropy |

Encrypting low-entropy date fields gives weak privacy improvement at
high operational cost: range queries break, sorting breaks, age
computation breaks. The privacy gain over plaintext is marginal.

### Tier 4 — Operational, must remain searchable (plaintext)

| Field | Why never encrypted |
|-------|---------------------|
| `publishers.first_name`, `last_name`, `display_name` | Search, list display, sort |
| All UUIDs | Public identifiers, not secrets |
| All `*_id` foreign keys | Joins, indexes |
| `users.email` | Login lookup, unique index |
| Roles, appointments, `pioneer_type` | Filtering, access control |
| All timestamps | Audit, sorting, scheduling |

Encrypting any Tier 4 field breaks the application. The trade-off is
explicit and accepted: a leaked DB dump reveals *who exists* in the
congregation but not *what they live through, where they live, or what
their elders have noted*.

## Encryption Scheme

### Algorithm: AES-256-GCM

**Why AES-256-GCM:**
- NIST-approved, IETF-standardized (RFC 5288).
- Authenticated encryption (AEAD) — provides confidentiality AND
  integrity. Tampering with ciphertext is detected and decryption
  fails loudly.
- Native support in Node.js `crypto` module.
- Standard choice in 2026 for column-level encryption.

**Alternative considered:** ChaCha20-Poly1305 — equally strong, often
faster on hardware without AES-NI. AES-256-GCM chosen for broader
tooling ecosystem and standard library support; the performance
difference is negligible for column encryption.

### Initialization Vector (IV)

- **96 bits (12 bytes), randomly generated** per encryption operation
  using `crypto.randomBytes(12)`.
- IV is stored alongside the ciphertext (it does not need to be
  secret, only unique per key+plaintext pair).
- 96-bit random IVs are safe up to approximately 2^32 encryptions
  under the same key (birthday bound) — far more than this application
  will ever produce.

### Authentication Tag

- AES-256-GCM produces a 128-bit authentication tag alongside the
  ciphertext.
- The tag is stored together with the ciphertext.
- Decryption verifies the tag; mismatch raises an exception (handled
  as a data corruption error in the application).

### Format on Disk

Encrypted values are stored as base64-encoded text in PostgreSQL
`text` columns. The format is versioned to support future scheme
changes (algorithm upgrade, key rotation) without breaking existing
rows.

    enc:v1:<base64(iv)>:<base64(ciphertext || authTag)>

Example (illustrative, not real ciphertext):

    enc:v1:4hZ2pA8QzbVcKuP9:WkN2j8...mQA=

Properties:
- Prefix `enc:` identifies the value as encrypted (allows transition
  detection during migrations).
- `v1` is the format version. Future versions could change algorithm
  or framing.
- Two base64-encoded blobs separated by `:` (IV then ciphertext+tag).
- All values are plain-ASCII safe for transport, logging redaction,
  and database `text` columns.

### Envelope Encryption Architecture

Direct encryption of each column with a single master key has two
weaknesses:
- Key rotation requires re-encrypting all rows (very expensive at
  scale).
- The master key is loaded into the application process at startup
  and held in memory throughout its lifetime.

**Envelope encryption** introduces two key layers:

- **DEK (Data Encryption Key)** — used by the application to encrypt
  and decrypt actual column values. AES-256.
- **KEK (Key Encryption Key)** — used only to encrypt/decrypt the DEK
  itself. AES-256.

The DEK is stored *encrypted by the KEK* in a known location (env
variable, config file, dedicated table). At application startup, the
process retrieves the wrapped DEK, asks the key management service to
unwrap it using the KEK, and caches the resulting plaintext DEK in
memory.

Benefits:
- **KEK rotation is cheap** — re-wrap the DEK with the new KEK; no
  data changes.
- **DEK rotation is bounded** — generate a new DEK, decrypt all data
  with old, re-encrypt with new. Still expensive but tractable.
- **Audit trail** — every KEK unwrap operation can be logged by the
  KMS, providing visibility into when the application accesses the
  data key.

## Key Management

### KEK location: pragmatic vs ideal

Ideal: the KEK lives in a managed Key Management Service (KMS) — AWS
KMS, GCP KMS, HashiCorp Vault — never readable directly. The
application requests "unwrap this DEK" via API; the KMS performs the
operation server-side and returns the unwrapped DEK. The KEK itself
never leaves the KMS.

Reality: in May 2026, Hetzner Cloud does not offer a managed KMS.
Options for KEK storage:

| Option | Trust boundary | Cost | Complexity |
|--------|---------------|------|------------|
| Env variable on server | Same as application | Free | Minimal |
| AWS KMS | External, audited | ~$1/month + per-call | Medium (extra dep) |
| GCP KMS | External, audited | Similar to AWS | Medium |
| HashiCorp Vault (self-hosted) | Operator-controlled | Self-hosted infra | High |
| systemd-creds with TPM | Bound to host hardware | Free | Medium, Linux-only |

**MVP decision:** start with **KEK in env variable** on the production
server, with strict file permissions (`chmod 600 .env`, owned by the
app user). Document the KEK in a secure backup location (password
manager). Plan **migration to AWS KMS** as Phase 2 enhancement once
the encryption pipeline is proven in production.

This is honest: env-based KEK with envelope structure is not "true"
envelope encryption (the KEK lives on the same machine as the
encrypted DEK). It provides the *architectural* benefits (DEK
rotation independent of KEK, format versioning, clear separation of
concerns) without the *operational* benefits (external audit trail,
KEK protection from server compromise) — those come with the KMS
migration.

### Key generation

KEK and DEK are both AES-256 keys, 32 bytes of cryptographically
random data:

    openssl rand -base64 32

For initial setup, this is run once during deployment. The output is
stored in the production `.env`:

    DATA_PROTECTION_KEK=<base64 32 bytes>
    DATA_PROTECTION_DEK_WRAPPED=<base64 of AES-256-GCM(KEK, raw_DEK)>

The raw DEK is **never** stored anywhere; only its wrapped form is on
disk.

### KEK backup procedure

Loss of the KEK means loss of all encrypted data — there is no
recovery. The KEK is therefore backed up in three independent
locations:

1. **Password manager** (Bitwarden / 1Password) — primary working
   backup, accessed from any device.
2. **Encrypted file on personal computer** (GPG-encrypted text file
   with a long passphrase) — offline backup.
3. **Sealed physical printout** in a secure location (home safe,
   safety deposit box) — disaster-recovery backup.

The KEK is rotated only on suspected compromise; backups must be
updated in lockstep.

### DEK rotation

A more frequent operation than KEK rotation, performed approximately
annually or on suspicion of leak:

1. Generate new DEK (`openssl rand -base64 32`).
2. Wrap with current KEK; store as `DATA_PROTECTION_DEK_WRAPPED_NEW`.
3. Application reads both old and new wrapped DEKs; decrypts data with
   the version embedded in each ciphertext (`v1` → old DEK,
   `v2` → new DEK).
4. Background job re-encrypts all Tier 1 columns with new DEK,
   incrementing the version prefix.
5. After all rows migrated, retire old DEK from env.

This is invasive and rarely run; it is documented for completeness.

### KEK rotation

Much cheaper: re-wrap the existing DEK with a new KEK.

1. Generate new KEK.
2. Unwrap DEK with old KEK; re-wrap with new KEK.
3. Replace `DATA_PROTECTION_KEK` and `DATA_PROTECTION_DEK_WRAPPED` in
   env atomically. Restart application.
4. Update password manager / backups.

## Implementation Pattern

Encryption is **transparent to application code** — entity properties
read and write plaintext; the database stores ciphertext. The bridge
is a TypeORM `ValueTransformer` attached to each encrypted column.

### CryptoService

A NestJS provider (`src/crypto/crypto.service.ts`) loads the KEK at
startup, unwraps the DEK once, and exposes two methods:

    encrypt(plaintext: string | null): string | null
    decrypt(ciphertext: string | null): string | null

Both methods short-circuit on `null` (preserves NULL columns). The
encrypt method generates a fresh IV per call. The decrypt method
parses the version prefix and routes to the correct DEK version
(supports rotation in-flight).

If decryption fails (wrong key, corrupt ciphertext, missing auth tag),
the method throws — never returns garbage. The application surfaces
this as a 500 error; the underlying row is unreadable until fixed.

### Column transformer

A single transformer is exported from `src/crypto/encrypted.transformer.ts`:

    import { ValueTransformer } from 'typeorm';
    import { cryptoService } from './crypto.service';

    export const encryptedTransformer: ValueTransformer = {
      to: (value: string | null) => cryptoService.encrypt(value),
      from: (value: string | null) => cryptoService.decrypt(value),
    };

Note: the transformer references a singleton crypto service. It is
initialized in `main.ts` before any module that uses encrypted entities,
ensuring the DEK is unwrapped before the first read.

### Applying to an entity

Each Tier 1 column gets the transformer attached:

    @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
    address!: string | null;

    @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
    spiritualNotes!: string | null;

The column type stays `text` in PostgreSQL — it now stores the
`enc:v1:...` envelope. The entity property remains `string | null`
and is read/written as plaintext.

### Query implications

- **Equality search on encrypted columns is impossible** (random IVs
  → same plaintext encrypts to different ciphertexts). This is fine
  for `notes` and `spiritual_notes`; would be a problem for an email
  field used as a login key — which is why we keep `users.email`
  unencrypted (Tier 4) and `publishers.email` is for contact only.
- **LIKE / ILIKE searches are impossible** on encrypted columns.
- **Indexes on encrypted columns are useless** (no equality, no
  ordering). Don't add them.
- **Sorting and grouping by encrypted columns is impossible.** Not
  needed for any Tier 1 field.

### Performance note

AES-256-GCM with hardware acceleration (AES-NI, present on every
modern CPU) is fast: ~1 GB/s per core. Per-row encryption overhead is
negligible (microseconds). The KMS round-trip for DEK unwrap happens
once at startup; no per-request cost.

## Migration Strategy

### Initial deployment (current scenario: zero existing data)

The simplest path. Production has zero publisher records when
encryption is introduced. The transformer is added to entity
definitions; new rows are encrypted on insert; no historical data
exists to migrate.

This is the assumed path for `mycongregation`'s current state.

### Hypothetical: existing plaintext data

If encryption were introduced after data already existed, the
migration would proceed in three transactional phases:

**Phase A** — Deploy transformer in "write encrypted, read both"
mode. New writes go through the encrypter; reads check the prefix
(`enc:v1:`) and decrypt only if present; absent prefix means legacy
plaintext.

**Phase B** — Background job iterates all rows, re-saves them
(triggering encryption on write). Idempotent: re-running is safe.
Long-running job; monitored for progress.

**Phase C** — After all rows verified encrypted (no row in any
encrypted column begins with anything other than `enc:`), switch
transformer to "encrypt-only" mode. Any plaintext encountered
thereafter is a bug.

For `mycongregation`'s zero-data deployment, only the final mode
("encrypt-only") is implemented. Phases A/B exist conceptually for
discipline and future-proofing.

### Recovery from key loss

There is no recovery. If both the production KEK and all backups are
lost, encrypted data is irrecoverable. This is the defining property
of encryption — and the reason for the three-location backup procedure
in the Key Management section.

## Encrypted Backups

PostgreSQL backups via `pg_dump` are encrypted before leaving the
host. Plaintext `pg_dump` output never touches disk except in an
in-memory pipe.

### Backup procedure

    pg_dump -U mycongregation_user mycongregation_db \
      | gpg --symmetric --cipher-algo AES256 \
            --passphrase-file /root/.backup-passphrase \
            --batch --yes \
      > /backups/mycongregation-$(date +%Y%m%d).sql.gpg

The passphrase file is `chmod 600`, owned by root, **separate from the
DATA_PROTECTION_KEK** (different trust domain — backup operator may
differ from app key holder).

### Restoration procedure

    gpg --decrypt --passphrase-file /root/.backup-passphrase \
        --batch /backups/mycongregation-20260513.sql.gpg \
      | psql -U mycongregation_user mycongregation_db

Note that the restored data is still encrypted at the column level —
restoration requires both the backup passphrase **and** the
DATA_PROTECTION_KEK. Two independent secrets must compromise for full
exposure.

### Off-site storage

Encrypted backups are copied off-server to:
- Object storage (Hetzner Storage Box, Backblaze B2, or similar)
- A second physical location where feasible

A backup at rest on the same VPS as the database provides little
protection against disk failure or compromise.

## Transport Encryption

### HTTPS (already in place)

All client-facing traffic is HTTPS:
- Browser/mobile → Cloudflare (TLS 1.3)
- Cloudflare → 30sec-nginx on Hetzner (TLS, Full Strict mode)
- 30sec-nginx → mycongregation-server container (internal docker
  network)

Cloudflare Full Strict means Cloudflare verifies the origin's TLS
certificate; downgrade attacks via the origin connection are
prevented.

### Internal: server ↔ Postgres

The application connects to PostgreSQL over the internal docker
network. Currently this is **plaintext** — the connection does not
use TLS because both containers are on the same docker host and the
network is private.

**Phase 4 hardening:** enable TLS on the PostgreSQL connection. Even
on a private network, defense-in-depth argues for it:
- Prevents passive packet capture in case of host compromise.
- Defends against a future compromised sidecar container.
- Required if PostgreSQL is ever exposed externally (it should not
  be, but the defense should not depend on that).

PostgreSQL TLS is enabled via `postgresql.conf` (`ssl = on`) plus a
certificate; the Node.js `pg` driver requires `ssl: { rejectUnauthorized: true }`
in the connection config and the CA certificate to verify the
server.

### Cloudflare Tunnel (alternative)

The current setup uses `30sec-nginx` as the public ingress. An
alternative architecture uses Cloudflare Tunnel (`cloudflared`):
the origin server has no public ports open; Cloudflare reaches it
over an outbound mTLS tunnel initiated from the server itself.

Benefits: no public listener on the Hetzner VPS; reduced attack
surface. Migration is out of scope for the current document but
noted as future hardening.

## Disk Encryption

### Hetzner CX22 limitations

Hetzner Cloud servers do not offer encrypted volumes as a managed
feature, and the boot disk cannot easily use LUKS without complex
remote-unlock infrastructure (a dropbear-ssh stage in initramfs).
Whole-disk encryption is therefore **not** practical on the current
host.

Acknowledged consequence: an attacker with physical access to the
hosting facility — or, theoretically, a Hetzner insider — could read
the raw disk image. This includes the encrypted database, encrypted
backups, and the env file containing the KEK.

### Mitigations on the current host

- Column-level encryption protects the *data*, not the *key*. A
  physical disk read still gets the KEK.
- The application-level audit log (Defense-in-Depth, below) records
  every access through legitimate channels; out-of-band disk read
  produces no audit entries — a forensic disadvantage but unavoidable
  without FDE.

### Future: changing hosts

When operational needs justify, a host with FDE or Confidential
Computing should be considered. Realistic candidates in 2026:
- AWS EC2 with EBS encryption (managed)
- Hetzner Dedicated Server with LUKS configured at provisioning
- A Confidential VM (AWS Nitro, GCP Confidential, Azure CCN) for
  highest-tier deployment

Migration is non-trivial but the application design (column-level
encryption + KMS pattern) is host-agnostic.

## Defense-in-Depth

Encryption protects data after a breach. Defense-in-depth aims to
prevent the breach in the first place. These controls are independent
of encryption layers and are implemented incrementally.

### Multi-Factor Authentication (MFA)

Required for accounts with elevated privileges:
- All `admin` users
- All `elder` users with access to sensitive responsibilities (body
  coordinator, secretary, service overseer)

Mechanism: TOTP (RFC 6238) — works with any standard authenticator
app (Google Authenticator, Authy, Bitwarden). Backup codes generated
at enrollment, stored encrypted at rest like other secrets.

Implementation: separate feature, designed in `mfa.md` (future doc).

### Rate limiting

Per-route limits via the existing NestJS throttler (already in place
from earlier hardening). Tightened for sensitive endpoints:
- `POST /api/auth/login` — 5 attempts per 15 minutes per IP
- `POST /api/service-reports` — 30 per hour per user
- Bulk read endpoints (`GET /api/publishers`) — 100 per hour per user
- Admin endpoints — 200 per hour per user

Failed-auth threshold triggers temporary lockout (15 minutes) and
audit-log entry.

### IP allowlist for administrative operations

A narrow set of routes are restricted to known operator IP ranges:
- Migration / schema management endpoints (if any are added)
- User creation outside the bootstrap flow
- Manual data export

Implementation: Cloudflare WAF rules at the edge, redundant nginx
location restrictions inside.

### Audit logging

A separate subsystem (see `audit-log.md`, future doc) records every
sensitive operation:
- Authentication: login success/failure, refresh, password change
- Sensitive reads: any access to encrypted columns
- Sensitive writes: changes to publishers, service reports
- Administrative actions: role changes, user creation/deletion
- KMS operations: KEK unwrap, DEK rotation, key access

The audit log is append-only (no UPDATE/DELETE granted to the
application's DB user), retained for one year minimum, periodically
exported off-host.

### Principle of least privilege

Two PostgreSQL roles in production:
- `mycongregation_user` (current) — full CRUD on application tables,
  used by the running server.
- `mycongregation_migrator` (new) — DDL privileges, used only by the
  migration runner.

The application role does **not** have:
- `DROP` on tables
- `TRUNCATE` privileges
- `DELETE` on the `migrations` table
- `INSERT`/`UPDATE`/`DELETE` on the future `audit_log` table (it only
  has `INSERT`, achieved via a SECURITY DEFINER function)

### Security headers

Already partially in place via Cloudflare and the existing nginx
config. Verified and tightened in Phase 4:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; ...` (tuned per
  surface)
- `Permissions-Policy:` minimal

### Dependency hygiene

- Weekly automated `npm audit` via Dependabot or equivalent.
- Quarterly review of all direct dependencies.
- Pinned versions; no auto-updating of major versions.
- Lockfile committed.

### SSH hardening (already in place)

- Key-based authentication only (`PasswordAuthentication no`).
- Three deploy keys with named purposes (already in
  `/root/.ssh/authorized_keys`).
- Root login restricted to specific keys.
- Fail2ban or equivalent monitoring SSH logs.

## Future: Level 3 — End-to-End Encryption

Targeted scope: the single field `publishers.spiritual_notes`, which
contains pastoral entries written by elders about members. This is
the most sensitive data in the system: spiritual struggles, personal
counsel, confidences shared in trust.

### Goal

The server **physically cannot read** `spiritual_notes`. A full
compromise of the production environment — DB, application memory,
KEK, KMS — yields ciphertext only.

### Architecture sketch (high level)

- Each elder derives a personal encryption key from their password
  using Argon2id, on the client side.
- A shared "elder body" key is generated once per congregation,
  encrypted under each elder's personal key, and stored in the
  database. Each elder can decrypt the shared key with their password;
  the server cannot.
- `spiritual_notes` are encrypted by the client with the elder body
  key before being sent to the server. The server stores the
  ciphertext as-is.
- Recovery: Shamir's Secret Sharing (3-of-5) distributes shares of
  the elder body key among trusted parties for the case where
  multiple elders lose access simultaneously.

### Why deferred

- Recovery UX is hard. A forgotten password by the only elder with
  access means permanent data loss.
- Multi-device sync requires careful key transport.
- Bootstrap onboarding flow needs reasonable security and reasonable
  ergonomics; getting both right is significant design work.
- The application has no `spiritual_notes` data yet; this is the
  right time to design but not implement.

Detailed design — when the time comes — in a dedicated future
document.

## Implementation Phases

| Phase | Scope | Estimated effort |
|-------|-------|------------------|
| **1** | CryptoService + encryptedTransformer + Tier 1 fields on Publisher, ServiceReport, Family, ServiceGroup. KEK in env. Initial DEK generation. Tests. | 4-5 hours |
| **2** | Migrate KEK to AWS KMS (or chosen alternative). Update KEK rotation procedure. | 2-3 hours |
| **3** | Tier 2 fields: combine into `sensitive_flags` JSONB, encrypt as unit. Update Publisher entity. | 2-3 hours |
| **4** | PostgreSQL TLS on internal connection. Encrypted backup procedure operationalized (cron + offsite copy). Security headers verified. | 3-4 hours |
| **5** | MFA implementation (TOTP). Audit log subsystem (`audit-log.md` design + implementation). Principle of least privilege (database roles). | 8-10 hours (split across sessions) |
| **6** | Level 3 E2EE for `spiritual_notes`. Detailed design first; implementation only after design is solid. | 20-30 hours |

Phases 1-4 constitute the Variant B target (Levels 1+2 +
defense-in-depth basics).

Phase 5 (audit log + MFA) is the rest of defense-in-depth.

Phase 6 is Variant C target, deliberately deferred.

## Open Questions

- **Q-OQ1.** Which KMS provider for Phase 2 — AWS, GCP, self-hosted
  Vault? Decision before Phase 2 starts; depends on operational
  preferences and cost tolerance.
- **Q-OQ2.** What is the retention policy for the audit log? Default
  one year; some jurisdictions may require longer (or shorter).
- **Q-OQ3.** Should `users.email` move from Tier 4 to Tier 1? It is
  currently used as login identifier (must be indexable and equality-
  searchable), but it is also contact PII. Trade-off: encrypted email
  means no email-based login lookup. Resolution: keep plaintext for
  now; revisit if requirements change.
- **Q-OQ4.** Backup off-site destination: Hetzner Storage Box,
  Backblaze B2, or AWS S3 with Glacier transitions? Decision before
  Phase 4.
- **Q-OQ5.** MFA enrollment: forced on next login for existing
  privileged users, or opt-in with deadline? Affects user experience.

## Glossary

| Term | Meaning |
|------|---------|
| AEAD | Authenticated Encryption with Associated Data — encryption that also detects tampering (AES-GCM, ChaCha20-Poly1305) |
| AES-256-GCM | Symmetric encryption: AES with 256-bit key, Galois/Counter Mode (AEAD) |
| DEK | Data Encryption Key — used by application to encrypt column values |
| KEK | Key Encryption Key — used only to encrypt/decrypt the DEK |
| KMS | Key Management Service — external service that holds the KEK and performs unwrap operations |
| IV | Initialization Vector — public random value, unique per encryption |
| Tier 1/2/3/4 | Field sensitivity classification (this document's terminology) |
| E2EE | End-to-end encryption — server physically cannot decrypt; only client-side decryption with user-derived keys |
| TEE | Trusted Execution Environment (Intel SGX, AMD SEV) — hardware enclave processing encrypted memory |
| FDE | Full Disk Encryption (LUKS, BitLocker) — block-device level encryption, transparent to applications |
| Envelope encryption | Two-tier key architecture: DEK encrypts data, KEK encrypts DEK |
| Authentication tag | Output of AEAD encryption that verifies ciphertext integrity on decryption |
