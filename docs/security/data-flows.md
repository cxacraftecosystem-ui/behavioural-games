# Data-flow diagrams

These diagrams are the basis for the STRIDE analysis in [threat-model.md](threat-model.md). They show the
**target architecture** from `docs/IMPLEMENTATION_PLAN.md` §2 and `docs/BUILD_DECISIONS.md`. Where the
wave-1 code differs, a note under the diagram says so.

The [production pilot](#production-pilot-as-deployed-2026-11-04) at the end shows what is deployed today.

Trust boundaries are drawn as subgraphs with the label `TB-n`. Element IDs (`K1`, `A2`, ...) are used in
the threat tables.

| Boundary | Separates | Main controls at the boundary |
|---|---|---|
| TB-1 Kiosk enclosure | The public (players, onlookers, passers-by) from kiosk hardware | Locked enclosure, no exposed ports, touch-only UI, privacy film, tamper switch (KSK-09, KSK-12) |
| TB-2 Kiosk OS / app | Untrusted local input (touch, USB, network) from the kiosk app and its keys | Ubuntu Core strict confinement, secure boot, TPM-backed FDE, Electron sandbox and CSP (KSK-01, KSK-09) |
| TB-3 Public network | Kiosk and browsers from the backend | TLS 1.3, kiosk mTLS (step-ca), device tokens, WAF/rate limits (PRV-07, PRV-09) |
| TB-4 Backend service zone | API processes from the data stores | Private subnets, per-role DB credentials, KMS key policies (PRV-07, PRV-08) |
| TB-5 Identity vault | Contact data from everything else | Separate DB, separate keys, IdentitySteward-only access (PRV-04) |
| TB-6 Research workstation | Researchers' devices and exports from the platform | OIDC + MFA, RBAC, export justification, de-identified snapshots (PRV-08, VAL-17) |

## L0: system context

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart LR
  subgraph TB1["TB-1 Public space"]
    P[Player 18+]
    O[Onlooker]
    FA[Field administrator]
  end
  subgraph TB2["TB-1/TB-2 Kiosk"]
    K[Kiosk app<br/>Electron on Ubuntu Core]
  end
  subgraph TB3["TB-3 Internet"]
    PH[Player phone<br/>report QR page]
  end
  subgraph TB4["TB-4 Backend (AWS ap-south-1)"]
    API[FastAPI service<br/>+ job worker]
    DB[(PostgreSQL 18<br/>research DB)]
    S3[(S3 raw batches<br/>+ Parquet snapshots)]
    KMS[[KMS]]
  end
  subgraph TB5["TB-5 Identity vault"]
    V[(identity_vault DB)]
  end
  subgraph TB6["TB-6 Research zone"]
    WEB[frontend/apps/web<br/>/research and /admin]
    R[Researcher / analyst]
  end
  IDP[[OIDC provider<br/>Cognito + MFA]]
  CA[[step-ca]]

  P -- touch, optional closed-vocab voice --> K
  O -. shoulder-surfing .-> K
  FA -- admin unlock, pid QR --> K
  K -- "UploadBatch (sealed chunks), heartbeat" --> API
  API -- "signed policy, content, release packs" --> K
  K -. "QR with report token" .-> PH
  PH -- "GET report by token / erase" --> API
  R --> WEB -- "JWT" --> API
  WEB -- login --> IDP
  API -- JWKS --> IDP
  K -- "CSR / short-lived cert" --> CA
  API --> DB
  API --> S3
  API -- "unwrap / wrap DEKs" --> KMS
  API -- separate connection --> V
```

## L1: kiosk internals (TB-1, TB-2)

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart TB
  subgraph TB1["TB-1 Enclosure"]
    T[Touchscreen] --> R
    MIC[USB mic<br/>closed outside consented prompt windows] -.-> R
    HS[Headset jack] --- AUD
    PR[ESC/POS printer] 
    NFC[NFC reader<br/>admin unlock]
    USB[(USB ports<br/>blocked / storage disabled)]
  end
  subgraph TB2["TB-2 Ubuntu Core + snap confinement"]
    subgraph RENDERER["Renderer (sandbox, contextIsolation, CSP)"]
      R[React + PixiJS game<br/>XState session machine]
      LOG[Logger SDK]
      AUD[Audio router<br/>never-voice rule]
    end
    subgraph MAIN["Electron main process"]
      OB[(Outbox SQLite WAL<br/>events encrypted with per-session DEK)]
      UP[Uploader<br/>paused during play]
      UPD[Updater<br/>signed OTA rings]
      POL[Policy verifier<br/>signed DeploymentPolicy]
    end
    TPM[[TPM 2.0<br/>FDE key, mTLS key, DEK seal]]
  end
  R --> LOG -- "IPC (preload allow-list)" --> OB
  OB --> UP
  UP -- "mTLS + device token" --> NET((TB-3))
  UPD -- "signed manifests" --> NET
  POL --> R
  OB -. "DEK sealed to backend X25519 key<br/>and to TPM for local purge" .-> TPM
  R --> PR
  NFC --> R
```

Wave-1 notes: the browser build uses an IndexedDB (Dexie) outbox and sends `none_dev` plaintext chunks;
sealing, SQLite and TPM integration are later features (KSK-07 in Electron). The Electron scaffold already
sets `sandbox`, `contextIsolation`, a strict CSP and a deny-all permission handler
(`frontend/apps/kiosk/electron/main.ts`). The uploader does not attach a device credential yet.

## L1: ingestion (TB-3, TB-4)

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
sequenceDiagram
  autonumber
  participant K as Kiosk uploader
  participant LB as TLS terminator / WAF (TB-3)
  participant API as POST /api/v1/events/batch
  participant DB as PostgreSQL (kiosk_raw, consent)
  participant KMS as KMS (KEK)
  K->>LB: UploadBatch, mTLS client cert, Bearer kdt_...
  LB->>API: forwarded (size limit, rate limit per kiosk)
  API->>DB: resolve device token digest -> kiosk (active?)
  API->>API: parse shell, verify JCS sha256, kiosk_id == token kiosk
  API->>DB: advisory lock on batch_id, replay the stored result if final
  loop each session chunk
    API->>API: unseal DEK (backend X25519 private key)
    API->>KMS: wrap DEK under KEK (consent.session_keys)
    API->>DB: store raw chunk (ciphertext)
    API->>DB: try advisory lock(session) else 'retryable'
    API->>API: per event: Pydantic + invariants -> DLQ on failure
    API->>DB: event_dedup INSERT ON CONFLICT DO NOTHING
    API->>DB: consent parking / events (partition by server date)
  end
  API->>DB: seq-gap flags, clock offset, lifecycle jobs, batch result
  API-->>K: per-event statuses
  API->>DB: audit row (own transaction)
```

Wave-1 notes: the backend X25519 private key and the KEK are environment variables derived from
`DEV_JWT_SECRET` in dev/test and required explicitly in staging/prod (`settings.py`). KMS is the target.
Raw chunks are stored in `kiosk_raw.batch_chunks` (JSONB), not S3. There is no mTLS yet.

## L1: research web app and data platform (TB-4, TB-5, TB-6)

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart LR
  subgraph TB6["TB-6 Research zone"]
    BR[Browser<br/>frontend/apps/web /research, /admin]
    ADM[Tablet: researcher-administered<br/>criterion battery]
  end
  subgraph TB4["TB-4 Backend"]
    API[FastAPI<br/>RBAC + audit middleware]
    W[Job worker<br/>FOR UPDATE SKIP LOCKED]
    subgraph DB["Research DB"]
      RAW[(kiosk_raw<br/>append-only)]
      SC[(scored / criterion)]
      CON[(consent / linkage)]
      VAL[(validation / reporting)]
      GOV[(governance.audit_events<br/>append-only)]
    end
    FS[(DATA_DIR / S3<br/>Parquet snapshots)]
  end
  subgraph TB5["TB-5 Identity vault"]
    VAULT[(contacts<br/>column-encrypted)]
  end
  IDP[[OIDC + MFA]]
  BR -- "OIDC code flow" --> IDP
  BR -- "Bearer JWT" --> API
  ADM -- "Bearer JWT (administrator role)" --> API
  API --> RAW & SC & CON & VAL
  API -- "every write + research read" --> GOV
  API -- "IdentitySteward only" --> VAULT
  W --> SC & VAL & FS
  API -- "snapshot download<br/>(de-identified)" --> BR
```

Wave-1 notes: `IDENTITY_DATABASE_URL` falls back to the research `DATABASE_URL` when unset, so in a
default deployment the vault shares the server and credentials with the research DB. Production must set
it (see [scan-findings.md](scan-findings.md), SF-04). Postgres RLS (PRV-08) is not in place; RBAC is
enforced in the API.

## Key hierarchy

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart TB
  KMSK[[KMS CMK<br/>ap-south-1]] --> KEK[Session-key KEK]
  KMSK --> VK[Vault column key]
  KMSK --> BK[Backup key<br/>separate]
  X[Backend X25519 private key<br/>in KMS / HSM] -.unseals.-> DEK
  KEK -- "AES-256-GCM wrap, AAD=session_id" --> WDEK[(consent.session_keys<br/>wrapped DEK)]
  DEK[Per-session DEK<br/>32 bytes, kiosk-generated] -- "AES-256-GCM" --> CH[(Raw chunk ciphertext<br/>DB / S3, all versions)]
  TPMK[[Kiosk TPM]] -- "seals" --> KDEK[Kiosk copy of DEK<br/>local purge]
  TPMK -- "non-exportable" --> MTLS[mTLS private key]
  PEP[pid HMAC pepper<br/>versioned] --> HM[(linkage table<br/>HMAC of contact and pid)]
  ED[Ed25519 signing key] --> RP[Release packs,<br/>erasure receipts]
  ERASE{{Erasure}} -- "delete wrapped DEK" --> WDEK
  ERASE -. "crypto-shreds" .-> CH
```

Erasing a session deletes its wrapped DEK, which makes every stored copy of its raw chunks unreadable
(ING-08, PRV-06). This only holds while no plaintext copy of the DEK or the events survives elsewhere:
the `kiosk_raw.events` rows (plaintext JSONB) and dead letters are deleted by the erasure job itself, and
backups must expire within the erasure SLA (PRV-05: ≤ 14 days).

## Erasure and withdrawal flow

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart LR
  A[Kiosk hand icon /<br/>report page 'erase my data' /<br/>researcher request] --> B[erasure_request row]
  B --> J[erasure job]
  J --> D1[delete events, chunks,<br/>indicators, criterion, links]
  J --> D2[delete wrapped DEK<br/>= crypto-shred raw copies]
  J --> D3[purge DLQ + consent parking]
  J --> D4[tombstone session/pid<br/>refuse re-uploads]
  J --> D5[tombstone snapshots,<br/>queue rebuilds]
  J --> R[signed erasure receipt]
  D4 -. "replay guard after restore" .-> J
```

## Production pilot as deployed (2026-11-04)

The target diagrams above assume Cognito, KMS, S3 and kiosk mTLS. The pilot that runs today, on synthetic data
only, is smaller:

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif","fontSize":"15px","primaryColor":"#F2E9FE","primaryTextColor":"#1E1B2E","primaryBorderColor":"#9148D2","secondaryColor":"#FAEECD","secondaryTextColor":"#1E1B2E","secondaryBorderColor":"#CD9200","tertiaryColor":"#F3F1FA","tertiaryTextColor":"#1E1B2E","tertiaryBorderColor":"#A7A3BC","mainBkg":"#F2E9FE","nodeBorder":"#9148D2","nodeTextColor":"#1E1B2E","lineColor":"#AA69E9","textColor":"#857F9E","edgeLabelBackground":"#F9F5FF","clusterBkg":"#F9F5FF","clusterBorder":"#D6B6FB","titleColor":"#762CB1","noteBkgColor":"#FAEECD","noteTextColor":"#1E1B2E","noteBorderColor":"#CD9200","actorBkg":"#F2E9FE","actorBorder":"#9148D2","actorTextColor":"#1E1B2E","actorLineColor":"#AA69E9","signalColor":"#AA69E9","signalTextColor":"#857F9E","labelBoxBkgColor":"#F2E9FE","labelBoxBorderColor":"#9148D2","labelTextColor":"#1E1B2E","loopTextColor":"#857F9E","activationBkgColor":"#E7D5FE","activationBorderColor":"#9148D2","sequenceNumberColor":"#FFFFFF","transitionColor":"#AA69E9","transitionLabelColor":"#857F9E","stateLabelColor":"#1E1B2E","stateBkg":"#F2E9FE","compositeBackground":"#F9F5FF","compositeTitleBackground":"#F2E9FE","attributeBackgroundColorOdd":"#FFFFFF","attributeBackgroundColorEven":"#F9F5FF","relationColor":"#AA69E9","relationLabelBackground":"#F9F5FF","relationLabelColor":"#1E1B2E"}}}%%
flowchart LR
  subgraph TB6["TB-6 Staff browsers"]
    ST["Researcher or admin"]
  end
  subgraph VER["Vercel"]
    WEB["Console<br/>Next.js, server proxy"]
  end
  subgraph TB3["TB-3 Public internet"]
    PUB["Public /kiosk demo<br/>never uploads"]
  end
  subgraph TB4["TB-4 EC2 ap-south-1"]
    CAD["Caddy<br/>TLS, headers, body limits"]
    API["API<br/>RBAC + audit"]
    WK["Worker"]
    ENV[["api.env from SSM"]]
  end
  subgraph SBP["Supabase Mumbai, IP allow-list"]
    DB[("Research DB")]
  end
  subgraph TB5["TB-5 Identity vault"]
    VA[("shriii_identity<br/>own login")]
  end
  ST -->|"password, 8 h bearer token"| WEB
  WEB -->|"/api/v1 rewrite"| CAD
  CAD --> API
  ENV -.-> API
  API --> DB
  API --> VA
  WK --> DB
  classDef accent fill:#762CB1,stroke:#5F1C93,color:#FFFFFF
  classDef gold fill:#FAEECD,stroke:#CD9200,color:#1E1B2E
  class API accent
  class DB,VA gold
```

| Target | Pilot | Gap owner |
|---|---|---|
| Cognito with MFA | Staff password accounts (`AUTH_MODE=local`), lockout after five failures | PRV-08 (SF-08) |
| KMS-held keys | SSM SecureString (KMS `aws/ssm`), rendered to a root-only env file | PRV-07 (SF-07) |
| S3 raw batches and snapshots | Raw chunks in `kiosk_raw.batch_chunks`; snapshots under the worker's data directory | ING-06, ING-08 |
| Kiosk mTLS (step-ca) | No registered kiosks in production; only the simulator kiosk for smoke tests, revoked afterwards | PRV-07, KSK-10 |
| WAF and rate limits | Caddy body limits and timeouts | PRV-09 (SF-01, SF-14) |
| Private subnets | Database reachable only from the EC2 Elastic IP and the operator IP | PRV-07 |
