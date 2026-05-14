# Video Conferencing — Architecture Design

**Status:** Design — not yet implemented
**Created:** 2026-05-14
**Author:** Lionel Hovorukha (with Claude)
**Target phase:** Post-Phase B (see roadmap)

---

## 1. Executive Summary

This document specifies the architecture for adding in-app video conferencing to mycongregation. The system must support up to **200 participants per room** with video, audio, in-meeting text chat, host controls, and optional screen sharing, while being **self-hosted** and integrated with the existing NestJS authentication.

**Recommendation:** Deploy a **self-hosted LiveKit server** (an open-source SFU) on a dedicated Hetzner VPS, integrate it with the existing NestJS API for authentication and room management, and use the official LiveKit React Native SDK in the mobile client.

**Estimated effort:** 5–6 weeks across 4 implementation phases.

**Estimated monthly cost:** ~14–30 € for the additional VPS (depending on usage), in addition to existing infrastructure.

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Support up to **200 participants** in a single room |
| FR-2 | Video and audio streaming with per-participant toggle of camera and microphone |
| FR-3 | One or more designated **hosts** per room with elevated privileges (mute, kick, end meeting) |
| FR-4 | **In-meeting text chat** between participants |
| FR-5 | Optional **screen sharing** |
| FR-6 | Reasonable quality on average home internet (3–10 Mbps download) |
| FR-7 | **Not Zoom** — neither Zoom infrastructure nor Zoom SDK/API |
| FR-8 | Integration with existing JWT-based authentication |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **Privacy:** media must be encrypted in transit; E2EE option desirable for sensitive pastoral conversations |
| NFR-2 | **Self-hosted:** no dependency on third-party SaaS for media routing |
| NFR-3 | **Open source:** prefer Apache 2.0 / MIT / BSD over GPL |
| NFR-4 | **Low operational burden:** single-operator deployment (Lionel as sole SRE) |
| NFR-5 | **Affordable:** ongoing infrastructure cost should remain low for a non-profit congregation use case |
| NFR-6 | **Mobile-first:** must work natively in React Native (Expo) with official SDK |
| NFR-7 | **GDPR compliance:** participants in EU; data residency on Hetzner (Germany) acceptable |

### 2.3 Out of Scope (for V1)

- Recording (deferred to V3, opt-in only)
- Streaming to external platforms (YouTube, etc.)
- Persistent chat history (chat is ephemeral in V1)
- Polling/Q&A/reactions (future enhancement)
- Background blur / virtual backgrounds (client-side, deferred)
- Cross-room broadcasting (multi-room cascading)

---

## 3. Topology Analysis

Three classical topologies exist for multi-party WebRTC conferencing:

### 3.1 P2P Mesh

Every participant establishes a direct WebRTC connection to every other participant.

- **Connections:** O(n²) — for 200 participants, that's ~39,800 peer connections
- **Bandwidth per client:** 199 × upload = 199 × 500 Kbps ≈ **100 Mbps upload**
- **Verdict:** ❌ Infeasible for >5–6 participants. Disqualified.

### 3.2 SFU (Selective Forwarding Unit)

A central server receives one stream from each publishing participant and forwards it to all subscribers. The server does not decode or re-encode media.

- **Connections per client:** 1 (to the SFU)
- **Client upload:** ~500 Kbps (single stream) regardless of room size
- **Client download:** scales with number of *active* speakers (typically 1–5), not total participants
- **Server CPU:** low (no transcoding) — primarily packet routing
- **Server bandwidth:** high (sum of all downstream streams)
- **Industry usage:** Zoom, Google Meet, Discord, Twitch (for low-latency interactive)
- **Verdict:** ✅ Industry standard for 50–500 participants. **Selected.**

### 3.3 MCU (Multipoint Control Unit)

The server decodes all incoming streams, composes them into a single output stream (e.g., a 4×4 grid), re-encodes, and sends the result to each participant.

- **Connections per client:** 1 (to the MCU)
- **Server CPU:** very high (decoding + composing + encoding for every output)
- **Cost:** typically 5–10× SFU cost due to CPU/GPU requirements
- **Use case:** legacy SIP interop, low-bandwidth clients (1 Mbps down)
- **Verdict:** ❌ Not cost-effective for our use case. Disqualified.

### 3.4 Decision: SFU

The SFU topology is selected on the basis of: (a) cost, (b) ecosystem maturity, (c) industry-standard pattern for the target participant count, (d) simplicity (no transcoding pipeline to maintain).

