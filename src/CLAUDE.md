# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for PostgreSQL database interactions. It provides a standardized interface for AI agents to interact with PostgreSQL databases through the MCP protocol.

## Key Architecture

- **MCP Server Implementation**: Built using `@modelcontextprotocol/sdk` with stdio transport
- **Database Connection**: Uses `pg` (node-postgres) with connection pooling
- **Resource Model**: Tables are exposed as resources with schema information available at `{table_name}/schema`
- **Tool-based Operations**: Nine database operations and health monitoring tools with multi-database support:
  - `list_databases`: List all configured databases and their information
  - `query`: Read-only SQL queries with transaction safety and database selection
  - `create_table`: Dynamic table creation with column definitions in specified database
  - `insert_entry`: Row insertion with parameterized queries and database selection
  - `update_entry`: Conditional row updates with database selection
  - `delete_entry`: Conditional row deletion with database selection
  - `delete_table`: Complete table removal from specified database
  - `buffer_health_check`: PostgreSQL buffer cache hit rate analysis per database
  - `database_health_check`: Comprehensive database health assessment per database

## Development Commands

```bash
# Build the project
npm run build

# Build and watch for changes
npm run watch

# The build process creates executable files in dist/ with proper permissions
```

## Running the Server

The server supports both single and multiple database configurations:

**Single Database Mode (backward compatible):**
```bash
# After building  
node dist/index.js "postgresql://user:password@host:port/database" 3000
```

**Multiple Database Mode:**
```bash
# Create databases.json configuration file first
node dist/index.js --config databases.json 3000
```

**SSE Transport**: Server runs with Server-Sent Events transport on HTTP endpoints:
- SSE connections: `GET /sse/<sessionId>`
- Message handling: `POST /messages/<sessionId>`
- Health check: `GET /health`

## Database Connection

- **Multi-Database Support**: Handles multiple PostgreSQL databases simultaneously
- **Connection Pooling**: Each database gets its own `pg.Pool` for optimal performance
- **Flexible Configuration**: JSON-based configuration for multiple databases with fallback to single database mode
- **Read-only Transactions**: Queries use explicit `READ ONLY` transactions with rollback
- **Security**: All database operations use parameterized queries for SQL injection prevention
- **Error Handling**: Connection errors and query failures are propagated as MCP tool errors

## MCP Protocol Implementation

- **Resources**: Each table schema is exposed as a resource with MIME type `application/json`
- **Tools**: All database operations follow MCP tool schema with detailed input validation
- **Transport**: Uses stdio transport for communication with MCP clients
- **Error Handling**: Database errors are properly caught and surfaced through the MCP error system

## Database Health Monitoring

The server includes comprehensive PostgreSQL health monitoring capabilities:

- **Buffer Health**: Cache hit rates for indexes and tables with configurable thresholds
- **Index Health**: Invalid and unused index detection with size analysis
- **Connection Health**: Connection pool usage monitoring with limit analysis
- **Vacuum Health**: Transaction ID wraparound monitoring and dead tuple analysis
- **Sequence Health**: Sequence capacity monitoring for overflow prevention
- **Replication Health**: Replica status and lag monitoring for primary servers
- **Constraint Health**: Invalid constraint detection for data integrity

## Code Patterns

- All database operations use try/finally blocks to ensure connection cleanup
- Input validation relies on MCP schema definitions with detailed descriptions
- SQL queries are constructed using parameterized statements to prevent injection
- Tool responses include structured JSON data with success/error indicators
- Health checks use PostgreSQL system catalogs and statistics views
- Modular health check functions allow selective or comprehensive analysis