# COBOL Knowledge Base System -- Implementation Plan

## Context

The goal is to build a **comprehensive knowledge base for all COBOL source programs** that enables: full call-chain control flow tracing, migration analysis, paragraph-level summaries, business rule extraction, data flow tracking, and inter-program dependency mapping. 

The existing codebase is a full-stack TypeScript/Node.js app (Express + React + Claude Agent SDK) with PostgreSQL (pgvector) and Neo4j. It currently has a generic document ingestion pipeline that chunks AST JSON files for vector search and extracts basic entities (program, paragraph, division) into Neo4j using a flat `Entity` label. 

**The problem**: The current system treats COBOL ASTs as generic documents -- it doesn't leverage the rich structural data in ControlFlow, DecisionTree, or CallChain files, and the Neo4j graph is too shallow (generic entity/relationship types) to support structural queries like call-chain traversal, data flow analysis, or business rule extraction.

**Research finding (critical)**: AST-derived graph construction is 10x cheaper and more accurate than LLM-extracted graphs (arxiv 2601.08773: 43/45 correct vs 38/45). Since we already have deterministic AST JSON, we should build the graph deterministically and only use LLMs for semantic enrichment (summaries, business rule descriptions).

---

## Phase 1: COBOL Type System Extension
**Goal**: Add COBOL-specific types without breaking existing generic types.

### New file: `packages/shared/src/types/cobol-graph.ts`

```
CobolEntityType:
  // Program structure
  'PROGRAM' | 'PARAGRAPH' | 'SECTION' | 'DIVISION' | 'VARIABLE' | 
  'COPYBOOK' | 'DECISION' | 'BUSINESS_RULE' | 'EXTERNAL_PROGRAM' |
  // CICS constructs
  'CICS_COMMAND' | 'CICS_MAP' | 'CICS_MAPSET' | 'CICS_HANDLER' |
  'TRANSACTION' | 'COMMAREA' | 'CHANNEL' | 'CONTAINER' |
  // Data resources
  'VSAM_FILE' | 'DB2_TABLE' | 'DB2_CURSOR' | 'DB2_COLUMN' |
  'TS_QUEUE' | 'TD_QUEUE' |
  // EIB & system
  'EIB_FIELD' | 'RESOURCE_LOCK' | 'MEMORY_BLOCK'

CobolRelationshipType:
  // Structural containment
  'CONTAINS' | 'DEFINED_IN' | 'COPIES' |
  // Paragraph flow
  'CALLS_PARAGRAPH' | 'PERFORMS' | 'GO_TO' | 'FALLS_THROUGH' |
  'BRANCHES_TRUE' | 'BRANCHES_FALSE' | 'NEXT_IN_ORDER' |
  // Program transfer
  'XCTL_TO' | 'LINK_TO' | 'RETURN_TRANSID' | 'PASSES_COMMAREA' |
  'PASSES_CHANNEL' | 'PUTS_CONTAINER' | 'GETS_CONTAINER' |
  // Screen I/O
  'SENDS_MAP' | 'RECEIVES_MAP' |
  // VSAM file operations
  'READS_FILE' | 'WRITES_FILE' | 'REWRITES_FILE' | 'DELETES_FROM_FILE' |
  'BROWSES_FILE' | 'UNLOCKS_FILE' |
  // DB2 operations
  'QUERIES_TABLE' | 'INSERTS_INTO_TABLE' | 'UPDATES_TABLE' | 'DELETES_FROM_TABLE' |
  'USES_CURSOR' | 'CURSOR_READS' |
  // TS/TD queue operations
  'WRITES_TS_QUEUE' | 'READS_TS_QUEUE' | 'DELETES_TS_QUEUE' |
  'WRITES_TD_QUEUE' | 'READS_TD_QUEUE' | 'DELETES_TD_QUEUE' |
  // Storage & resource management
  'ACQUIRES_STORAGE' | 'FREES_STORAGE' | 'ENQUEUES_ON' | 'DEQUEUES_FROM' |
  'LOADS_PROGRAM' | 'RELEASES_PROGRAM' |
  // Variable access
  'READS_VAR' | 'MODIFIES_VAR' |
  // EIB & handlers
  'CHECKS_EIB' | 'HANDLES_CONDITION' | 'HANDLES_AID' |
  // Exit & decisions
  'EXIT_VIA' | 'HAS_DECISION' | 'IMPLEMENTS_RULE' |
  // Time operations
  'ASKS_TIME' | 'FORMATS_TIME'
```

Interfaces:
- `CobolProgram`, `CobolParagraph`, `CobolVariable`, `CobolCopybook`
- `CobolControlFlowNode`, `CobolControlFlowEdge`, `CobolDecisionTreeNode`
- `CobolCallChainLink`, `CobolCallChainManifest`
- `CobolVsamFile` -- name, type (KSDS/ESDS/RRDS), recordArea, keyField
- `CobolDB2Table` -- name, schema, dclgenName
- `CobolDB2Cursor` -- name, query, hostVariables
- `CobolTSQueue` -- namePattern, storageType (MAIN/AUXILIARY)
- `CobolTDQueue` -- name, type (intra/extra), triggerLevel
- `CobolEibField` -- name, picClause, usage (routing/errorHandling/audit/dataLength)
- `CobolChannel` -- name
- `CobolContainer` -- name, channelName, dataType
- `CobolResourceLock` -- resourceName, length

