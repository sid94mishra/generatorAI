# Research: Building Knowledge Bases for COBOL Program Analysis Using ASTs

## Comprehensive Research Summary (April 2026)

---

## 1. ARCHITECTURAL APPROACHES: HOW TO BUILD A KNOWLEDGE BASE FROM COBOL ASTs

### 1.1 The Code Property Graph (CPG) Model

The most well-established schema for representing program knowledge is the **Code Property Graph**, specified by the Joern project (Spec v1.1). A CPG merges three representations into a single directed, edge-labeled, attributed multigraph:

- **Abstract Syntax Tree (AST)** - hierarchical code structure
- **Control Flow Graph (CFG)** - execution paths through methods
- **Program Dependence Graph (PDG)** - data flow and control dependencies

**CPG Layers (from Joern Spec 1.1):**
1. **MetaData** - CPG creation details, language frontend, version
2. **FileSystem** - FILE nodes indexing compilation units
3. **Namespace** - organizational structure
4. **Method** - METHOD, METHOD_PARAMETER_IN/OUT, METHOD_RETURN nodes
5. **Type** - TYPE_DECL, TYPE, MEMBER nodes with INHERITS_FROM edges
6. **AST** - BLOCK, CALL, CONTROL_STRUCTURE, EXPRESSION, LITERAL, LOCAL, IDENTIFIER nodes with AST parent-child edges
7. **CallGraph** - CALL nodes with METHOD_FULL_NAME, DISPATCH_TYPE properties
8. **CFG** - CFG_NODE markers with CFG edges for execution flow
9. **Dominators** - DOMINATE and POST_DOMINATE edges
10. **PDG** - REACHING_DEF edges (data flow) and CDG edges (control dependencies)

**Relevance to your system:** Since you already have AST JSON, control flow graphs, and decision trees, the CPG model provides a proven schema for unifying them. However, Joern does not natively support COBOL -- you would need to adapt the schema for COBOL-specific constructs (paragraphs, sections, divisions, copybooks, PERFORM/GOTO).

### 1.2 The Unified Graph Model (Cobol-REKT approach)

The open-source **cobol-rekt** toolkit (github.com/avishek-sen-gupta/cobol-rekt) provides the most directly relevant architecture for COBOL knowledge graphs. It creates a unified model combining:

- **AST nodes** connected via CONTAINS edges
- **Control flow** connected via FOLLOWED_BY edges
- **Data structure dependencies** connected via MODIFIES and ACCESSES edges
- **Comment nodes** attached via HAS_COMMENT relations

This unified model can be exported to:
- **Neo4j** (direct injection of AST, CFG, and data layouts)
- **GraphML** (for tools like yEd)
- **JSON** (for programmatic consumption)
- **NetworkX** (for Python-based graph algorithms)

Additional capabilities:
- T1-T2 transform testing for structured programming analysis
- Loop detection via strongly connected components and DJ graphs
- Reaching conditions calculation
- LLM-based depth-first summarization using Azure OpenAI
- Capability map extraction from paragraphs
- Inter-paragraph similarity via Zhang-Shasha tree edit distance

### 1.3 The Five-Layer Codebase Knowledge Graph (Neo4j/Strazh approach)

The Neo4j blog describes a hierarchical CKG with five layers:
1. **Project Dependencies** - projects and packages
2. **Folder Structure** - files and directories
3. **Types** - classes and interfaces
4. **Methods** - functions with invocation relationships
5. **Semantic Enrichment** - derived relationships like IMPLEMENTED_AS

Key relationship types: DECLARED_IN, HAVE, INVOKE, INSTANTIATE, DEPENDS_ON, IMPLEMENTED_AS.

### 1.4 Recommended COBOL-Specific Graph Schema

Based on research, here is a recommended schema for your existing artifacts:

**Node Types:**
- PROGRAM (entry programs, called programs)
- DIVISION (IDENTIFICATION, ENVIRONMENT, DATA, PROCEDURE)
- SECTION (within each division)
- PARAGRAPH (the key unit of COBOL logic)
- STATEMENT (MOVE, COMPUTE, IF, EVALUATE, PERFORM, CALL, etc.)
- VARIABLE (working storage, linkage, file section items)
- COPYBOOK (shared data definitions)
- FILE_DEFINITION (FD entries)
- CONDITION (88-level items, IF/EVALUATE conditions)
- EXTERNAL_PROGRAM (called programs, CICS transactions)
- DECISION_NODE (from your decision trees)
- TERMINAL_NODE (exit points, STOP RUN, GOBACK)

