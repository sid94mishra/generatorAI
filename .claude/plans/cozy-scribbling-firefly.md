# AI Knowledge Base Application — Implementation Plan

## Context

Build a modern knowledge base application demonstrating the Claude Agent SDK. Users upload documents, code, and conversations; the system stores them with intelligent retrieval via a hybrid vector + graph architecture. A Claude-powered agent uses this knowledge base as its memory layer, capable of semantic search, relationship traversal, and learning from conversations.

---

## Research Conclusions

### Why Hybrid (Vector + Graph) over Pure RAG or Pure Graph

| Approach | Strengths | Weaknesses |
|----------|-----------|------------|
| **Pure RAG (vector only)** | Fast semantic search | Loses relationships between concepts |
| **Pure Graph** | Structured relationships | Poor at semantic similarity |
| **Hybrid (our choice)** | Both semantic search AND relationship traversal | Slightly more complex setup |

Evidence: Microsoft GraphRAG, LightRAG, and Mem0 all converge on hybrid approaches. Mem0 reports 26% higher accuracy with hybrid vs pure vector. For codebases specifically, AST relationships (graph) + semantic search (vector) is the proven pattern used by GitHub Copilot and Cursor.

### Why These Specific Technologies

- **pgvector** over Pinecone/Qdrant: Single database (PostgreSQL handles relational + vector), sub-100ms with HNSW, free, handles <10M vectors easily. No sync issues between separate DBs.
- **Neo4j** over Amazon Neptune: Best JS driver support, free Community Edition, fulltext + Cypher query flexibility, largest knowledge graph ecosystem.
- **Express** over Fastify/Hono: Claude Agent SDK examples all use Express. Battle-tested. The bottleneck is LLM latency, not server throughput.
- **SSE** over WebSocket: Claude Agent SDK's `query()` returns an async generator — natural fit for SSE. Simpler, works through proxies, auto-reconnects. Chat is request→stream, not bidirectional.
- **shadcn/ui**: 25+ purpose-built AI chat components, copy-paste customizable, built on Radix + Tailwind.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript + TailwindCSS v4 + shadcn/ui |
| Backend | Express + TypeScript + Node.js 20+ |
| AI Agent | `@anthropic-ai/claude-agent-sdk` (query API + custom MCP tools) |
| Vector DB | PostgreSQL 16 + pgvector (HNSW indexing) |
| Graph DB | Neo4j 5 Community Edition |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) — configurable |
| Entity Extraction | `@anthropic-ai/sdk` (Claude Sonnet for batch extraction) |
| Auth | JWT (bcrypt + jsonwebtoken) |
| State Mgmt | Zustand |
| Graph Viz | @xyflow/react (React Flow) |
| Infrastructure | Docker Compose (Postgres + Neo4j) |

---

## Directory Structure