---

## 4. SFU Selection: LiveKit

### 4.1 Candidate Comparison

| Criterion | **LiveKit** | mediasoup | Jitsi Videobridge | Janus |
|-----------|-------------|-----------|-------------------|-------|
| License | Apache 2.0 | ISC | Apache 2.0 | GPLv3 ⚠️ |
| Language | Go | Node.js (C++ core) | Java | C |
| Official React Native SDK | ✅ Yes | ❌ Third-party only | ✅ Yes (Jitsi Meet SDK) | ❌ |
| Official Node.js server SDK | ✅ Yes | N/A (it *is* Node) | Partial | ❌ |
| Built-in TURN/STUN | ✅ Yes | ❌ Bring your own | ✅ Yes | ❌ Bring your own |
| Simulcast (multi-quality) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Adaptive bitrate | ✅ Yes | Manual | ✅ Yes | Manual |
| E2EE support | ✅ Yes (Insertable Streams) | ✅ Yes | ⚠️ Limited | ⚠️ Limited |
| Production users | Reddit, ChatGPT Voice, Spotify Greenroom | Many smaller deployments | Jitsi Meet, 8x8 | Many telco deployments |
| Operational complexity | Low (single binary, Docker image) | Medium (you write the orchestration) | Medium-High (XMPP-based, multiple components) | High (C config files, low-level) |
| Documentation quality | Excellent | Good | Good but fragmented | Fair |

### 4.2 Why LiveKit

**Decisive factors:**

1. **Official React Native SDK** — `@livekit/react-native` is maintained by the LiveKit team. mediasoup has no official RN SDK; community wrappers exist but are unmaintained.
2. **Official Node.js server SDK** (`livekit-server-sdk`) integrates cleanly with NestJS — JWT token generation, room management, and webhook handling are first-class APIs.
3. **Built-in TURN/STUN** — for users behind symmetric NAT (corporate firewalls, some mobile carriers), TURN is required as a fallback relay. LiveKit ships with this built-in; mediasoup and Janus require a separate coturn deployment.
4. **GPL is unacceptable** — Janus's GPLv3 license would create complications for any custom server-side modifications.
5. **Production track record** — Reddit's voice rooms, OpenAI's ChatGPT voice mode, and Spotify's Greenroom all run on LiveKit, demonstrating scale and stability.
6. **Apache 2.0 license** — permissive, compatible with the mycongregation server's AGPL-3.0 license.

### 4.3 Alternatives Rejected

- **mediasoup:** Excellent technically, but lack of official RN SDK is disqualifying. We don't have engineering capacity to build and maintain custom SDKs.
- **Jitsi Videobridge (standalone):** Powerful but operationally heavier; XMPP signaling adds complexity. Better suited to operators running the full Jitsi Meet stack.
- **Jitsi Meet (full hosted-style):** Considered as a "use the whole Jitsi product" alternative. Rejected because (a) we want tight integration into our existing app, not embedding an external meeting product; (b) UI is opinionated and difficult to customize.
- **Janus:** GPLv3 license, very low-level C configuration, no JS server SDK. Better for telco/SIP scenarios.
- **BigBlueButton:** Targeted at education, includes whiteboard/breakout features we don't need, heavyweight to deploy.

---

## 5. Architecture Overview

### 5.1 High-Level Diagram

```
                  ┌─────────────────────────────────────┐
                  │   Mobile + Web Client               │
                  │   (LiveKit SDK + REST/HTTP)         │
                  └─────────┬──────────────────┬────────┘
                            │                  │
                  REST API  │                  │  WebRTC
                  (auth +   │                  │  (media + signaling
                   token)   │                  │   over WSS/UDP)
                            ▼                  ▼
                  ┌────────────────┐   ┌──────────────────────┐
                  │  NestJS API    │   │  LiveKit SFU         │
                  │  (existing)    │◄──┤  (new, dedicated VPS)│
                  │                │   │                      │
                  │  - Auth (JWT)  │   │  - SFU core (Go)     │
                  │  - Meetings    │   │  - TURN server       │
                  │  - Token sign  │   │  - Redis (state)     │
                  │  - Webhooks    │   │                      │
                  └───────┬────────┘   └──────────────────────┘
                          │                       ▲
                          ▼                       │
                  ┌────────────────┐    webhook   │
                  │  PostgreSQL    │   (events)   │
                  │  (existing)    │              │
                  │                │              │
                  │  - Meetings    │──────────────┘
                  │  - Participants│
                  │  - Chat logs?  │
                  └────────────────┘
```