### Modify: `packages/shared/src/types/knowledge.ts`
- Extend `EntityType` and `RelationshipType` unions with COBOL types
- Add optional `cobolMetadata?: Record<string, unknown>` to `GraphNode`

### Modify: `packages/shared/src/index.ts`
- Export new cobol-graph types

---

## Phase 2: Neo4j Schema Extension
**Goal**: Create COBOL-specific node labels, indexes, and constraints.

### Modify: `packages/backend/src/db/neo4j.ts`

Add to `initNeo4j()` -- separate labels from generic `Entity`:

**Program Structure Nodes:**

| Label | Key Properties | Unique Constraint |
|-------|---------------|-------------------|
| `:CobolProgram` | programId, category, sourceLines, nodeCount, entryParagraph, cicsCommands | programId |
| `:CobolParagraph` | name, programId, line, executionOrder, summary | (name, programId) |
| `:CobolVariable` | id, name, level, variableType, scope, picClause, effectiveDataType | id |
| `:CobolCopybook` | name, uri | name |
| `:CobolDecision` | id, condition, decisionType, line, paragraphName | id |
| `:CobolHandler` | type, condition, targetParagraph | (generated id) |
| `:CobolBusinessRule` | id, description, conditions, actions, paragraphs, confidence | id |

**CICS Resource Nodes:**

| Label | Key Properties | Unique Constraint |
|-------|---------------|-------------------|
| `:CobolCicsCommand` | id, command, commandCategory, params (JSON), rawText, line | id |
| `:CobolTransaction` | transactionId | transactionId |
| `:CobolMap` | name, mapsetName | (name, mapsetName) |
| `:CobolCommarea` | name, length, copybookRef | name |
| `:CobolChannel` | name | name |
| `:CobolContainer` | name, channelName, dataType | (name, channelName) |

**Data Resource Nodes:**

| Label | Key Properties | Unique Constraint |
|-------|---------------|-------------------|
| `:CobolVsamFile` | name, recordArea, keyField, accessTypes[] | name |
| `:CobolDB2Table` | name, schema, dclgenName | name |
| `:CobolDB2Cursor` | name, programId, query, hostVariables[] | (name, programId) |
| `:CobolTSQueue` | namePattern, storageType (MAIN/AUXILIARY), programId | namePattern |
| `:CobolTDQueue` | name, queueType (intra/extra) | name |
| `:CobolEibField` | name, description, usageCategory | name |
| `:CobolResourceLock` | resourceName | resourceName |

**Indexes:** `CobolProgram.category`, `CobolParagraph.programId`, `CobolVariable.scope`, `CobolVariable.effectiveDataType`, `CobolVsamFile.name`, `CobolCicsCommand.command`, `CobolCicsCommand.commandCategory`, `CobolEibField.name`

**Note on commandCategory values** (from AST data): `DATA_IO`, `QUEUE_IO`, `SCREEN_IO`, `PROGRAM_CONTROL`, `ERROR_HANDLING`, `RESOURCE_MGMT`, `TIME`

---

## Phase 3: COBOL Graph ETL Pipeline (Core Work)
**Goal**: Dedicated loaders for each AST file type, writing directly to Neo4j with COBOL labels.

### New file: `packages/backend/src/ingestion/cobol/pipeline.ts`
Orchestrator that:
1. Accepts directory or file set
2. Detects file type by naming convention (`_callchain_manifest`, `.final.AST.`, `_control_flow`, `_decision_tree`)
3. Processes in dependency order: CallChain -> FinalAST -> ControlFlow -> DecisionTree

### New file: `packages/backend/src/ingestion/cobol/loaders/callchain.loader.ts`
Parses `MV7186_callchain_manifest.json`:
- MERGE `:CobolProgram` per program (63 programs in our test data)
- Create `[:XCTL_TO]`, `[:LINK_TO]`, `[:RETURN_TRANSID]` edges from `links` array
- MERGE `:CobolTransaction` for RETURN TRANSID targets
- Store `unresolvedReferences` on entry program
- Use `UNWIND` batching for performance

### New file: `packages/backend/src/ingestion/cobol/loaders/finalast.loader.ts`
Parses `MV7187.final.AST.json`:

- **Variables** from `definitions.variables`: MERGE `:CobolVariable` nodes, `[:DEFINED_IN]` to program, `[:CONTAINS]` for GROUP_ITEM parent-child, `[:READS_VAR]`/`[:MODIFIES_VAR]` by cross-referencing `usages` with MOVE/COMPUTE statements
- **Paragraphs** from `definitions.paragraphs`: MERGE `:CobolParagraph`, `[:CONTAINS]` from program, set `executionOrder`
- **Copybooks** from `definitions.copybooks`: MERGE `:CobolCopybook`, `[:COPIES]` from program
- **Vector chunks**: One chunk per paragraph text for semantic search in PG

