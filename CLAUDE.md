# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a real-time encrypted chat application with temporary group chats for events. The system consists of:
- **Expo (React Native)**: Mobile client with end-to-end encryption
- **Go (Gin)**: HTTP server with WebSocket support
- **PostgreSQL**: Primary database with sqlc for type-safe queries
- **Redis**: Pub/Sub for multi-instance coordination
- **AWS S3**: Image storage with pre-signed URLs

## Development Commands

### Full Stack Development

```bash
# Start entire stack (Caddy, Postgres, Redis, Go server)
make dev-up

# Stop services
make dev-down

# View Go server logs (live tail)
docker compose logs -f go-server
```

**Important: Auto-rebuild with Air**
- The Go server runs in Docker with [Air](https://github.com/cosmtrek/air) for hot reloading
- Code changes are automatically detected and the server rebuilds
- **DO NOT** run `go build .` manually to verify changes
- **Instead**, check `docker compose logs -f go-server` to verify the rebuild succeeded
- Look for compilation errors or successful startup messages in the logs

### Database Operations

```bash
# Apply database migrations
make migrate-up

# Generate sqlc code after modifying queries
make sqlc-gen
```

**Creating a new migration:**
```bash
migrate create -ext sql -dir db/migrations -seq <name_of_migration>
```

**Direct database access:**
```bash
docker exec -it chat-app-db-1 bash
psql -U postgres
\c postgres
```

### Expo (Client) Development

```bash
# Start Expo dev server
make expo-start
# or: cd expo && npx expo start

# Run linter
make expo-lint

# iOS development build
make expo-ios-dev

# iOS release build
make expo-ios-release
```

**EAS device build:**
```bash
cd expo
eas build -p ios --profile development
```

### AWS Authentication

```bash
aws sso login --profile s3-local-637423634719
```

## Architecture

### System Overview

```
Expo Client (React Native)
    ↕ WebSocket (Encrypted) + HTTP (JWT Auth)
Go Server (Gin)
    ↕
PostgreSQL + Redis + S3
```

**Key Characteristics:**
- **End-to-End Encrypted**: Messages encrypted with libsodium (Curve25519 + XSalsa20-Poly1305)
- **Real-time**: WebSocket-based delivery with Redis Pub/Sub for horizontal scaling
- **Device-based Encryption**: Each device has its own keypair; messages encrypted with symmetric keys sealed to each recipient device

### Go Server Structure

```
server/
├── main.go              # Server initialization
├── router/router.go     # Route registration
├── auth/                # JWT authentication & middleware
│   ├── handler.go       # Signup/Login endpoints
│   ├── token.go         # JWT validation
│   ├── auth.go          # JWT middleware
│   └── types.go         # Request/response types
├── ws/                  # WebSocket real-time communication
│   ├── handler.go       # WS upgrade & group management
│   ├── hub.go           # Central message dispatcher
│   ├── client.go        # Per-client WS handling
│   └── types.go         # Message structures
├── server/              # REST API endpoints
│   ├── api.go           # API struct
│   ├── users_api.go     # User endpoints
│   └── groups_api.go    # Group endpoints
├── db/                  # Generated sqlc code (DO NOT EDIT)
│   ├── db.go            # DBTX interface
│   ├── models.go        # Database models (generated)
│   └── *_queries.sql.go # Query functions (generated)
├── images/handler.go    # S3 pre-signed URLs
├── s3store/store.go     # AWS S3 client
└── util/util.go         # Helpers
```

**Protected Files (Never Edit):**
- `server/db/*_queries.sql.go` (sqlc generated)
- `server/db/models.go` (sqlc generated)
- `server/go.sum` (dependency lock)
- `expo/package-lock.json` (dependency lock)
- `expo/android/**` (Expo prebuild output)
- `expo/ios/**` (Expo prebuild output)

### Expo Client Structure

```
expo/
├── app/                     # Expo Router (file-based routing)
│   ├── _layout.tsx          # Root provider setup
│   ├── (auth)/              # Auth screens
│   └── (app)/               # Main app screens
├── components/
│   ├── context/             # React Context providers
│   │   ├── GlobalStoreContext.tsx     # User, device, device keys
│   │   ├── WebSocketContext.tsx       # WS connection & HTTP API
│   │   ├── MessageStoreContext.tsx    # Message state & optimistic updates
│   │   └── AuthUtilsContext.tsx       # Auth utilities
│   ├── ChatBox/             # Message UI components
│   ├── ChatSelect/          # Group selection UI
│   └── ChatSettings/        # Group settings UI
├── store/
│   ├── Store.ts             # SQLite wrapper (expo-sqlite)
│   └── types.ts             # IStore interface
├── hooks/
│   ├── useSendMessage.ts    # Message encryption & sending
│   ├── useSendImage.ts      # Image upload
│   └── useCachedImage.ts    # Image caching
├── services/
│   ├── encryptionService.ts # Libsodium encryption/decryption
│   ├── deviceService.ts     # Device key management
│   └── imageService.ts      # Image operations
└── types/types.ts           # TypeScript type definitions
```

### WebSocket Communication

**Connection Flow:**
1. Client connects to `/ws/establish-connection`
2. First message must be `{ type: "auth", token: <JWT> }` (10s timeout)
3. Server responds with `{ type: "auth_success" }`
4. Client registered in Hub and Redis

**Message Format (E2E Encrypted):**
```json
{
  "id": "uuid",
  "group_id": "uuid",
  "messageType": "text",
  "msgNonce": "base64(nonce)",
  "ciphertext": "base64(encrypted_plaintext)",
  "envelopes": [
    {
      "deviceId": "device_1",
      "ephPubKey": "base64(ephemeral_public_key)",
      "keyNonce": "base64(sym_key_nonce)",
      "sealedKey": "base64(sealed_symmetric_key)"
    }
  ]
}
```

**Hub Event Channels:**
- `Register`: Client connects
- `Unregister`: Client disconnects
- `Broadcast`: New message (saves to DB, publishes to Redis, delivers to clients)
- `AddUserToGroupChan`: User invited to group
- `RemoveUserFromGroupChan`: User removed from group
- `InitializeGroupChan`: Group created
- `DeleteHubGroupChan`: Group deleted
- `UpdateGroupInfoChan`: Group info updated

**Redis Keys (for multi-instance coordination):**
```
client:{userID}:server_id = {server_instance_id}  [TTL 120s]
server:{serverID}:clients = Set of userIDs
user:{userID}:groups = Set of groupIDs
group:{groupID}:members = Set of userIDs
groupinfo:{groupID} = Hash{id, name}
```

**Redis Pub/Sub Channels:**
- `group_events`: User/group lifecycle events
- `group_messages:{groupID}`: Messages for specific group

### Authentication & JWT

**Signup Flow:**
1. Client generates Curve25519 keypair (libsodium)
2. POST `/auth/signup` with `{ username, email, password, deviceIdentifier, publicKey }`
3. Server hashes password (bcrypt cost 12), inserts user, registers device key
4. Server returns JWT (HS256, 24hr expiry)
5. Client stores JWT in AsyncStorage, private key encrypted locally

**Login Flow:**
1. Client retrieves stored private key
2. POST `/auth/login` with `{ email, password, deviceIdentifier, publicKey }`
3. Server validates password, updates device key
4. Server returns JWT
5. Client updates state

**Authorization:**
- REST API: `Authorization: Bearer {token}` header → `JWTAuthMiddleware`
- WebSocket: First message `{ type: "auth", token: "{token}" }`
- Token validation: HS256 HMAC using `JWT_SECRET` env var

### Database Access (sqlc)

**Query Pattern:**
- Write SQL queries in `db/queries/*.sql`
- Run `make sqlc-gen` to generate Go code
- Use generated `db.Queries` methods

**Transaction Pattern:**
```go
tx, err := conn.Begin(ctx)
defer tx.Rollback(ctx)
qtx := queries.WithTx(tx)
// Execute operations via qtx
tx.Commit(ctx)
```

**Common Queries:**
- `GetUserById`, `GetUserByEmail`, `InsertUser`
- `GetGroupById`, `InsertGroup`, `UpdateGroup`
- `InsertUserGroup`, `DeleteUserGroup`
- `InsertMessage`, `GetRelevantMessages`
- `RegisterDeviceKey`, `GetRelevantDeviceKeys`

### Image Upload/Download

**Architecture:** AWS S3 with pre-signed URLs (direct client ↔ S3, not proxied through server)

**Upload:**
1. POST `/images/presign-upload` with `{ filename, groupId, size, forCreate }`
2. Server validates: group exists/reserved, user authorized, size ≤ 5MB, extension whitelisted (.jpg, .png, .gif, .webp)
3. Server generates S3 key: `groups/{groupID}/{userID}/{uuid}.ext`
4. Server returns pre-signed PUT URL (15min-1hr expiry)
5. Client PUT directly to S3

**Download:**
1. POST `/images/presign-download` with `{ objectKey }`
2. Server validates user in group or has reservation
3. Server returns pre-signed GET URL (15min expiry)
4. Client GET directly from S3

**Two Upload Scenarios:**
- `forCreate=false`: Uploading to existing group (must be member)
- `forCreate=true`: Pre-uploading avatar for group creation (must have reservation)

### Client State Management

**Persisted State:**
- **AsyncStorage**: JWT, userId, username, deviceId, keypair
- **SQLite**: users, groups, messages (encrypted), group admin mappings

**Runtime State (React Context):**

1. **GlobalStoreContext** (Reducer):
   - `user`: Current authenticated user
   - `deviceId`: Device identifier
   - `store`: SQLite Store instance
   - `relevantDeviceKeys`: Map of userId → device public keys

2. **WebSocketContext** (Refs + State):
   - `socketRef`: Active WebSocket connection
   - `connected`: Boolean status
   - `messageHandlers`: Callback arrays for incoming messages
   - Auto-reconnect with exponential backoff (max 5 retries, 1s-30s)

3. **MessageStoreContext** (Reducer):
   - `messages`: Record<groupId, DbMessage[]> (decrypted)
   - `optimistic`: Record<groupId, OptimisticMessageItem[]> (pending sends)
   - `clientSeq`: Sequence number for optimistic ordering

**Optimistic Updates:**
- When sending message, add to `optimistic[groupId]` immediately
- Display in UI with "sending" indicator
- Remove from optimistic when server confirms (ID match)

**Encryption Concurrency:**
- `ConcurrencyLimiter` prevents libsodium overload
- Text decryption: 5 concurrent
- Image decryption: 3 concurrent
- Encryption: 3 concurrent

## Common Workflows

### Adding a REST Endpoint

1. Add SQL query in `db/queries/*.sql`
2. Run `make sqlc-gen`
3. Implement handler in `server/server/*.go` or `server/ws/*.go`
4. Register route in `server/router/router.go`
5. Add JWT middleware if authenticated
6. Add corresponding client call in `WebSocketContext.tsx`
7. Run `make dev-up` and verify via logs

### Adding a WebSocket Message Type

1. Define message type in `server/ws/types.go`
2. Update `MessageType` enum in `expo/types/types.ts`
3. Implement handler in `server/ws/handler.go` or hub flow
4. Update client message handling in `MessageStoreContext.tsx`
5. Update encryption service if special handling needed
6. Test with `make dev-up` + `make expo-start`

### Adding a Database Migration

1. Create migration: `migrate create -ext sql -dir db/migrations -seq <name>`
2. Write `.up.sql` and `.down.sql` files
3. Run `make migrate-up`
4. If new queries needed, add to `db/queries/*.sql`
5. Run `make sqlc-gen`

### Adding an Image Feature

1. Use `server/images/handler.go` presign endpoints
2. Use `expo/services/imageService.ts` and hooks for upload/download
3. Ensure size/extension constraints match server validation
4. Handle encryption if needed (image messages are stored encrypted)

## Code Style & Conventions

**Go:**
- Gin handlers with early returns
- Structured errors
- DB access via `db.Queries` only
- Keep nesting shallow
- Never log secrets (JWT_SECRET, DB_URL, REDIS_URL, S3_BUCKET)

**TypeScript/React Native:**
- Use contexts in `expo/components/context/*`
- Persistence in `expo/store/*`
- Type external APIs strongly
- Prefer `services/*` for network and encryption
- File-based routing with Expo Router

**Security:**
- All `/api`, `/ws` (except initial upgrade), and `/images` routes require JWT
- Never hardcode or log secrets
- Validate group membership before operations
- Use bcrypt cost 12 for passwords
- Pre-signed URLs have short expiry (15min-1hr)

## Environment Variables

**Root `.env` (server):**
```
DB_USER=postgres
DB_PASSWORD=postgres
DB_URL=postgres://postgres:postgres@db:5432/postgres
JWT_SECRET=<from https://jwtsecret.com/generate>
```

**`expo/.env` (client):**
```
NODE_ENV=development
EXPO_PUBLIC_HOST=<IP_ADDR>:8080
```

Get IP address: Run `npx expo start` in `expo/`, look for `Metro waiting on exp://<IP_ADDR>:8081`. Use port 8080 in `.env` (not 8081).

## Testing & Validation

**Client:**
- Lint: `make expo-lint`

**Server:**
- Check service health: `make dev-up` and watch `make logs-go`

**End-to-end:**
1. `make dev-up` (starts server stack)
2. `make expo-start` (starts client)
3. Verify WebSocket connection in logs
4. Test message encryption/decryption