```
ClaudeSDK/
├── package.json                    # npm workspaces root
├── tsconfig.base.json
├── docker-compose.yml              # PostgreSQL + pgvector, Neo4j
├── .env.example
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── types/
│   │           ├── document.ts     # Document, Chunk, Metadata types
│   │           ├── knowledge.ts    # Entity, Relationship types
│   │           ├── chat.ts         # Message, Conversation, StreamEvent
│   │           ├── user.ts         # User, Profile types
│   │           └── api.ts          # Request/Response envelopes
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # Express bootstrap
│   │       ├── config/
│   │       │   ├── env.ts          # Zod-validated env vars
│   │       │   └── database.ts
│   │       ├── db/
│   │       │   ├── postgres.ts     # pg Pool + pgvector
│   │       │   ├── neo4j.ts        # Neo4j driver
│   │       │   └── migrations/
│   │       │       ├── 001_users.sql
│   │       │       ├── 002_documents.sql
│   │       │       ├── 003_chunks_vectors.sql
│   │       │       ├── 004_conversations.sql
│   │       │       └── runner.ts
│   │       ├── middleware/
│   │       │   ├── auth.ts         # JWT verify
│   │       │   ├── upload.ts       # Multer config
│   │       │   └── errorHandler.ts
│   │       ├── routes/
│   │       │   ├── auth.routes.ts
│   │       │   ├── documents.routes.ts
│   │       │   ├── chat.routes.ts
│   │       │   ├── knowledge.routes.ts
│   │       │   └── user.routes.ts
│   │       ├── services/
│   │       │   ├── auth.service.ts
│   │       │   ├── document.service.ts
│   │       │   ├── vector.service.ts      # pgvector queries
│   │       │   ├── graph.service.ts       # Neo4j Cypher queries
│   │       │   ├── knowledge.service.ts   # Hybrid retrieval orchestrator
│   │       │   ├── chat.service.ts
│   │       │   └── user.service.ts
│   │       ├── agent/
│   │       │   ├── index.ts               # AgentManager (session mgmt)
│   │       │   ├── mcpServer.ts           # MCP server with 5 KB tools
│   │       │   └── tools/
│   │       │       ├── searchKnowledge.ts
│   │       │       ├── queryGraph.ts
│   │       │       ├── addKnowledge.ts
│   │       │       ├── getUserContext.ts
│   │       │       └── listDocuments.ts
│   │       ├── ingestion/
│   │       │   ├── pipeline.ts            # Orchestrator
│   │       │   ├── chunkers/
│   │       │   │   ├── semantic.ts        # For docs/markdown
│   │       │   │   ├── code.ts            # AST-aware (tree-sitter)
│   │       │   │   └── conversation.ts    # Turn-pair grouping
│   │       │   ├── extractors/
│   │       │   │   └── entity.ts          # Claude-powered extraction
│   │       │   └── embedders/
│   │       │       └── embed.ts           # OpenAI/Voyage embeddings
│   │       └── utils/
│   │           ├── logger.ts
│   │           └── sse.ts
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── routes.tsx
│           ├── lib/
│           │   ├── api.ts             # Fetch wrapper
│           │   └── sse.ts             # SSE client helper
│           ├── hooks/
│           │   ├── useChat.ts         # SSE streaming chat hook
│           │   ├── useDocuments.ts
│           │   ├── useKnowledgeGraph.ts
│           │   └── useAuth.ts
│           ├── stores/
│           │   └── authStore.ts       # Zustand
│           ├── components/
│           │   ├── ui/                # shadcn components
│           │   ├── chat/
│           │   │   ├── ChatPanel.tsx
│           │   │   ├── MessageBubble.tsx
│           │   │   ├── ChatInput.tsx
│           │   │   ├── ToolCallDisplay.tsx
│           │   │   └── StreamingText.tsx
│           │   ├── documents/
│           │   │   ├── DocumentUpload.tsx
│           │   │   ├── DocumentList.tsx
│           │   │   └── ProcessingStatus.tsx
│           │   ├── knowledge/
│           │   │   ├── GraphVisualization.tsx
│           │   │   ├── EntityCard.tsx
│           │   │   └── RelationshipEdge.tsx
│           │   └── layout/
│           │       ├── Sidebar.tsx
│           │       ├── Header.tsx
│           │       └── MainLayout.tsx
│           └── pages/
│               ├── LoginPage.tsx
│               ├── ChatPage.tsx
│               ├── DocumentsPage.tsx
│               ├── KnowledgePage.tsx
│               └── SettingsPage.tsx
```

---

## Database Schemas

### PostgreSQL (with pgvector)

**users**: id (UUID PK), email, password_hash, display_name, preferences (JSONB), created_at, updated_at

**documents**: id (UUID PK), user_id (FK→users), title, mime_type, file_path, file_size, content_hash (SHA-256 for dedup), metadata (JSONB), status (pending|processing|ready|error), created_at, updated_at

**document_chunks**: id (UUID PK), document_id (FK→documents CASCADE), chunk_index, content (TEXT), token_count, metadata (JSONB — start_line, end_line, heading, function_name), embedding (vector(1536)), created_at
  - HNSW index on embedding with `vector_cosine_ops`

**conversations**: id (UUID PK), user_id (FK→users), title, session_id (Claude Agent SDK session), created_at, updated_at

**messages**: id (UUID PK), conversation_id (FK→conversations CASCADE), role, content, tool_calls (JSONB), metadata (JSONB), created_at

### Neo4j

**Node labels**: Entity, Document, User, Concept, CodeSymbol
**Properties**: id, name, type, description, source_document_id, userId, created_at, updated_at
**Relationship types**: RELATES_TO, DEFINED_IN, IMPORTS, CALLS, MENTIONS, PART_OF, DEPENDS_ON
**Indexes**: unique on Entity.id, composite on (name, type), fulltext on [name, description]

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get JWT |
| GET | `/api/documents` | List user documents |
| POST | `/api/documents/upload` | Upload + trigger ingestion |
| GET | `/api/documents/:id` | Document details + chunks |
| DELETE | `/api/documents/:id` | Delete doc + chunks + graph nodes |
| GET | `/api/documents/:id/status` | Ingestion status polling |
| POST | `/api/chat` | Chat with agent (SSE stream) |
| GET | `/api/chat/conversations` | List conversations |
| GET | `/api/chat/conversations/:id` | Get messages |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| GET | `/api/knowledge/graph` | Graph nodes + edges (paginated) |
| GET | `/api/knowledge/search` | Hybrid search |
| GET | `/api/knowledge/entities/:id` | Entity + neighbors |
| GET | `/api/user/profile` | Get profile |
| PUT | `/api/user/profile` | Update profile |

---

## Core Architecture: Hybrid Retrieval

The `KnowledgeService` orchestrates both retrieval layers:

1. **Embed query** → generate vector from user question
2. **Parallel search** → run pgvector cosine similarity + Neo4j fulltext/traversal simultaneously
3. **Graph enrichment** → for each vector hit, fetch connected entities from Neo4j (1-2 hops)
4. **Re-rank** → combine vector similarity score + graph centrality for final ranking
5. **Return** → ranked chunks with entity context to the Claude agent

---

## Claude Agent SDK Integration

### Custom MCP Tools (exposed to the agent)

| Tool | Purpose |
|------|---------|
| `search_knowledge` | Hybrid vector+graph search, returns relevant chunks with context |
| `query_graph` | Traverse knowledge graph from a specific entity |
| `add_knowledge` | Store new knowledge from conversation into graph + vectors |
| `get_user_context` | Retrieve user profile and preferences |
| `list_documents` | List documents with optional filtering |

### Agent Flow
1. User sends message → POST `/api/chat` (SSE)
2. Backend creates per-request MCP server scoped to user ID
3. `query()` from Agent SDK streams responses
4. Agent autonomously decides which KB tools to call
5. Tool results feed back into agent reasoning
6. Text + tool events stream to frontend via SSE

---

## Document Ingestion Pipeline

```
Upload → Extract Text → Chunk → Embed → Store Vectors → Extract Entities → Store Graph
```

- **Markdown/Text**: Semantic chunking (512 tokens, 50 overlap, heading-aware)
- **Code files**: AST-aware chunking via tree-sitter (function/class boundaries)
- **Conversations**: Turn-pair grouping with surrounding context
- **Entity extraction**: Claude Sonnet batch processing (5 chunks per call)

---

## Implementation Sequence

### Step 1: Project Scaffolding
- Initialize npm workspaces monorepo
- Configure TypeScript (base + per-package)
- Set up Docker Compose (Postgres+pgvector, Neo4j)
- Create `.env.example` and env validation
- Install all dependencies

### Step 2: Shared Types
- Define all TypeScript interfaces in `packages/shared`

### Step 3: Database Layer
- Write SQL migrations
- Implement migration runner
- Create postgres.ts (pg Pool + pgvector)
- Create neo4j.ts (driver + constraint init)

### Step 4: Backend Foundation
- Express app with CORS, JSON parsing
- Error handler middleware
- Auth routes + JWT middleware
- User routes + service

### Step 5: Document Management
- Multer upload middleware
- Document CRUD service + routes
- File storage to local `uploads/` directory

### Step 6: Ingestion Pipeline
- Semantic chunker
- Code chunker (tree-sitter)
- Conversation chunker
- Embedding generation (OpenAI API)
- Vector storage in pgvector
- Entity extraction via Claude API
- Graph storage in Neo4j
- Pipeline orchestrator wiring it all together

### Step 7: Knowledge Services
- VectorService (pgvector search)
- GraphService (Neo4j Cypher queries)
- KnowledgeService (hybrid search orchestrator)
- Knowledge API routes

### Step 8: Claude Agent SDK Integration
- MCP server with 5 KB tools
- AgentManager with session management
- SSE streaming chat route
- Chat service for conversation persistence

### Step 9: Frontend Foundation
- Vite + React + Router + Tailwind + shadcn init
- Layout components (Sidebar, Header, MainLayout)
- Auth store (Zustand) + Login page
- API client with auth interceptor

### Step 10: Frontend — Documents
- DocumentUpload (drag-and-drop)
- DocumentList with status badges
- ProcessingStatus component
- useDocuments hook

### Step 11: Frontend — Chat
- useChat hook (SSE streaming)
- ChatPanel, MessageBubble, ChatInput
- ToolCallDisplay (shows when agent uses KB tools)
- StreamingText (typewriter effect)
- Conversation list sidebar

### Step 12: Frontend — Knowledge Graph
- GraphVisualization (React Flow)
- EntityCard, RelationshipEdge
- useKnowledgeGraph hook
- Search + filter controls

### Step 13: Polish & Settings
- User settings page
- Loading states, empty states, error boundaries
- Responsive layout adjustments

---

## Verification Plan

1. **Docker up**: `docker compose up -d` → Postgres and Neo4j running
2. **Backend start**: `npm run dev -w backend` → Server on :3001, migrations run
3. **Register + Login**: POST to `/api/auth/register` then `/api/auth/login` → JWT returned
4. **Upload document**: POST markdown file to `/api/documents/upload` → status goes pending→processing→ready
5. **Check vectors**: Query pgvector to confirm chunks stored with embeddings
6. **Check graph**: Open Neo4j browser (localhost:7474) → entities and relationships visible
7. **Chat test**: POST to `/api/chat` with a question about the uploaded document → agent calls `search_knowledge`, returns relevant answer with citations
8. **Frontend**: `npm run dev -w frontend` → Login, upload doc, chat about it, view knowledge graph
9. **Graph growth**: Chat with agent, ask it to remember something → `add_knowledge` tool fires, new nodes appear in graph