- **CICS commands** from AST tree walk (key: walk STATEMENT nodes where `dialect === 'cics'`):

  **Screen I/O** (226 SEND MAP + 134 RECEIVE MAP in our data):
  - SEND MAP -> MERGE `:CobolMap` + `:CobolCicsCommand`, create `[:SENDS_MAP]` from paragraph to map
  - RECEIVE MAP -> MERGE `:CobolMap`, create `[:RECEIVES_MAP]` from paragraph to map
  - Extract `map` and `mapset` from `cicsParams`

  **VSAM File Operations** (READ:40, WRITE:30, REWRITE:7, DELETE:2, STARTBR:18, READNEXT:17, READPREV:1, ENDBR:14, UNLOCK:1):
  - READ -> MERGE `:CobolVsamFile {name: cicsParams.dataset}`, create `[:READS_FILE {accessType: 'random', withUpdate: hasUPDATE}]` from paragraph to file
  - WRITE -> MERGE `:CobolVsamFile`, create `[:WRITES_FILE]` from paragraph, track `cicsParams.from` (source record area)
  - REWRITE -> create `[:REWRITES_FILE]` (must follow READ UPDATE)
  - DELETE -> create `[:DELETES_FROM_FILE {generic: hasGENERIC}]`
  - STARTBR/READNEXT/READPREV/ENDBR -> create `[:BROWSES_FILE {direction: NEXT|PREV}]`
  - UNLOCK -> create `[:UNLOCKS_FILE]`
  - **Datasets found in AST data**: MVCOCOR, MVCHCOR, MVCHCNX, MVOPHST
  - Store `ridfld` (key field) and `into`/`from` (record area) as edge properties

  **TS Queue Operations** (WRITEQ:1, READQ:1, DELETEQ:1):
  - WRITEQ TS -> MERGE `:CobolTSQueue {namePattern: cicsParams.queue}`, create `[:WRITES_TS_QUEUE {item, rewrite, storageType}]`
  - READQ TS -> create `[:READS_TS_QUEUE {item, next}]`
  - DELETEQ TS -> create `[:DELETES_TS_QUEUE]`
  - **Queue found in AST data**: MX30TSQ-KEY
  - Parse from `cicsRawText` since `cicsParams` may be empty for queue commands

  **TD Queue Operations** (not found in current data but must support):
  - WRITEQ TD -> MERGE `:CobolTDQueue`, create `[:WRITES_TD_QUEUE]`
  - READQ TD -> create `[:READS_TD_QUEUE]` (destructive read)
  - DELETEQ TD -> create `[:DELETES_TD_QUEUE]`

  **Storage Management** (GETMAIN:37, LOAD:11, RELEASE:10):
  - GETMAIN -> create `[:ACQUIRES_STORAGE {set, length, shared, initimg}]` from paragraph
  - FREEMAIN -> create `[:FREES_STORAGE]`
  - LOAD -> create `[:LOADS_PROGRAM {program}]`
  - RELEASE -> create `[:RELEASES_PROGRAM]`

  **Resource Locking** (ENQ/DEQ -- support even if not in current data):
  - ENQ -> MERGE `:CobolResourceLock`, create `[:ENQUEUES_ON {nosuspend}]`
  - DEQ -> create `[:DEQUEUES_FROM]`

  **Time Operations** (ASKTIME:1, FORMATTIME:1):
  - ASKTIME -> create `:CobolCicsCommand {command: 'ASKTIME', abstime}`, `[:ASKS_TIME]`
  - FORMATTIME -> create `[:FORMATS_TIME {format, datesep, timesep}]`

  **Channel/Container** (support for modern CICS, even if not in current data):
  - PUT CONTAINER -> MERGE `:CobolChannel` + `:CobolContainer`, `[:PUTS_CONTAINER]`
  - GET CONTAINER -> `[:GETS_CONTAINER]`
  - LINK with CHANNEL -> `[:PASSES_CHANNEL]` instead of `[:PASSES_COMMAREA]`

  **Program Control** (XCTL:129, RETURN:122, LINK:9):
  - Already handled by callchain loader at program level
  - FinalAST loader adds **paragraph-level granularity**: which paragraph makes the call
  - Extract COMMAREA details: `[:PASSES_COMMAREA {commareaVar, length}]`

  **Error Handling** (HANDLE CONDITION:102, HANDLE AID:27):
  - Already handled by controlflow loader
  - FinalAST loader extracts the specific conditions: NOTFND, PGMIDERR, MAPFAIL, DUPREC, etc.

- **EIB Field References** -- Walk all VARIABLE_USAGE nodes referencing EIB fields:
  - MERGE `:CobolEibField {name: 'EIBCALEN', usageCategory: 'dataLength'}`
  - Create `[:CHECKS_EIB {purpose}]` from paragraph to EIB field
  - Classify usage by context:
    - `EIBCALEN` in IF condition -> purpose: 'firstTimeCheck' (pseudo-conversational pattern)
    - `EIBAID` compared to DFHENTER/DFHPF*/DFHCLEAR -> purpose: 'keyRouting'
    - `EIBRESP/EIBRESP2` after CICS command -> purpose: 'errorHandling'
    - `EIBTRNID` -> purpose: 'transactionRouting'
    - `EIBTIME/EIBDATE` -> purpose: 'timestamp'
    - `EIBTRMID` -> purpose: 'terminalIdentification'
    - `EIBDS/EIBRSRCE` -> purpose: 'resourceIdentification'