**Edge Types:**
- CONTAINS (structural parent-child from AST)
- FOLLOWED_BY (control flow between paragraphs/statements)
- CALLS (CALL statement to external program)
- PERFORMS (PERFORM to paragraph/section)
- READS / WRITES (file I/O operations)
- MODIFIES / ACCESSES (variable usage)
- COPIES (copybook inclusion)
- BRANCHES_TO (conditional flow from decision nodes)
- DEPENDS_ON (cross-program dependency from call chain)
- REDEFINES (REDEFINES clause relationships)
- FLOWS_INTO (data flow between variables)

**Properties:**
- Line numbers, source file references
- Complexity scores
- Business rule indicators
- Data types and picture clauses
- Condition expressions

---

## 2. GRAPH DATABASE OPTIONS

### 2.1 Neo4j (RECOMMENDED)

**Pros:**
- Most mature graph database for code analysis use cases
- Native Cypher query language excels at path traversal (critical for call chains)
- Variable-length path queries: `MATCH p=(entry:Program)-[:CALLS*]->(target:Program)` for full call chain traversal
- Built-in vector search (since v5.11) enables hybrid graph+vector queries
- Extensive ecosystem: Neo4j Bloom for visualization, APOC procedures
- Direct support from cobol-rekt toolkit
- Used by Microsoft's Legacy-Modernization-Agents framework
- GraphRAG integration via neo4j-graphrag-python library
- Community Edition is free; AuraDB offers managed cloud hosting

**Cons:**
- Single-machine architecture in Community Edition (clustering requires Enterprise)
- Can be memory-intensive for very large codebases (millions of nodes)
- Cypher learning curve

**Key Cypher patterns for your use cases:**
```cypher
-- Full call chain from entry program
MATCH path = (entry:Program {name: 'MAINPROG'})-[:CALLS*]->(called:Program)
RETURN path

-- All paragraphs with decision logic
MATCH (p:Paragraph)-[:CONTAINS]->(d:DecisionNode)-[:BRANCHES_TO]->(target)
RETURN p.name, d.condition, target.name

-- Data lineage for a variable
MATCH path = (source)-[:FLOWS_INTO*]->(v:Variable {name: 'CUSTOMER-BALANCE'})
RETURN path

-- Impact analysis: what programs are affected if COPYBOOK changes
MATCH (c:Copybook {name: 'CUSTCOPY'})<-[:COPIES]-(p:Program)
RETURN p.name
```

### 2.2 Amazon Neptune

**Pros:**
- Fully managed on AWS, no operational overhead
- Built-in GraphRAG with Amazon Bedrock Knowledge Bases
- Supports both property graph (openCypher) and RDF (SPARQL)
- Automatic scaling and high availability
- Vector search integration for gen AI apps
- Good if your infrastructure is already AWS-based

**Cons:**
- More expensive than self-hosted Neo4j
- Less community tooling specifically for code analysis
- openCypher support is a subset of Neo4j's Cypher
- No direct integration with COBOL analysis tools
- Vendor lock-in

### 2.3 FalkorDB

**Pros:**
- Open-source, Redis-compatible graph database optimized for knowledge graphs
- CodeGraph project specifically designed for code knowledge graphs
- Natural language to Cypher via LLM integration
- Very fast for real-time queries (GraphBLAS under the hood)
- Lower memory footprint than Neo4j

**Cons:**
- Smaller community than Neo4j
- Less mature for enterprise deployments
- CodeGraph only supports Python currently (would need COBOL extension)

### 2.4 Recommendation

**Neo4j is the clear winner** for this use case because:
1. Direct COBOL tooling exists (cobol-rekt exports to Neo4j)
2. Microsoft's COBOL migration framework uses Neo4j
3. The research paper on AST-derived GraphRAG validates the approach
4. Cypher's variable-length path queries are essential for call chain analysis
5. Built-in vector search enables hybrid retrieval

---

## 3. HYBRID VECTOR + GRAPH DATABASE APPROACHES

### 3.1 Architecture

The recommended hybrid architecture combines:

**Graph Database (Neo4j)** for:
- Structural queries (call chains, dependencies, impact analysis)
- Multi-hop reasoning (controller -> service -> repository chains)
- Deterministic traversal (what programs does X call?)
- Relationship-aware context retrieval

**Vector Database/Index** for:
- Semantic similarity search (find similar business logic)
- Natural language queries about code
- Embedding-based retrieval for LLM context windows
- Finding paragraphs with similar functionality across programs

### 3.2 HybridRAG Pipeline

Based on the HybridRAG research (arxiv 2408.04948) and Neo4j's built-in vector capabilities:

1. **Embed** paragraph-level code summaries and business rule descriptions as vectors
2. **Store** vectors alongside graph nodes in Neo4j (native vector index)
3. **Query** using both semantic similarity (vector search) and structural relationships (graph traversal)
4. **Merge** results with priority to graph-based results for structural questions and vector results for semantic questions
5. **Feed** merged context to LLM for answer generation

### 3.3 AST-Derived Graph RAG vs LLM-Extracted Graphs

A January 2025 paper ("Reliable Graph-RAG for Codebases") compared three approaches:

| Approach | Correctness (45 Qs) | Indexing Time | Cost vs Baseline |
|----------|---------------------|---------------|------------------|
| Vector-only | 31 correct, 5 incorrect | 18s | 1.0x |
| LLM-extracted graph | 38 correct, 2 incorrect | 215s | 19.75x-45.64x |
| AST-derived graph (DKB) | 43 correct, 0 incorrect | 22s | 2.13x-2.25x |

**Key findings:**
- AST-derived graphs achieved **zero incorrect answers** across all repositories
- LLM-extracted graphs skipped 31% of files (377/1210 in Shopizer)
- AST-derived graphs built in seconds vs minutes for LLM extraction
- Cost multiplier for LLM graphs escalates dramatically with repository size
- Interface-consumer expansion in AST graphs enables cross-boundary discovery

**Strong recommendation:** Since you already have deterministic AST JSON files, use AST-derived graph construction, not LLM-based extraction. Reserve LLMs for semantic enrichment (summaries, business rule descriptions) layered on top of the deterministic graph.

---

## 4. INDUSTRY APPROACHES TO COBOL KNOWLEDGE EXTRACTION

### 4.1 IBM watsonx Code Assistant for Z

- Uses Application Discovery tool to analyze applications and map dependencies
- Automated refactoring tool helps identify business services to extract
- 20-billion parameter Granite model for code understanding
- 2.8 release (2026) introduces agentic workflows with MCP-enabled tools
- "Z Understand Metadata Retrieval" ensures full enterprise application context
- NOSI achieved 79% reduction in application understanding time (24h -> 5h)

### 4.2 Phase Change AI (COBOL Colleague)

- Uses **symbolic AI + knowledge graphs** (not just LLMs)
- Builds mathematically-verified knowledge graph from formal analysis
- Captures complete causal structure of enterprise applications
- Every cause-and-effect relationship derived deterministically from code
- Program slicing, data flow analysis, business logic extraction
- Combines symbolic graph reasoning with LLM natural language generation
- Zero hallucination guarantee for facts (LLM used only for language fluency)
- Normalizes code into formal representation stored in ontology-based knowledge graph

### 4.3 Microsoft Legacy Modernization Agents (Open Source)

Seven specialized agents:
1. CobolAnalyzerAgent - structural metadata extraction
2. BusinessLogicExtractorAgent - business documentation generation
3. JavaConverterAgent / CSharpConverterAgent - code generation
4. DependencyMapperAgent - CALL/COPY/PERFORM/IO relationship mapping
5. ChunkAwareConverters - semantic chunking for large files

Pipeline: Regex parsing + AI analysis -> SQLite + Neo4j -> Business logic extraction -> Dependency resolution -> Code conversion

Three-tier complexity scoring (low/medium/high) allocates LLM reasoning effort.

### 4.4 TSRI (JANUS Studio)

- Generates UML-based Application Blueprint and Transformation Blueprint
- Control Flow, Data Flow, Cause-Effect, Complexity Analysis, State Transition Tables
- Side-by-side hyperlinking between source COBOL and target code
- Successfully modernized 5M+ lines of COBOL for Sprint Nextel

### 4.5 Fujitsu Application Transform (March 2026)

- SaaS leveraging generative AI to analyze COBOL
- Automatically generates design documents
- Claims "without expert knowledge" in minutes rather than hours