### 5.2 Key Architectural Principle

**Media traffic bypasses NestJS entirely.** NestJS is only involved in:

1. Authenticating the user (existing JWT flow)
2. Authorizing room access
3. Signing a short-lived LiveKit JWT
4. Receiving webhooks from LiveKit (participant joined, room ended, etc.)
5. Storing meeting metadata in Postgres

Once the client receives a LiveKit JWT, it connects directly to the LiveKit server for all media exchange. This separation:

- Keeps the existing API server free of WebRTC complexity
- Allows the LiveKit server to be scaled or replaced independently
- Reduces attack surface (NestJS sees only HTTP, no UDP)
- Enables independent network tuning (LiveKit needs UDP port range, NestJS does not)

### 5.3 Network Topology

| Component | Domain (proposed) | Hosting | Public ports |
|-----------|------------------|---------|--------------|
| NestJS API | `mycongregation.org/api` | Existing CX22 VPS | 443 (HTTPS, Cloudflare) |
| LiveKit Server | `meet.mycongregation.org` | New CCX13 VPS | 443 (signaling WSS), 7881 (TURN-TLS), 50000–60000 UDP (RTP) |
| PostgreSQL | (internal) | Existing CX22 VPS | 127.0.0.1:5433 |

LiveKit **does not** sit behind Cloudflare (Cloudflare doesn't proxy WebRTC media). It will have its own DNS A record pointing directly to the new VPS, with Let's Encrypt TLS for signaling.

---

## 6. Component Specifications

### 6.1 Mobile/Web Client

**Mobile (React Native / Expo):**

- Package: `@livekit/react-native` + `@livekit/react-native-webrtc`
- Required Expo config: custom dev client (this package requires native code, not available in Expo Go)
- Permissions:
  - Android: `RECORD_AUDIO`, `CAMERA`, foreground service for background calls
  - iOS: `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, optionally Broadcast Extension for screen sharing
- Key features used:
  - `Room.connect(url, token)`
  - `LocalParticipant.setMicrophoneEnabled(bool)`, `setCameraEnabled(bool)`
  - `Room.on('participantConnected' | 'trackSubscribed' | …)` for UI updates
  - Simulcast: 3 layers (low/medium/high) published automatically, server selects per-subscriber
  - `DataPacket` channel for chat messages

**Web (future, when web client is rebuilt):**

- Package: `livekit-client` (browser SDK)
- Works in all modern browsers via WebRTC
- Screen sharing via `getDisplayMedia()` (no native code needed)

### 6.2 NestJS API — Video Meetings Module

**New module:** `src/video-meetings/`

**Entities:**

```typescript
// video_meetings table
@Entity('video_meetings')
class VideoMeeting {
  id: uuid (PK)
  congregationId: uuid (FK)
  title: string (encrypted via transformer)
  scheduledFor: timestamp
  createdById: uuid (FK to users)
  status: 'scheduled' | 'live' | 'ended'
  startedAt: timestamp | null
  endedAt: timestamp | null
  liveKitRoomName: string  // unique LiveKit room identifier
  createdAt, updatedAt
}

// meeting_participants table
@Entity('meeting_participants')
class MeetingParticipant {
  id: uuid (PK)
  meetingId: uuid (FK)
  userId: uuid (FK)
  role: 'host' | 'cohost' | 'participant'
  joinedAt: timestamp | null
  leftAt: timestamp | null
  invited: boolean
  createdAt
}
```

**Endpoints:**

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/meetings` | Create a meeting (with invited participants) | JWT |
| GET | `/meetings` | List meetings for current congregation | JWT |
| GET | `/meetings/:id` | Get meeting details | JWT |
| PATCH | `/meetings/:id` | Update meeting (host only) | JWT |
| DELETE | `/meetings/:id` | Cancel meeting (creator/host only) | JWT |
| POST | `/meetings/:id/join` | Get LiveKit URL + token to join | JWT |
| POST | `/meetings/:id/end` | Force-end meeting (host only) | JWT |
| POST | `/meetings/webhook` | LiveKit webhook receiver | LiveKit secret |

**Token signing logic** (key concept):

```typescript
// src/video-meetings/livekit-token.service.ts
async generateAccessToken(
  user: User,
  meeting: VideoMeeting,
  role: ParticipantRole,
): Promise<{ url: string; token: string }> {
  const at = new AccessToken(
    this.config.livekitApiKey,
    this.config.livekitApiSecret,
    {
      identity: user.id,                          // unique per user
      name: `${user.firstName} ${user.lastName}`, // display name
      ttl: '4h',                                  // token validity
    },
  );

  at.addGrant({
    roomJoin: true,
    room: meeting.liveKitRoomName,
    canPublish: true,                              // can send audio/video
    canSubscribe: true,                            // can receive others
    canPublishData: true,                          // chat channel
    roomAdmin: role === 'host',                    // host privileges
    roomCreate: false,                             // room pre-created by API
  });

  return {
    url: this.config.livekitWsUrl,                 // wss://meet.mycongregation.org
    token: await at.toJwt(),
  };
}
```

**Webhook handler** receives events from LiveKit:

- `room_started`, `room_finished`
- `participant_joined`, `participant_left`
- `track_published`, `track_unpublished`

These are persisted to `meeting_participants` for audit logs and to update `joinedAt`/`leftAt` timestamps.

### 6.3 LiveKit Server

**Deployment:** Docker container on dedicated Hetzner VPS.

**docker-compose.yml** (skeleton):

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    network_mode: host  # required for UDP port range
    restart: unless-stopped
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config

volumes:
  redis-data:
  caddy-data:
  caddy-config:
```

**livekit.yaml** (skeleton):

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: localhost:6379
keys:
  <API_KEY>: <API_SECRET>   # shared with NestJS, stored in vault
turn:
  enabled: true
  domain: meet.mycongregation.org
  tls_port: 5349
webhook:
  api_key: <API_KEY>
  urls:
    - https://mycongregation.org/api/meetings/webhook
```

**Caddyfile:**

```
meet.mycongregation.org {
    reverse_proxy /rtc* localhost:7880
    reverse_proxy * localhost:7880
}
```

Caddy auto-provisions Let's Encrypt TLS. LiveKit's signaling (WebSocket Secure) is served via Caddy on 443; the UDP/TURN ports are exposed directly via `network_mode: host`.

### 6.4 PostgreSQL Extensions

New migration adds two tables (`video_meetings`, `meeting_participants`). Sensitive text columns (`title`, `notes`) use the existing `encryptedTransformer` from Phase 1 Data Protection.

No new database — uses the existing `mycongregation-postgres` container.

---

## 7. Data Flow Sequences

### 7.1 Creating a Meeting

```
Client          NestJS               Postgres        LiveKit
  │                │                     │              │
  │── POST ───────►│                     │              │
  │  /meetings     │                     │              │
  │   {title,      │                     │              │
  │    scheduled,  │                     │              │
  │    invited}    │                     │              │
  │                │── INSERT video_     │              │
  │                │    meetings ───────►│              │
  │                │                     │              │
  │                │── INSERT meeting_   │              │
  │                │    participants ───►│              │
  │                │                     │              │
  │                │── (optional) create │              │
  │                │    room via SDK ────┼─────────────►│
  │                │                     │   roomCreate │
  │                │◄────────────────────┼──────────────│
  │                │                     │       200 OK │
  │◄────── 201 ────│                     │              │
  │   {id, ...}    │                     │              │
```

Note: room creation in LiveKit is optional — rooms auto-create on first participant join. We may pre-create only for scheduled meetings with a known time.

### 7.2 Joining a Meeting

```
Client          NestJS               Postgres        LiveKit
  │                │                     │              │
  │── POST ───────►│                     │              │
  │  /meetings/    │                     │              │
  │  :id/join      │                     │              │
  │                │── SELECT meeting,   │              │
  │                │    check permission ►              │
  │                │◄────────────────────│              │
  │                │                     │              │
  │                │── sign LiveKit JWT  │              │
  │                │    (in-process,     │              │
  │                │     no network)     │              │
  │◄────── 200 ────│                     │              │
  │  {url, token}  │                     │              │
  │                │                     │              │
  │── WSS /rtc ────┼─────────────────────┼─────────────►│
  │  with token    │                     │              │
  │                │                     │              │
  │── ICE/DTLS/SRTP setup ───────────────┼─────────────►│
  │                                                     │
  │── send/receive RTP media ────────────┼─────────────►│
  │                                                     │
  │                │◄── webhook ─────────┼──────────────│
  │                │    "participant_    │              │
  │                │     joined"         │              │
  │                │── UPDATE meeting_   │              │
  │                │    participants ───►│              │
```

### 7.3 Host Actions (mute, kick)

```
Host Client     NestJS               LiveKit
  │                │                     │
  │── POST /meetings/:id/                 │
  │   participants/:uid/                  │
  │   mute  ──────►│                     │
  │                │── verify host role  │
  │                │── server SDK call ─►│
  │                │   mutePublishedTrack│
  │                │◄────────────────────│
  │◄──── 200 ──────│                     │
  │                                       │
  │                              ───────►│ forwards mute event
  │                                       │ to muted client
  │                                       │
  │                              kicked client receives event,
  │                              local UI updates accordingly
```

### 7.4 Meeting Ending

A meeting can end three ways:

1. **Host clicks "End meeting for all"** → API calls LiveKit `deleteRoom()` → LiveKit disconnects all participants → webhook `room_finished` → NestJS marks meeting as `ended`.
2. **Last participant leaves** → LiveKit auto-deletes empty room after configured timeout (default 30s) → webhook `room_finished`.
3. **Scheduled end time** (if implemented) → cron job calls `deleteRoom()`.

### 7.5 In-Meeting Chat

Chat messages use LiveKit's **data channel** (a WebRTC SCTP channel) rather than going through NestJS:

- Client A: `room.localParticipant.publishData(encoder.encode(JSON.stringify({text, timestamp})), DataPacket_Kind.RELIABLE)`
- All other clients receive via `room.on('dataReceived', (payload, participant) => …)`
- **Latency:** typically <100ms (same path as media)
- **Persistence:** none by default (messages are ephemeral)

If chat history is needed later, NestJS can subscribe to the data channel (via LiveKit's server SDK) and persist messages to Postgres with the existing encryption transformer. **Deferred to a future phase.**

---

## 8. Bandwidth and Capacity Planning

### 8.1 Per-Stream Bandwidth (Estimated)

| Stream type | Bitrate | Notes |
|-------------|---------|-------|
| Audio (Opus, 48 kHz) | ~30 Kbps | Per active speaker |
| Video low (180p) | ~150 Kbps | Simulcast low layer |
| Video medium (360p) | ~400 Kbps | Default for thumbnails |
| Video high (720p) | ~1.5 Mbps | For active speaker |
| Screen share | ~1.5 Mbps | Variable based on motion |

### 8.2 Typical Scenario: Congregation Meeting (200 participants)

Realistic assumption: **1–5 active speakers at any moment** (chairman, current speaker, current reader, possible Q&A participant). The remaining 195+ participants are passive (audio-only or video off).

| Direction | Calculation | Total |
|-----------|-------------|-------|
| Per-client upload | 1 stream × 500 Kbps (own video) + 30 Kbps (own audio) | ~530 Kbps |
| Per-client download | 5 streams × 500 Kbps (others) + 5 × 30 Kbps (audio) | ~2.65 Mbps |
| **Server ingress** | 200 × 530 Kbps (everyone's upload) | ~106 Mbps |
| **Server egress** | 5 active streams × 200 subscribers × 500 Kbps | **~500 Mbps** |

The **egress is the dominant cost.** Hetzner VPS instances have 1 Gbps NIC speed with unlimited monthly traffic on most plans (verify current pricing — included traffic varies by plan).

### 8.3 Worst Case: All 200 with Camera On

| Direction | Calculation | Total |
|-----------|-------------|-------|
| Per-client upload | 1 × 500 Kbps + 1 × 30 Kbps | ~530 Kbps |
| Per-client download | 199 streams × 200 Kbps (low layer auto-selected) + 199 × 30 Kbps | ~46 Mbps ❌ |
| **Server egress** | 200 streams × 199 subscribers × 200 Kbps | ~8 Gbps ❌ |

200-everyone-on-camera is unrealistic and would not work on typical home internet anyway. **Mitigation:** the client UI should limit visible video tiles to ~9–16 active speakers, with the rest as audio-only. LiveKit's simulcast handles selecting the right layer per subscriber.

### 8.4 Client Bandwidth Requirements

| Connection quality | Behavior |
|--------------------|----------|
| <1 Mbps down | Audio-only mode (LiveKit auto-degrades) |
| 1–3 Mbps down | Low-res video, 4–6 tiles |
| 3–10 Mbps down | Medium-res, 9–16 tiles |
| 10+ Mbps down | High-res, full grid |

LiveKit's **adaptive subscription** and **simulcast** handle this transparently. A 3 Mbps DSL connection in a rural area can still participate fully.

---

## 9. Infrastructure

### 9.1 VPS Sizing (Hetzner)

| Plan | vCPU | RAM | Bandwidth | €/month | Suitable for |
|------|------|-----|-----------|---------|--------------|
| CX22 (existing) | 2 (shared) | 4 GB | 20 TB | 4.51 | ❌ Not for LiveKit — shared CPU degrades media |
| **CCX13** | 2 dedicated AMD | 8 GB | 20 TB | 13.50 | ✅ Recommended for V1 (up to 200 participants) |
| CCX23 | 4 dedicated AMD | 16 GB | 20 TB | 28.50 | Headroom for growth + recording |
| CCX33 | 8 dedicated AMD | 32 GB | 30 TB | 56.50 | Multi-room concurrent load |

**Why dedicated CPU matters:** WebRTC media routing is sensitive to CPU jitter. Shared-CPU plans (CX*) experience packet processing delays when neighbor VMs spike, manifesting as audio glitches and frame drops for users. The CCX line has dedicated AMD EPYC cores.

**Why a separate VPS from the main API:**

- UDP port range 50000–60000 (10,000 ports) shouldn't share a firewall config with the API server
- LiveKit CPU spikes during meetings should not impact the database or NestJS
- Independent scaling: if meetings outgrow the server, scale only the LiveKit VPS
- Independent restart cycles: deploying NestJS does not interrupt ongoing meetings

### 9.2 Domain & DNS

- New A record: `meet.mycongregation.org` → IP of LiveKit VPS
- **Not** behind Cloudflare proxy (orange cloud OFF) — Cloudflare does not proxy WebRTC/UDP
- DNS-only mode is sufficient
- TLS via Let's Encrypt (Caddy auto-renews)

### 9.3 Operational Considerations

- **Monitoring:** LiveKit exposes Prometheus metrics on port 6789. Scrape into a Grafana instance (existing or new).
- **Logging:** LiveKit logs to stdout; ship to Better Stack via Docker logging driver (consistent with existing setup).
- **Backups:** LiveKit is stateless except for ephemeral Redis state. Only `livekit.yaml` and `Caddyfile` need version control (commit to a separate repo or `mycongregation-infra` repo).
- **Disaster recovery:** rebuild from scratch using a documented playbook — same Docker images, same config files, new VPS. RTO <30 minutes.

---

## 10. Security & Privacy

### 10.1 Transport Encryption

- **Signaling:** WSS (WebSocket over TLS 1.3) on 443
- **Media:** DTLS-SRTP (mandatory in WebRTC) — every RTP packet authenticated and encrypted
- **TURN relay:** when used (NAT traversal failure), traffic remains DTLS-SRTP encrypted end-to-end (server only forwards encrypted packets)

### 10.2 End-to-End Encryption (E2EE)

LiveKit supports E2EE via the **Insertable Streams API** (WebRTC). When enabled:

- Each participant generates a per-room symmetric key
- Keys are exchanged via the signaling channel (signed by the room admin)
- Media frames are encrypted on the publisher *before* the SFU sees them, decrypted on the subscriber *after* receiving them
- The SFU forwards opaque encrypted payloads — it cannot decode media even with full filesystem access

**Trade-off:** E2EE disables server-side features like recording, transcription, and quality adaptation (the server can't analyze frames). For pastoral / sensitive conversations, this is acceptable.

**Recommendation:**

- **Default:** E2EE off (better quality adaptation, can be debugged from server)
- **Optional toggle:** "Enhanced privacy mode" enabled by host for sensitive meetings (elders' meetings, pastoral discussions)
- **Documented:** clearly communicate to users which mode is active

### 10.3 Authorization

JWT-based, enforced at two levels:

1. **NestJS issues LiveKit JWT only after verifying** the user belongs to the congregation and is either invited or has a role that grants access (e.g., elders for elder-meetings).
2. **LiveKit verifies its own JWT signature** (using shared API_SECRET) before admitting the participant.

Token TTL is short (4 hours) to limit replay risk. Host-elevation grants are encoded in the JWT (`roomAdmin: true`) — cannot be self-elevated by the client.

### 10.4 Recording Policy

**Default: no recording.** Religious / pastoral content recorded without explicit consent is a privacy and legal risk in EU jurisdictions.

If recording is later added:

- Opt-in per meeting (host action, not automatic)
- Visible recording indicator in UI for all participants at all times
- Recordings encrypted at rest with per-meeting key (extending Phase 1 encryption)
- Auto-deletion after configurable retention period (e.g., 30 days)
- Audit log of every recording start/stop/download

### 10.5 Chat Privacy

In V1, chat messages are ephemeral (live-only, no persistence). This matches the privacy expectations of in-person conversations.

If persistent chat history is added later, messages are encrypted via the existing `encryptedTransformer` in Postgres.

### 10.6 JW-Specific Considerations

- **Meeting recordings** are sensitive — could be misused if leaked. Default-off recording is a feature, not a limitation.
- **Pastoral conversations** (shepherding calls between elders and publishers) should default to E2EE mode.
- **No analytics or telemetry** sent to third parties (no Google Analytics, no Mixpanel, no LiveKit Cloud telemetry — verify with `disable_telemetry: true` in livekit.yaml).
- **Participant list visibility:** publishers may not want their face seen by the entire congregation in a single meeting; host should be able to grant "audio-only" mode to specific participants.

---

## 11. Implementation Roadmap

### 11.1 Phase V1 — MVP (2 weeks)

**Goal:** End-to-end working video conference, basic UX, manual meeting creation.

- Provision new Hetzner VPS (CCX13)
- Deploy LiveKit server via Docker Compose
- DNS + TLS setup (Caddy + Let's Encrypt)
- NestJS `video-meetings` module:
  - Entities (VideoMeeting, MeetingParticipant)
  - Migration
  - CRUD endpoints
  - Token generation service
  - Webhook receiver
- Mobile UI:
  - Tab/screen for meetings list
  - Create meeting form
  - Join meeting flow → LiveKit room screen
  - Video grid (responsive: 1, 2x2, 3x3, 4x4)
  - Mic/camera toggle buttons
  - Leave meeting button
- Simple text chat (LiveKit data channel)
- Basic error handling (permissions denied, network failure, etc.)
- End-to-end test: 2-person call works locally, then on prod

**Deliverable:** A working video call between 2+ devices, scheduled via the app.

### 11.2 Phase V2 — Host Roles & Admin Controls (1 week)

**Goal:** Hosts can manage meetings.

- Role assignment when creating meeting (designate hosts)
- Token includes `roomAdmin: true` for hosts
- Host UI overlay:
  - Mute participant
  - Disable participant's camera
  - Remove participant
  - End meeting for everyone
- Waiting room / lobby:
  - Participants enter "lobby" state, host admits
  - Or auto-admit for invited participants
- Audit log of host actions (in Postgres)

**Deliverable:** Hosts can run meetings with full moderation control.

### 11.3 Phase V3 — Screen Share + Optional Recording (1 week)

**Goal:** Screen sharing for talks; optional recording for archival.

- Screen share button (web: immediate; iOS: Broadcast Extension setup; Android: foreground service)
- LiveKit Egress configured (optional):
  - Records to local disk on LiveKit VPS
  - Uploads to S3-compatible storage (Hetzner Storage Box or similar)
- Recording opt-in flow:
  - Host clicks "Start recording" → all participants see banner + audible chime
  - Indicator persistent throughout recording
  - "Stop recording" → file saved, link emailed to host
- Retention policy:
  - Auto-delete after 30 days (configurable)
  - Manual delete by host or admin

**Deliverable:** Public talks can be screen-shared and optionally recorded for missed-meeting catch-up.

### 11.4 Phase V4 — Production Hardening (1 week)

**Goal:** Operational maturity.

- Prometheus metrics scraping (LiveKit + system metrics)
- Grafana dashboard (active meetings, bandwidth, CPU, errors)
- Better Stack log shipping
- Sentry integration for client-side errors
- Alerts:
  - LiveKit down
  - High bandwidth usage (approaching plan limit)
  - High participant count (capacity warning)
  - Webhook delivery failures
- Documentation:
  - Operations runbook (restart procedures, scaling steps)
  - User guide (how to host, how to join, troubleshooting)
  - Incident response playbook
- Load test (simulated 200-participant meeting using LiveKit's load-test CLI)
- Security review (check TLS config, JWT TTL, webhook validation)

**Deliverable:** Production-grade observability and operational confidence.

### 11.5 Estimated Total Effort

| Phase | Duration | Cumulative |
|-------|----------|------------|
| V1 — MVP | 2 weeks | 2 weeks |
| V2 — Host roles | 1 week | 3 weeks |
| V3 — Screen share + recording | 1 week | 4 weeks |
| V4 — Production hardening | 1 week | 5 weeks |
| **Total** | **5 weeks** | |

Realistic calendar time (accounting for non-development days, testing, learning curve): **6–8 weeks**.

---

## 12. Open Questions / Decisions Deferred

| # | Question | When to decide |
|---|----------|----------------|
| 1 | Should we use LiveKit Cloud (managed) instead of self-hosting? | Before V1 start. Self-host preferred per NFR-2, but managed reduces ops burden. |
| 2 | Do we need recording in V1, or can it wait to V3? | Before V1 start. Likely defer. |
| 3 | What is the screen-share UX on iOS (Broadcast Extension is non-trivial)? | V3 planning. |
| 4 | Should chat history be persisted? Where? | V2 review. |
| 5 | Do elders need separate "elder-only" meeting rooms with restricted invite? | V2 planning (roles UX). |
| 6 | What happens if LiveKit VPS exceeds bandwidth? Auto-scale? Cap meetings? | V4 ops planning. |
| 7 | Should we support phone-in (dial via PSTN)? | Out of scope — adds significant complexity. Revisit after V4. |
| 8 | How do we handle very large meetings (>200, e.g., circuit assemblies with 500+)? | Future. Would require LiveKit cluster mode with multiple SFU nodes (Distributed Mesh). |
| 9 | What client-side configuration for low-bandwidth users (e.g., audio-only mode default)? | V1 client UX design. |
| 10 | Localization of video UI (Russian + future locales)? | V1 mobile UI work. |

---

## 13. Alternatives Considered (Detail)

### 13.1 LiveKit Cloud (managed)

**Pros:** Zero ops, instant deploy, generous free tier, global edge network.
**Cons:** Vendor dependency, ongoing cost at scale, data leaves our infrastructure (privacy concern).
**Verdict:** Could be used in V1 to ship faster, then migrate to self-hosted later. Open question 1.

### 13.2 Jitsi Meet (full hosted stack)

**Pros:** Mature, used by millions, includes web UI out of box.
**Cons:** Embedding Jitsi as an iframe in React Native is clunky; native SDK is heavier; less customizable.
**Verdict:** Rejected — we want native UI integration.

### 13.3 BigBlueButton

**Pros:** Designed for education, includes whiteboard, breakout rooms, polls.
**Cons:** Heavy stack (Java + Node + FreeSWITCH + others), no native mobile SDK, education-focused features we don't need.
**Verdict:** Rejected — wrong use case.

### 13.4 mediasoup (custom build)

**Pros:** Highly flexible, excellent performance, fine-grained control.
**Cons:** No official RN SDK, requires building custom signaling protocol on top, significant engineering investment.
**Verdict:** Rejected — engineering capacity does not justify the flexibility gained.

### 13.5 Use existing FOSS service (Jitsi Meet at meet.jit.si)

**Pros:** Free, no setup.
**Cons:** No control over uptime, no GDPR data-processing agreement, can't customize, not integrated with our app.
**Verdict:** Rejected — violates NFR-2 (self-hosted) and NFR-8 (integrated auth).

### 13.6 WebRTC direct (no SFU, P2P)

**Pros:** No server cost for media.
**Cons:** O(n²) connections don't scale beyond ~6 participants. Already covered in §3.1.
**Verdict:** Rejected — does not meet FR-1.

---

## 14. References

- LiveKit documentation: https://docs.livekit.io/
- LiveKit GitHub: https://github.com/livekit/livekit
- React Native SDK: https://github.com/livekit/client-sdk-react-native
- Server SDK (Node.js): https://github.com/livekit/server-sdk-js
- WebRTC specifications: https://www.w3.org/TR/webrtc/
- Simulcast in WebRTC: https://webrtcglossary.com/simulcast/
- Comparison of WebRTC SFUs: https://bloggeek.me/webrtc-sfu-comparison/
- Hetzner Cloud pricing: https://www.hetzner.com/cloud
- DTLS-SRTP specification: https://datatracker.ietf.org/doc/html/rfc5764
- Insertable Streams (E2EE): https://www.w3.org/TR/webrtc-encoded-transform/

---

## 15. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-14 | Lionel + Claude | Initial design document |

---

**Status:** Ready for review. No implementation scheduled — see roadmap in §11. To start V1, first resolve open questions §12 #1 and #2.