- **DB2 Operations** (EXEC SQL -- support even if not in current AST data):
  - Walk STATEMENT nodes where `dialect === 'sql'`
  - SELECT -> MERGE `:CobolDB2Table`, create `[:QUERIES_TABLE {columns, whereClause}]`
  - INSERT -> create `[:INSERTS_INTO_TABLE {columns}]`
  - UPDATE -> create `[:UPDATES_TABLE {setColumns, whereClause}]`
  - DELETE -> create `[:DELETES_FROM_TABLE {whereClause}]`
  - DECLARE CURSOR -> MERGE `:CobolDB2Cursor {name, query, hostVariables}`
  - OPEN/FETCH/CLOSE CURSOR -> create `[:USES_CURSOR {operation}]`
  - Track SQLCODE checks in subsequent IF statements as implicit error handling

### New file: `packages/backend/src/ingestion/cobol/loaders/controlflow.loader.ts`
Parses `MV7187_control_flow.json`:
- Match nodes to existing `:CobolParagraph` and `:CobolProgram`
- MERGE `:CobolDecision` nodes from decision-type nodes
- Create edges: `[:FALLS_THROUGH]`, `[:GO_TO]`, `[:BRANCHES_TRUE]`, `[:BRANCHES_FALSE]`, `[:EXIT_VIA]`, `[:HAS_DECISION]`, `[:XCTL_TO]`/`[:LINK_TO]` at paragraph level
- Create `[:HANDLES_CONDITION]`/`[:HANDLES_AID]` from `activeHandlers`
- Create `[:NEXT_IN_ORDER]` chain from `paragraphOrder`

### New file: `packages/backend/src/ingestion/cobol/loaders/decisiontree.loader.ts`
Parses `MV7187_decision_tree.json` (optional, configurable -- creates many nodes):
- Statement-level nodes: `:CobolStatement`, `:CobolCicsCommand`
- `[:NEXT_STATEMENT]` edges within paragraphs
- Enriches decision nodes with branch details
- Enriches inter-program edges with `cicsParams` (commarea, length)

---

## Phase 4: COBOL Graph Query Service
**Goal**: Cypher queries for each downstream use case.

### New file: `packages/backend/src/services/cobol-graph.service.ts`

| Method | Use Case | Cypher Pattern |
|--------|----------|---------------|
| `getFullCallChain(entryId, maxDepth)` | UC1: Entry-to-end control flow | Variable-length path `(entry)-[:XCTL_TO\|LINK_TO*1..N]->(target)` |
| `getProgramAnalysis(programId)` | UC2: Migration analysis | Multi-OPTIONAL-MATCH for paragraphs, decisions, externals, copybooks, CICS, files, queues |
| `getProgramFlow(programId)` | UC3: Navigation & flow | Paragraphs + flow edges ordered by executionOrder |
| `getDataOperations(programId)` | UC4: Data ops & exits | See detailed query below |
| `getParagraphSummaries(programId)` | UC5: Text summaries | Paragraphs with summary property, ordered |
| `getBusinessRules(programId)` | UC6: Business rules | Decision nodes + branch targets + CobolBusinessRule nodes |
| `getDependencyMap()` | UC7: Interdependencies | All XCTL_TO/LINK_TO/RETURN_TRANSID edges across programs |
| `getFileOperations(programId)` | UC8: VSAM CRUD map | All READS_FILE/WRITES_FILE/etc. edges with file details |
| `getQueueOperations(programId)` | UC9: Queue I/O map | All TS/TD queue read/write/delete edges |
| `getEibUsage(programId)` | UC10: EIB field usage | All CHECKS_EIB edges grouped by paragraph and purpose |
| `getStorageOperations(programId)` | UC11: Memory/resource mgmt | GETMAIN/FREEMAIN/ENQ/DEQ/LOAD/RELEASE operations |
| `getCrudMatrix(programId)` | UC12: Full CRUD matrix | Cross-join paragraphs x resources x operation types |
| `getDataFlowAcrossCallChain(entryId)` | UC13: Cross-program data flow | Trace COMMAREA/CHANNEL data passing through call chain |