### 4.6 EPAM Solutions

- AI/RUN Mainframe Lens (MFLens): automates code structure mapping and business rule extraction
- ART (AI Reverse-engineering Tool): parses codebases and identifies modernization areas
- Custom lexical parsers + AST generation before LLM processing
- Generates business rules, lineage analysis, CRUD matrices, source-to-target mappings

### 4.7 CLPS (March 2026)

- AI-driven COBOL-to-Java migration combining 20 years of domain expertise
- LLM-based semantic conversion with static analysis, dynamic tracing
- Knowledge-graph reconstruction from COBOL codebase

### 4.8 Broadcom / Code4z

- COBOL Control Flow extension for VS Code
- Displays paragraphs as graphical nodes with edges based on PERFORM statements
- Part of the Code4z mainframe development suite

### 4.9 COBOLpro

- Formal ANTLR lexers/parsers for mathematically correct application model
- 100% accuracy in data lineage and impact analysis
- Maps dependencies across CICS, JCL, DB2, and batch flows
- Static analysis with SME validation

---

## 5. USING LLMs WITH STRUCTURED AST DATA

### 5.1 Recommended LLM Integration Pattern

Based on the research, the optimal pattern is:

**Deterministic Foundation + LLM Enrichment:**

1. Parse COBOL into AST (you already have this)
2. Build deterministic knowledge graph from AST JSON
3. Use LLMs for semantic tasks layered on top:
   - Paragraph-by-paragraph natural language summaries
   - Business rule extraction and description
   - Variable naming interpretation (cryptic COBOL names -> business terms)
   - Migration documentation generation

This is the approach used by Phase Change AI, and validated by the GraphRAG paper showing AST-derived graphs outperform LLM-extracted graphs.

### 5.2 LLM Summarization Pipeline (from cobol-rekt)

cobol-rekt implements depth-first LLM summarization:
1. Start at leaf nodes (innermost paragraphs/statements)
2. Generate summaries bottom-up
3. Each parent node's summary incorporates child summaries
4. Produces hierarchical understanding from specific to general
5. Uses Azure OpenAI APIs

### 5.3 Business Rule Extraction: LLM vs Rule-Based

The EASE 2025 paper "COBRAIN" compared LLM-based (Gemini-Pro, few-shot prompting) vs rule-based (COBREX, control flow graph analysis) extraction:

- **Rule-based (COBREX):** Higher precision, deterministic, but output less readable
- **LLM-based (COBRAIN):** More readable output, captures implicit rules, but may miss or hallucinate
- **Recommendation:** Combine both -- use rule-based extraction for precision, then LLM for natural language formatting and implicit rule discovery

### 5.4 Context Window Strategy

For feeding AST data to LLMs:
- Use graph traversal to select relevant subgraph (not entire program)
- Include: target paragraph + called paragraphs + relevant variable definitions + copybook fields
- Exclude: unrelated data divisions, irrelevant paragraphs
- Microsoft's approach: three-tier complexity scoring determines token allocation
- Semantic chunking at DIVISION -> SECTION -> PARAGRAPH boundaries

---

## 6. BUSINESS RULE EXTRACTION FROM COBOL ASTs

### 6.1 Multi-Step Pipeline

Based on COBREX, A-COBREX (IBM Research, ICSE 2025), and COBRAIN research:

**Step 1: Variable Identification**
- Parse DATA DIVISION to identify business-relevant variables
- Classify variables: input, output, intermediate, constants
- Resolve copybook references to expand variable scope

**Step 2: Control Flow Analysis**
- Build CFG from PROCEDURE DIVISION
- Identify decision points (IF, EVALUATE, PERFORM UNTIL)
- Map paragraph execution order

**Step 3: Data Flow Analysis**
- Track variable modifications through MOVE, COMPUTE, ADD, etc.
- Build def-use chains for each business variable
- Trace data across program boundaries (via CALL parameters, copybooks)

**Step 4: Program Slicing**
- For each output variable, extract the backward slice
- Slice captures all statements that influence the output
- This isolates business rules from infrastructure code

**Step 5: Rule Discovery**
- Event-Condition-Action pattern matching
- Group related conditions and actions
- Generate structured rule representations

**Step 6: LLM Enhancement**
- Feed extracted rules + context to LLM
- Generate natural language descriptions
- Identify implicit business rules
- Cross-reference with domain terminology