**UC4 Detailed Query -- All Data Operations & Exits:**
```cypher
MATCH (p:CobolProgram {programId: $id})-[:CONTAINS]->(para:CobolParagraph)
OPTIONAL MATCH (para)-[fileOp:READS_FILE|WRITES_FILE|REWRITES_FILE|DELETES_FROM_FILE|BROWSES_FILE]->(f:CobolVsamFile)
OPTIONAL MATCH (para)-[dbOp:QUERIES_TABLE|INSERTS_INTO_TABLE|UPDATES_TABLE|DELETES_FROM_TABLE]->(t:CobolDB2Table)
OPTIONAL MATCH (para)-[tsOp:WRITES_TS_QUEUE|READS_TS_QUEUE|DELETES_TS_QUEUE]->(tsq:CobolTSQueue)
OPTIONAL MATCH (para)-[tdOp:WRITES_TD_QUEUE|READS_TD_QUEUE|DELETES_TD_QUEUE]->(tdq:CobolTDQueue)
OPTIONAL MATCH (para)-[storOp:ACQUIRES_STORAGE|FREES_STORAGE]->(mem)
OPTIONAL MATCH (para)-[eibRef:CHECKS_EIB]->(eib:CobolEibField)
OPTIONAL MATCH (para)-[exitRel:EXIT_VIA]->(term)
RETURN para.name, para.executionOrder,
  collect(DISTINCT {type: type(fileOp), file: f.name, props: properties(fileOp)}) AS fileOps,
  collect(DISTINCT {type: type(dbOp), table: t.name, props: properties(dbOp)}) AS dbOps,
  collect(DISTINCT {type: type(tsOp), queue: tsq.namePattern}) AS tsOps,
  collect(DISTINCT {type: type(tdOp), queue: tdq.name}) AS tdOps,
  collect(DISTINCT {type: type(storOp)}) AS storageOps,
  collect(DISTINCT {field: eib.name, purpose: eibRef.purpose}) AS eibRefs,
  term IS NOT NULL AS isExitPoint
ORDER BY para.executionOrder
```

**UC12 -- CRUD Matrix** (critical for migration):
```cypher
MATCH (p:CobolProgram {programId: $id})-[:CONTAINS]->(para:CobolParagraph)
MATCH (para)-[op]->(resource)
WHERE type(op) IN ['READS_FILE','WRITES_FILE','REWRITES_FILE','DELETES_FROM_FILE',
  'BROWSES_FILE','QUERIES_TABLE','INSERTS_INTO_TABLE','UPDATES_TABLE',
  'DELETES_FROM_TABLE','WRITES_TS_QUEUE','READS_TS_QUEUE','DELETES_TS_QUEUE']
RETURN labels(resource)[0] AS resourceType, resource.name AS resourceName,
  type(op) AS operation, para.name AS paragraph, properties(op) AS details
ORDER BY resource.name, para.executionOrder
```

---

## Phase 5: LLM-Assisted Enrichment
**Goal**: Add semantic layer on top of deterministic graph.

### New file: `packages/backend/src/ingestion/cobol/enrichment/summarizer.ts`
- **Depth-first paragraph summarization**: Process leaf paragraphs first (no outgoing PERFORMS/GO_TO), then work up to entry paragraphs, including child summaries as context
- Store summary on `:CobolParagraph.summary` property
- Generate embedding, store in `cobol_paragraph_chunks` PG table

### New file: `packages/backend/src/ingestion/cobol/enrichment/business-rules.ts`
- For each `:CobolDecision`, extract program slice (paragraph text + referenced variables + branch targets)
- Send to Claude: "Extract the business rule. Return: rule name, conditions, actions, affected data."
- Create `:CobolBusinessRule` nodes with `[:IMPLEMENTS_RULE]` edges
- Generate embedding, store in `cobol_business_rules` PG table

---

## Phase 6: API Routes & MCP Tools

### New file: `packages/backend/src/routes/cobol.routes.ts`

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/cobol/ingest` | POST | Trigger COBOL pipeline on directory/files |
| `/api/cobol/programs` | GET | List all programs with metadata |
| `/api/cobol/programs/:id` | GET | Full program analysis (UC2) |
| `/api/cobol/programs/:id/flow` | GET | Control flow graph (UC3) |
| `/api/cobol/programs/:id/paragraphs` | GET | Paragraph summaries (UC5) |
| `/api/cobol/programs/:id/data-ops` | GET | All data operations & exits (UC4) |
| `/api/cobol/programs/:id/file-ops` | GET | VSAM file CRUD operations (UC8) |
| `/api/cobol/programs/:id/queue-ops` | GET | TS/TD queue operations (UC9) |
| `/api/cobol/programs/:id/eib-usage` | GET | EIB field references & purposes (UC10) |
| `/api/cobol/programs/:id/storage-ops` | GET | GETMAIN/FREEMAIN/ENQ/DEQ (UC11) |
| `/api/cobol/programs/:id/crud-matrix` | GET | Full CRUD matrix across all resources (UC12) |
| `/api/cobol/programs/:id/business-rules` | GET | Business rules (UC6) |
| `/api/cobol/callchain/:entryId` | GET | Full call chain (UC1) |
| `/api/cobol/callchain/:entryId/data-flow` | GET | Cross-program data flow via COMMAREA/CHANNEL (UC13) |
| `/api/cobol/dependencies` | GET | Interdependency map (UC7) |

### Modify: `packages/backend/src/agent/mcpServer.ts`
Add 6 MCP tools:
- `query_cobol_program` -- Full program analysis with all resources
- `trace_cobol_callchain` -- Multi-program call graph traversal
- `get_cobol_paragraph_flow` -- Paragraph-level control flow with summaries
- `get_cobol_data_operations` -- All file/DB2/queue/storage operations for a program
- `get_cobol_crud_matrix` -- CRUD matrix for migration analysis
- `extract_cobol_business_rules` -- Business rules with conditions and actions

### Modify: `packages/backend/src/index.ts`
Register cobol routes

---

## Phase 7: Pipeline Integration

### Modify: `packages/backend/src/ingestion/pipeline.ts`
- In `chunkJSON()`, detect COBOL AST files by structure (version 2.0 + language cobol, or programId + nodes + edges, or entryProgram + programs)
- Queue for COBOL pipeline async alongside existing generic chunking
- Both pipelines run: generic for vector search, COBOL for graph

---

## Phase 8: PostgreSQL Migration

### New file: `packages/backend/src/db/migrations/005_cobol_metadata.sql`

Tables:
- `cobol_programs` -- program metadata, deduplicated by program_id
- `cobol_paragraph_chunks` -- paragraph text + summary + embedding for semantic search
- `cobol_business_rules` -- extracted rules + embedding
- `cobol_data_resources` -- denormalized view of all VSAM files, DB2 tables, TS/TD queues accessed by each program (for fast CRUD matrix queries)

```sql
CREATE TABLE IF NOT EXISTS cobol_data_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id VARCHAR(20) NOT NULL,
  paragraph_name VARCHAR(100),
  resource_type VARCHAR(20) NOT NULL,  -- VSAM_FILE, DB2_TABLE, TS_QUEUE, TD_QUEUE
  resource_name VARCHAR(100) NOT NULL,
  operation VARCHAR(30) NOT NULL,       -- READ, WRITE, REWRITE, DELETE, BROWSE, SELECT, INSERT, UPDATE, etc.
  access_details JSONB DEFAULT '{}',    -- ridfld, keyfield, withUpdate, generic, etc.
  line INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cobol_resources_program ON cobol_data_resources(program_id);
CREATE INDEX idx_cobol_resources_name ON cobol_data_resources(resource_name);
CREATE INDEX idx_cobol_resources_type ON cobol_data_resources(resource_type, operation);
```

HNSW indexes on embedding columns for fast cosine similarity search.

---

## Implementation Order

```
Phase 1 (Types)           <- start here, no dependencies
Phase 2 (Neo4j Schema)    <- depends on Phase 1  } can run in
Phase 8 (PG Migration)    <- depends on Phase 1  } parallel
Phase 3 (ETL Loaders)     <- depends on 1, 2, 8 (core work)
Phase 4 (Graph Service)   <- depends on 2, 3
Phase 7 (Integration)     <- depends on 3
Phase 6 (API/MCP)         <- depends on 4
Phase 5 (LLM Enrichment)  <- depends on 3, 4 (optional for MVP)
```

---

## Verification Plan

1. **Phase 1**: `tsc --noEmit` across all packages passes
2. **Phase 2**: `CALL db.schema.visualization()` in Neo4j Browser shows new labels/indexes; existing `:Entity` nodes untouched
3. **Phase 3 (critical)**:
   - Ingest MV7186 callchain: `MATCH (p:CobolProgram) RETURN count(p)` = 63
   - Ingest MV7187 FinalAST: 18 `:CobolParagraph`, 26 `:CobolVariable`, 3 `:CobolCopybook`
   - Ingest MV7187 ControlFlow: verify FALLS_THROUGH, GO_TO, BRANCHES_TRUE edges exist
   - Ingest MV7187 DecisionTree: verify `:CobolDecision` and `:CobolCicsCommand` nodes
   - **VSAM file operations**: Ingest MV7192 FinalAST -> verify `:CobolVsamFile {name: 'MVCOCOR'}` exists with `[:READS_FILE]`, `[:REWRITES_FILE]` edges
   - **Browse operations**: Ingest MV7189 FinalAST -> verify `[:BROWSES_FILE]` edges for STARTBR/READNEXT/ENDBR
   - **Queue operations**: Ingest MW7221 FinalAST -> verify `:CobolTSQueue` node with `[:WRITES_TS_QUEUE]`, `[:READS_TS_QUEUE]`, `[:DELETES_TS_QUEUE]` edges
   - **GETMAIN**: Verify `[:ACQUIRES_STORAGE]` edges present (37 occurrences across programs)
   - **EIB fields**: `MATCH (e:CobolEibField) RETURN e.name, count(e)` should include EIBCALEN, EIBAID at minimum
   - **EIB routing**: `MATCH (p:CobolParagraph)-[r:CHECKS_EIB]->(e:CobolEibField {name:'EIBCALEN'}) RETURN r.purpose` should return 'firstTimeCheck'
   - **CRUD matrix**: Hit `/api/cobol/programs/MV7192/crud-matrix` -> returns MVCOCOR with READ, REWRITE operations
4. **Phase 4**: Each API endpoint returns correct JSON. Specific checks:
   - `/api/cobol/programs/MV7192/file-ops` -> returns MVCOCOR READ/REWRITE
   - `/api/cobol/programs/MW7221/queue-ops` -> returns MX30TSQ-KEY WRITEQ/READQ/DELETEQ
   - `/api/cobol/programs/MV7187/eib-usage` -> returns EIBCALEN (firstTimeCheck), EIBAID (keyRouting)
5. **Phase 5**: `MATCH (p:CobolParagraph {programId:'MV7187'}) WHERE p.summary IS NOT NULL RETURN count(p)` = 18
6. **Phase 6**: MCP tools work via Claude agent chat. Test: "What VSAM files does MV7192 access and what operations does it perform?"
7. **Phase 7**: Upload FinalAST via `/api/documents/upload` -> both generic chunks in PG and COBOL nodes in Neo4j
8. **End-to-end**: Query "trace the full call chain from MV7186 and show all data resources accessed" returns 63-program graph with VSAM files, queues, and CRUD matrix across the chain

---

## CICS Construct Coverage Matrix

All CICS/COBOL constructs the knowledge base must handle, with counts from the existing 63-program AST dataset:

| Category | Command | Count | Node Type | Relationship | Status |
|----------|---------|-------|-----------|-------------|--------|
| **Screen I/O** | SEND MAP | 226 | `:CobolCicsCommand` + `:CobolMap` | `[:SENDS_MAP]` | In plan |
| | RECEIVE MAP | 134 | `:CobolCicsCommand` + `:CobolMap` | `[:RECEIVES_MAP]` | In plan |
| | SEND (text) | 62 | `:CobolCicsCommand` | `[:SENDS_TEXT]` | In plan |
| | SEND PAGE | 1 | `:CobolCicsCommand` | `[:SENDS_PAGE]` | In plan |
| **VSAM File** | READ | 40 | `:CobolVsamFile` | `[:READS_FILE]` | In plan |
| | WRITE | 30 | `:CobolVsamFile` | `[:WRITES_FILE]` | In plan |
| | STARTBR | 18 | `:CobolVsamFile` | `[:BROWSES_FILE]` | In plan |
| | READNEXT | 17 | `:CobolVsamFile` | `[:BROWSES_FILE]` | In plan |
| | ENDBR | 14 | (no new node) | (marks browse end) | In plan |
| | REWRITE | 7 | `:CobolVsamFile` | `[:REWRITES_FILE]` | In plan |
| | DELETE | 2 | `:CobolVsamFile` | `[:DELETES_FROM_FILE]` | In plan |
| | READPREV | 1 | `:CobolVsamFile` | `[:BROWSES_FILE]` | In plan |
| | UNLOCK | 1 | `:CobolVsamFile` | `[:UNLOCKS_FILE]` | In plan |
| **TS Queue** | WRITEQ TS | 1 | `:CobolTSQueue` | `[:WRITES_TS_QUEUE]` | In plan |
| | READQ TS | 1 | `:CobolTSQueue` | `[:READS_TS_QUEUE]` | In plan |
| | DELETEQ TS | 1 | `:CobolTSQueue` | `[:DELETES_TS_QUEUE]` | In plan |
| **TD Queue** | WRITEQ TD | 0* | `:CobolTDQueue` | `[:WRITES_TD_QUEUE]` | In plan |
| | READQ TD | 0* | `:CobolTDQueue` | `[:READS_TD_QUEUE]` | In plan |
| | DELETEQ TD | 0* | `:CobolTDQueue` | `[:DELETES_TD_QUEUE]` | In plan |
| **Memory** | GETMAIN | 37 | (edge only) | `[:ACQUIRES_STORAGE]` | In plan |
| | LOAD | 11 | (edge only) | `[:LOADS_PROGRAM]` | In plan |
| | RELEASE | 10 | (edge only) | `[:RELEASES_PROGRAM]` | In plan |
| **Program Ctrl** | XCTL | 129 | `:CobolProgram` | `[:XCTL_TO]` | In plan |
| | RETURN | 122 | terminal | `[:EXIT_VIA]` | In plan |
| | LINK | 9 | `:CobolProgram` | `[:LINK_TO]` | In plan |
| **Error Handling** | HANDLE CONDITION | 102 | `:CobolHandler` | `[:HANDLES_CONDITION]` | In plan |
| | HANDLE AID | 27 | `:CobolHandler` | `[:HANDLES_AID]` | In plan |
| **Time** | ASKTIME | 1 | `:CobolCicsCommand` | `[:ASKS_TIME]` | In plan |
| | FORMATTIME | 1 | `:CobolCicsCommand` | `[:FORMATS_TIME]` | In plan |
| **DB2** | EXEC SQL * | 0* | `:CobolDB2Table`/`:CobolDB2Cursor` | `[:QUERIES_TABLE]` etc. | In plan |
| **Resource Lock** | ENQ/DEQ | 0* | `:CobolResourceLock` | `[:ENQUEUES_ON]` | In plan |
| **Channel** | PUT/GET CONTAINER | 0* | `:CobolChannel`/`:CobolContainer` | `[:PUTS_CONTAINER]` | In plan |
| **System** | ASSIGN | 0* | (edge only) | `[:ASSIGNS_FIELD]` | In plan |

\* = Not found in current 63-program dataset but supported for completeness.

### EIB Fields Tracked

| Field | PIC | Usage Category | Found in Data |
|-------|-----|---------------|---------------|
| EIBCALEN | S9(4) COMP | dataLength / firstTimeCheck | Yes (all pseudo-conv programs) |
| EIBAID | X(1) | keyRouting | Yes (compared to DFHENTER/DFHPF*/DFHCLEAR) |
| EIBTRNID | X(4) | transactionRouting | Yes |
| EIBTIME | S9(7) COMP-3 | timestamp | Yes |
| EIBDATE | S9(7) COMP-3 | timestamp | Yes |
| EIBRESP | S9(8) COMP | errorHandling | Yes (after file/queue ops) |
| EIBRESP2 | S9(8) COMP | errorHandling | Yes |
| EIBTRMID | X(4) | terminalIdentification | Yes |
| EIBDS | X(8) | resourceIdentification | Supported |
| EIBRSRCE | X(8) | resourceIdentification | Supported |
| EIBFN | X(2) | errorHandling | Supported |
| EIBCPOSN | S9(4) COMP | cursorPosition | Supported |
| EIBTASKN | S9(7) COMP-3 | taskIdentification | Supported |
| EIBREQID | X(8) | intervalControl | Supported |

### cicsRawText Parsing Strategy

The AST `cicsParams` object is sometimes incomplete (e.g., empty `{}` for WRITEQ/READQ/DELETEQ). When `cicsParams` is insufficient, parse `cicsRawText` directly:

```typescript
// Example: "EXEC CICS READQ TS QUEUE(MX30TSQ-KEY) INTO(MX30TSQ-RECORD) ITEM(W05-TS-ITEM) RESP(W01-RESP-CODE) END-EXEC"
function parseCicsRawText(rawText: string): Record<string, string> {
  const params: Record<string, string> = {};
  const paramRegex = /(\w+)\(([^)]+)\)/g;
  let match;
  while ((match = paramRegex.exec(rawText)) !== null) {
    params[match[1].toLowerCase()] = match[2].trim();
  }
  // Also detect standalone keywords: UPDATE, EQUAL, GTEQ, GENERIC, REWRITE, NEXT, MAIN, AUXILIARY
  for (const kw of ['UPDATE','EQUAL','GTEQ','GENERIC','REWRITE','NEXT','MAIN','AUXILIARY','NOSUSPEND']) {
    if (new RegExp(`\\b${kw}\\b`).test(rawText)) params[kw.toLowerCase()] = 'true';
  }
  return params;
}
```

This fallback parser is critical for TS/TD queue operations where the AST parser doesn't populate `cicsParams`.

---

## Key Design Decisions

1. **Separate Neo4j labels** (`:CobolProgram` vs `:Entity`): Keeps COBOL graph isolated from generic KB. No risk of breaking existing functionality.
2. **Deterministic graph from AST, LLM only for summaries**: Research-backed -- cheaper, more accurate, 100% coverage.
3. **DecisionTree loader is optional**: Creates many statement-level nodes. Load on-demand per program for detailed analysis.
4. **Dual storage**: Neo4j for structural queries (call chains, flow), PG for semantic search (paragraph summaries, business rules).
5. **Batch ingestion with UNWIND**: Performance optimization for 63+ program call chains.
6. **cicsRawText fallback parsing**: The AST `cicsParams` is incomplete for some commands (WRITEQ/READQ/DELETEQ show empty `{}`). A regex parser on `cicsRawText` fills the gap.
7. **EIB fields as first-class nodes**: Rather than treating EIB references as just variable usages, model them as `:CobolEibField` nodes with usage classification -- this enables queries like "show me all pseudo-conversational entry points" or "which paragraphs do error handling".
8. **VSAM files as shared resources**: A single `:CobolVsamFile` node (e.g., MVCOCOR) is shared across all programs that access it, enabling cross-program impact analysis ("which programs write to MVCOCOR?").

---

## Critical Files to Modify

| File | Change |
|------|--------|
| [knowledge.ts](packages/shared/src/types/knowledge.ts) | Extend EntityType/RelationshipType unions |
| [neo4j.ts](packages/backend/src/db/neo4j.ts) | Add COBOL constraints/indexes |
| [pipeline.ts](packages/backend/src/ingestion/pipeline.ts) | Detect COBOL files, queue to COBOL pipeline |
| [mcpServer.ts](packages/backend/src/agent/mcpServer.ts) | Add 4 COBOL MCP tools |
| [index.ts](packages/backend/src/index.ts) | Register cobol routes |

## New Files to Create

| File | Purpose |
|------|---------|
| `packages/shared/src/types/cobol-graph.ts` | COBOL type definitions |
| `packages/backend/src/ingestion/cobol/pipeline.ts` | COBOL ETL orchestrator |
| `packages/backend/src/ingestion/cobol/loaders/callchain.loader.ts` | CallChain manifest loader |
| `packages/backend/src/ingestion/cobol/loaders/finalast.loader.ts` | FinalAST loader |
| `packages/backend/src/ingestion/cobol/loaders/controlflow.loader.ts` | ControlFlow loader |
| `packages/backend/src/ingestion/cobol/loaders/decisiontree.loader.ts` | DecisionTree loader |
| `packages/backend/src/ingestion/cobol/enrichment/summarizer.ts` | Paragraph summarizer |
| `packages/backend/src/ingestion/cobol/enrichment/business-rules.ts` | Business rule extractor |
| `packages/backend/src/services/cobol-graph.service.ts` | COBOL Cypher queries |
| `packages/backend/src/routes/cobol.routes.ts` | COBOL API endpoints |
| `packages/backend/src/db/migrations/005_cobol_metadata.sql` | PG schema for COBOL |