### 6.2 Tools for Business Rule Extraction

1. **A-COBREX** (IBM Research) - newest tool, presented at ICSE 2025
2. **COBREX** - rule-based, uses ANTLR4 COBOL85 grammar, builds CFG
3. **COBRAIN** - LLM-based using Gemini-Pro with few-shot prompting
4. **Softwaremining** - commercial tool with semi-automated extraction
5. **OneAdvanced Application Analyser** - commercial BRX capability
6. **Phase Change COBOL Colleague** - symbolic AI + knowledge graph approach

---

## 7. CROSS-PROGRAM DEPENDENCY ANALYSIS

### 7.1 Relationship Types to Track

Based on your call chain manifests and industry tools:

- **CALL** - direct program invocation
- **COPY** - copybook inclusion (shared data definitions)
- **PERFORM** - internal paragraph/section execution
- **EXEC SQL** - database interactions
- **EXEC CICS** - transaction processing (LINK, XCTL, TRANSFER)
- **READ/WRITE/REWRITE/DELETE** - file I/O
- **OPEN/CLOSE** - file management

### 7.2 Impact Analysis Queries

With a Neo4j knowledge graph, critical queries include:

```cypher
-- Transitive dependencies: all programs reachable from entry
MATCH path = (entry:Program {name: 'MAINPROG'})-[:CALLS|PERFORMS*]->(dep)
RETURN DISTINCT dep.name, length(path) as depth

-- Shared copybook impact: which programs share data definitions
MATCH (p1:Program)-[:COPIES]->(c:Copybook)<-[:COPIES]-(p2:Program)
WHERE p1 <> p2
RETURN c.name, collect(DISTINCT p1.name) as programs

-- Data flow across program boundaries
MATCH (caller:Program)-[call:CALLS]->(callee:Program),
      (caller)-[:MODIFIES]->(v:Variable)-[:PASSED_TO]->(callee)
RETURN caller.name, callee.name, v.name

-- All exit points in a call chain
MATCH path = (entry:Program {name: 'MAINPROG'})-[:CALLS*0..]->(p:Program)
MATCH (p)-[:CONTAINS]->(t:TerminalNode)
RETURN p.name, t.type, t.line_number
```

### 7.3 Visualization

Your existing HTML diagram visualizations can be enhanced with:
- Interactive Neo4j Bloom exploration
- Mermaid/Graphviz exports from graph queries
- D3.js force-directed layouts for dependency graphs
- Hierarchical layouts showing call depth

---

## 8. RECOMMENDED ARCHITECTURE FOR YOUR SYSTEM

Given your existing artifacts (AST JSON, CFGs, decision trees, call chain manifests, HTML diagrams), here is the recommended architecture:

### 8.1 Knowledge Graph Construction Pipeline

```
[Existing AST JSON files]
    |
    v
[Graph ETL Pipeline]  -- Parse AST JSON, extract nodes and relationships
    |
    +---> [Neo4j Knowledge Graph]
    |         |
    |         +-- Program nodes + CALLS edges (from call chain manifests)
    |         +-- Paragraph nodes + FOLLOWED_BY edges (from CFGs)
    |         +-- Decision nodes + BRANCHES_TO edges (from decision trees)
    |         +-- Variable nodes + MODIFIES/ACCESSES edges (from AST)
    |         +-- Statement nodes + CONTAINS edges (from AST)
    |         +-- Terminal nodes + EXIT_THROUGH edges
    |         +-- Copybook nodes + COPIES edges
    |
    +---> [Vector Index (Neo4j native or separate)]
              |
              +-- Paragraph summary embeddings
              +-- Business rule description embeddings
              +-- Variable/field description embeddings
```

### 8.2 LLM Enrichment Layer

```
[Neo4j Knowledge Graph]
    |
    v
[Subgraph Extraction]  -- Select relevant context via graph traversal
    |
    v
[LLM Processing]
    |
    +---> Paragraph-level summaries (depth-first, bottom-up)
    +---> Business rule extraction (slicing + LLM interpretation)
    +---> Variable glossary (COBOL names -> business terms)
    +---> Cross-program flow narratives
    |
    v
[Store enrichments back in graph as properties/nodes]
```

### 8.3 Query/Retrieval Layer

```
User Query
    |
    v
[Query Router]
    |
    +---> Structural queries --> [Cypher on Neo4j]
    |     (call chains, dependencies, impact analysis)
    |
    +---> Semantic queries --> [Vector search + Graph expansion]
    |     (find similar logic, natural language questions)
    |
    +---> Hybrid queries --> [GraphRAG pipeline]
          (explain business logic of call chain X)
    |
    v
[LLM Generation with graph-grounded context]
    |
    v
[Response with source citations (file, line number)]
```

### 8.4 Mapping to Your Use Cases

| Use Case | Primary Approach | Key Graph Queries |
|----------|-----------------|-------------------|
| 1. Full call chain control flow | Cypher path traversal | `(entry)-[:CALLS*]->(p)-[:CONTAINS]->(paragraph)-[:FOLLOWED_BY*]->` |
| 2. Migration analysis | Graph metrics + LLM | Complexity scoring, dependency enumeration, paragraph summaries |
| 3. Navigation and flow | Interactive graph visualization | Bloom/D3 rendering of subgraphs |
| 4. Data operations + exit points | Cypher data flow queries | `(v:Variable)-[:MODIFIES|ACCESSES]->`, terminal node enumeration |
| 5. Paragraph summaries | LLM with graph context | Depth-first summarization with graph-extracted context |
| 6. Business rules | Slicing + LLM | Backward slicing from output variables, LLM interpretation |
| 7. Interdependencies | Cypher multi-hop | Transitive closure queries, shared copybook analysis |

---

## 9. IMPLEMENTATION RECOMMENDATIONS

### Phase 1: Graph Construction (Weeks 1-3)
1. Design Neo4j schema based on your AST JSON structure
2. Build ETL pipeline: AST JSON -> Neo4j nodes/edges
3. Import CFG data (nodes + edges with paragraphs, decisions, terminals)
4. Import call chain manifests as inter-program CALLS edges
5. Import decision tree data as BRANCHES_TO relationships
6. Validate with basic Cypher queries

### Phase 2: Enrichment (Weeks 3-5)
1. Build paragraph-level LLM summarization pipeline (depth-first)
2. Extract business rules using slicing + LLM
3. Generate variable glossary
4. Create vector embeddings for summaries and rules
5. Store enrichments in graph

### Phase 3: Query Interface (Weeks 5-7)
1. Build GraphRAG retrieval pipeline
2. Implement query router for structural vs semantic queries
3. Create API endpoints for each use case
4. Integrate with existing HTML visualization

### Technology Stack:
- **Graph DB:** Neo4j Community Edition (or AuraDB for managed)
- **ETL:** Python with neo4j driver + custom AST JSON parser
- **LLM:** Claude/GPT-4 for summarization and rule extraction
- **Embeddings:** text-embedding-3-small or similar for vector index
- **Vector:** Neo4j native vector index (avoids separate DB sync)
- **Visualization:** Neo4j Bloom + existing HTML diagrams
- **API:** FastAPI or similar for query endpoints

---

## 10. KEY SOURCES AND REFERENCES

### Research Papers
- "Reliable Graph-RAG for Codebases: AST-Derived Graphs vs LLM-Extracted Knowledge Graphs" (arxiv 2601.08773, Jan 2025)
- "LLM Vs Rule-Based - The COBRAIN Tool" (EASE 2025, ACM)
- "A-COBREX: A Tool for Identifying Business Rules in COBOL Programs" (IBM Research, ICSE 2025)
- "HybridRAG: Integrating Knowledge Graphs and Vector RAG" (arxiv 2408.04948)
- "Extracting Business Rules from COBOL: A Model-Based Framework" (Cosentino et al.)

### Open Source Tools
- cobol-rekt: github.com/avishek-sen-gupta/cobol-rekt (Neo4j export, unified model)
- Legacy-Modernization-Agents: github.com/Azure-Samples/Legacy-Modernization-Agents (Microsoft, 7-agent framework)
- FalkorDB CodeGraph: github.com/FalkorDB/code-graph (code knowledge graphs)
- Joern CPG Spec: cpg.joern.io (schema reference)
- COBREX: rishalab.github.io/COBREXdoc (business rule extraction)

### Commercial Products
- IBM watsonx Code Assistant for Z
- Phase Change AI COBOL Colleague
- TSRI JANUS Studio
- EPAM MFLens / ART
- Broadcom Code4z COBOL Control Flow
- COBOLpro
- Kodesage
