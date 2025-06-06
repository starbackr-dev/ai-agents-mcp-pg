#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Database configuration interface
interface DatabaseConfig {
  name: string;
  connectionString: string;
  description?: string;
}

interface DatabasesConfig {
  databases: Record<string, DatabaseConfig>;
  defaultDatabase: string;
}

// Global database pools and configuration
const databasePools = new Map<string, pg.Pool>();
const databaseConfigs = new Map<string, DatabaseConfig>();
let defaultDatabaseId: string;

// Initialize the server
const server = new Server(
  {
    name: "example-servers/postgres",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

const args = process.argv.slice(2);

// Parse command line arguments
let port: number;
let configMode = false;

if (args.length === 0) {
  console.error("Usage:");
  console.error("  Single database: node index.js <database_url> <port>");
  console.error("  Multiple databases: node index.js --config <config_file> <port>");
  console.error("Examples:");
  console.error("  node index.js 'postgresql://user:pass@localhost:5432/db' 3000");
  console.error("  node index.js --config databases.json 3000");
  process.exit(1);
}

function initializeDatabases() {
  if (args[0] === '--config') {
    // Multiple database configuration mode
    if (args.length < 3) {
      console.error("Config mode requires: --config <config_file> <port>");
      process.exit(1);
    }
    
    configMode = true;
    const configFile = args[1];
    port = parseInt(args[2], 10);
    
    if (isNaN(port)) {
      console.error("Port must be a valid number");
      process.exit(1);
    }
    
    // Load database configuration
    const configPath = join(process.cwd(), configFile);
    if (!existsSync(configPath)) {
      console.error(`Configuration file not found: ${configPath}`);
      process.exit(1);
    }
    
    try {
      const configData: DatabasesConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      
      if (!configData.databases || Object.keys(configData.databases).length === 0) {
        console.error("No databases configured in config file");
        process.exit(1);
      }
      
      defaultDatabaseId = configData.defaultDatabase;
      if (!configData.databases[defaultDatabaseId]) {
        console.error(`Default database '${defaultDatabaseId}' not found in configuration`);
        process.exit(1);
      }
      
      // Initialize all database pools
      for (const [id, config] of Object.entries(configData.databases)) {
        databaseConfigs.set(id, config);
        const pool = new pg.Pool({ connectionString: config.connectionString });
        databasePools.set(id, pool);
        console.log(`Initialized database pool: ${id} (${config.name})`);
      }
      
    } catch (error) {
      console.error(`Error loading configuration: ${error}`);
      process.exit(1);
    }
    
  } else {
    // Single database mode (backward compatibility)
    if (args.length < 2) {
      console.error("Single database mode requires: <database_url> <port>");
      process.exit(1);
    }
    
    const databaseUrl = args[0];
    port = parseInt(args[1], 10);
    
    if (isNaN(port)) {
      console.error("Port must be a valid number");
      process.exit(1);
    }
    
    // Set up single database
    defaultDatabaseId = 'default';
    const config: DatabaseConfig = {
      name: 'Default Database',
      connectionString: databaseUrl,
      description: 'Single database configuration'
    };
    
    databaseConfigs.set('default', config);
    const pool = new pg.Pool({ connectionString: databaseUrl });
    databasePools.set('default', pool);
    console.log(`Initialized single database: ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
  }
}

// Initialize databases
initializeDatabases();

// Helper function to get database pool
function getDatabasePool(databaseId?: string): pg.Pool {
  const dbId = databaseId || defaultDatabaseId;
  const pool = databasePools.get(dbId);
  if (!pool) {
    throw new Error(`Database '${dbId}' not found`);
  }
  return pool;
}

// Helper function to get database config
function getDatabaseConfig(databaseId?: string): DatabaseConfig {
  const dbId = databaseId || defaultDatabaseId;
  const config = databaseConfigs.get(dbId);
  if (!config) {
    throw new Error(`Database configuration '${dbId}' not found`);
  }
  return config;
}

// Helper function to list available databases
function listDatabases(): Array<{id: string, name: string, description?: string}> {
  return Array.from(databaseConfigs.entries()).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description
  }));
}


const SCHEMA_PATH = "schema";

// Buffer health calculation functions
async function calculateIndexCacheHitRate(threshold: number = 0.95, databaseId?: string): Promise<string> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT (sum(idx_blks_hit)) / nullif(sum(idx_blks_hit + idx_blks_read), 0) AS rate FROM pg_statio_user_indexes"
    );
    
    if (!result.rows || result.rows.length === 0 || result.rows[0].rate === null) {
      return "No index statistics available";
    }
    
    const rate = parseFloat(result.rows[0].rate);
    const percentage = (rate * 100).toFixed(2);
    
    if (rate >= threshold) {
      return `Index cache hit rate: ${percentage}% (Good - above ${(threshold * 100)}% threshold)`;
    } else {
      return `Index cache hit rate: ${percentage}% (Poor - below ${(threshold * 100)}% threshold)`;
    }
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function calculateTableCacheHitRate(threshold: number = 0.95, databaseId?: string): Promise<string> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0) AS rate FROM pg_statio_user_tables"
    );
    
    if (!result.rows || result.rows.length === 0 || result.rows[0].rate === null) {
      return "No table statistics available";
    }
    
    const rate = parseFloat(result.rows[0].rate);
    const percentage = (rate * 100).toFixed(2);
    
    if (rate >= threshold) {
      return `Table cache hit rate: ${percentage}% (Good - above ${(threshold * 100)}% threshold)`;
    } else {
      return `Table cache hit rate: ${percentage}% (Poor - below ${(threshold * 100)}% threshold)`;
    }
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

// Comprehensive database health check functions
async function checkIndexHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Invalid indexes check
    const invalidIndexes = await client.query(`
      SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
      FROM pg_stat_user_indexes i
      JOIN pg_index idx ON i.indexrelid = idx.indexrelid
      WHERE NOT idx.indisvalid
    `);
    
    if (invalidIndexes.rows.length > 0) {
      results.push(`Invalid indexes found: ${invalidIndexes.rows.length}`);
      invalidIndexes.rows.forEach(row => {
        results.push(`  - ${row.schemaname}.${row.tablename}.${row.indexname} (${row.size})`);
      });
    } else {
      results.push("✓ No invalid indexes found");
    }
    
    // Unused indexes check
    const unusedIndexes = await client.query(`
      SELECT schemaname, tablename, indexname, 
             idx_tup_read, idx_tup_fetch,
             pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
      FROM pg_stat_user_indexes i
      WHERE idx_tup_read = 0 AND idx_tup_fetch = 0
      AND pg_relation_size(i.indexrelid) > 1024*1024  -- Only show indexes > 1MB
    `);
    
    if (unusedIndexes.rows.length > 0) {
      results.push(`Unused indexes found: ${unusedIndexes.rows.length}`);
      unusedIndexes.rows.forEach(row => {
        results.push(`  - ${row.schemaname}.${row.tablename}.${row.indexname} (${row.size})`);
      });
    } else {
      results.push("✓ No significant unused indexes found");
    }
    
  } catch (error) {
    results.push(`Index health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function checkConnectionHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Connection count and limits
    const connStats = await client.query(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `);
    
    const maxConn = await client.query('SHOW max_connections');
    const maxConnections = parseInt(maxConn.rows[0].max_connections);
    const currentConn = connStats.rows[0];
    
    results.push(`Connections: ${currentConn.total_connections}/${maxConnections} (${((currentConn.total_connections/maxConnections)*100).toFixed(1)}%)`);
    results.push(`  - Active: ${currentConn.active_connections}`);
    results.push(`  - Idle: ${currentConn.idle_connections}`);
    results.push(`  - Idle in transaction: ${currentConn.idle_in_transaction}`);
    
    if (currentConn.total_connections / maxConnections > 0.8) {
      results.push("⚠ Warning: Connection usage above 80%");
    } else {
      results.push("✓ Connection usage healthy");
    }
    
  } catch (error) {
    results.push(`Connection health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function checkVacuumHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Transaction ID wraparound check
    const txidInfo = await client.query(`
      SELECT 
        datname,
        age(datfrozenxid) as age,
        2^31 - age(datfrozenxid) as remaining_txids
      FROM pg_database 
      WHERE datname = current_database()
    `);
    
    const txidAge = txidInfo.rows[0].age;
    const remaining = txidInfo.rows[0].remaining_txids;
    
    results.push(`Transaction ID age: ${txidAge.toLocaleString()}`);
    results.push(`Remaining before wraparound: ${remaining.toLocaleString()}`);
    
    if (txidAge > 1500000000) {
      results.push("🚨 Critical: Transaction ID wraparound danger!");
    } else if (txidAge > 1000000000) {
      results.push("⚠ Warning: Transaction ID getting high");
    } else {
      results.push("✓ Transaction ID age healthy");
    }
    
    // Tables needing vacuum
    const vacuumNeeded = await client.query(`
      SELECT schemaname, tablename, 
             n_dead_tup, n_tup_upd + n_tup_del as total_changes,
             last_vacuum, last_autovacuum
      FROM pg_stat_user_tables 
      WHERE n_dead_tup > 1000
      ORDER BY n_dead_tup DESC 
      LIMIT 5
    `);
    
    if (vacuumNeeded.rows.length > 0) {
      results.push(`Tables with high dead tuples: ${vacuumNeeded.rows.length}`);
      vacuumNeeded.rows.forEach(row => {
        results.push(`  - ${row.schemaname}.${row.tablename}: ${row.n_dead_tup} dead tuples`);
      });
    } else {
      results.push("✓ No tables with excessive dead tuples");
    }
    
  } catch (error) {
    results.push(`Vacuum health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function checkSequenceHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Check sequences approaching limits
    const seqCheck = await client.query(`
      SELECT schemaname, sequencename, last_value, max_value,
             ROUND((last_value::numeric / max_value::numeric) * 100, 2) as percent_used
      FROM pg_sequences 
      WHERE last_value::numeric / max_value::numeric > 0.8
    `);
    
    if (seqCheck.rows.length > 0) {
      results.push(`Sequences approaching limits: ${seqCheck.rows.length}`);
      seqCheck.rows.forEach(row => {
        results.push(`  - ${row.schemaname}.${row.sequencename}: ${row.percent_used}% used`);
      });
    } else {
      results.push("✓ All sequences have adequate remaining capacity");
    }
    
  } catch (error) {
    results.push(`Sequence health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function checkReplicationHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Check if this is a primary server with replicas
    const replicationInfo = await client.query(`
      SELECT application_name, client_addr, state, 
             pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn) as send_lag_bytes,
             pg_wal_lsn_diff(sent_lsn, write_lsn) as write_lag_bytes,
             pg_wal_lsn_diff(write_lsn, flush_lsn) as flush_lag_bytes
      FROM pg_stat_replication
    `);
    
    if (replicationInfo.rows.length === 0) {
      results.push("No replication replicas detected (standalone or replica server)");
    } else {
      results.push(`Replication replicas: ${replicationInfo.rows.length}`);
      replicationInfo.rows.forEach(row => {
        results.push(`  - ${row.application_name || 'Unknown'} (${row.client_addr}): ${row.state}`);
        if (row.send_lag_bytes > 0) {
          results.push(`    Send lag: ${row.send_lag_bytes} bytes`);
        }
      });
    }
    
  } catch (error) {
    results.push(`Replication health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function checkConstraintHealth(databaseId?: string): Promise<string[]> {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  const results: string[] = [];
  
  try {
    // Check for invalid constraints
    const invalidConstraints = await client.query(`
      SELECT schemaname, tablename, constraintname, constrainttype
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE NOT c.convalidated AND c.contype IN ('c', 'f')  -- check and foreign key constraints
    `);
    
    if (invalidConstraints.rows.length > 0) {
      results.push(`Invalid constraints found: ${invalidConstraints.rows.length}`);
      invalidConstraints.rows.forEach(row => {
        const type = row.constrainttype === 'c' ? 'CHECK' : 'FOREIGN KEY';
        results.push(`  - ${row.schemaname}.${row.tablename}.${row.constraintname} (${type})`);
      });
    } else {
      results.push("✓ All constraints are valid");
    }
    
  } catch (error) {
    results.push(`Constraint health check error: ${error}`);
  } finally {
    client.release();
  }
  
  return results;
}

async function performDatabaseHealthCheck(healthTypes: string[], databaseId?: string): Promise<string> {
  const dbConfig = getDatabaseConfig(databaseId);
  const dbId = databaseId || defaultDatabaseId;
  const allResults: string[] = [];
  const timestamp = new Date().toISOString();
  
  allResults.push("=== PostgreSQL Database Health Report ===");
  allResults.push(`Database: ${dbConfig.name} (${dbId})`);
  allResults.push(`Generated at: ${timestamp}`);
  allResults.push("");
  
  // Normalize health types
  const normalizedTypes = healthTypes.includes('all') 
    ? ['index', 'connection', 'vacuum', 'sequence', 'replication', 'buffer', 'constraint']
    : healthTypes;
  
  for (const healthType of normalizedTypes) {
    allResults.push(`--- ${healthType.toUpperCase()} HEALTH ---`);
    
    try {
      let healthResults: string[] = [];
      
      switch (healthType.toLowerCase()) {
        case 'index':
          healthResults = await checkIndexHealth(databaseId);
          break;
        case 'connection':
          healthResults = await checkConnectionHealth(databaseId);
          break;
        case 'vacuum':
          healthResults = await checkVacuumHealth(databaseId);
          break;
        case 'sequence':
          healthResults = await checkSequenceHealth(databaseId);
          break;
        case 'replication':
          healthResults = await checkReplicationHealth(databaseId);
          break;
        case 'buffer':
          const indexHealth = await calculateIndexCacheHitRate(0.95, databaseId);
          const tableHealth = await calculateTableCacheHitRate(0.95, databaseId);
          healthResults = [indexHealth, tableHealth];
          break;
        case 'constraint':
          healthResults = await checkConstraintHealth(databaseId);
          break;
        default:
          healthResults = [`Unknown health check type: ${healthType}`];
      }
      
      allResults.push(...healthResults);
      
    } catch (error) {
      allResults.push(`Error running ${healthType} health check: ${error}`);
    }
    
    allResults.push("");
  }
  
  return allResults.join("\n");
}

// Debug Insert for testing purposes
async function insertDebugEntry(databaseId?: string) {
  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  try {

    // Example insert query into `example_table`
    const result = await client.query(
      "INSERT INTO users (name, email, age) VALUES ($1, $2, $3) RETURNING id",
      ["sample1", "sample1@gmail.com", 30],
    );

  } catch (error) {
  } finally {
    client.release();
  }
}

// List resources handler - provides information about all available database tables
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const allResources: any[] = [];
  
  // Add database list resource
  allResources.push({
    uri: "postgres://databases",
    mimeType: "application/json",
    name: "Available Databases",
    description: "List of all configured databases and their information"
  });
  
  // Add table resources for each database
  for (const [dbId, dbConfig] of databaseConfigs.entries()) {
    try {
      const pool = getDatabasePool(dbId);
      const client = await pool.connect();
      
      try {
        const result = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        );
        
        result.rows.forEach((row) => {
          allResources.push({
            uri: `postgres://${dbId}/${row.table_name}/${SCHEMA_PATH}`,
            mimeType: "application/json",
            name: `"${row.table_name}" schema (${dbConfig.name})`,
            description: `Schema information for the "${row.table_name}" table in ${dbConfig.name}. Use this to understand the table structure before querying or modifying it.`,
          });
        });
        
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`Error listing tables for database ${dbId}:`, error);
    }
  }
  
  return { resources: allResources };
});

// Read resource handler - retrieves detailed schema information for a specific table
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);

  // Handle databases list resource
  if (resourceUrl.pathname === "/databases") {
    const databases = listDatabases();
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(databases, null, 2),
        },
      ],
    };
  }

  // Handle table schema resources
  const pathComponents = resourceUrl.pathname.split("/").filter(p => p);
  if (pathComponents.length !== 3) {
    throw new Error("Invalid resource URI - expected format: postgres://<database>/<table>/schema");
  }

  const [databaseId, tableName, schema] = pathComponents;

  if (schema !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI - must end with '/schema' to retrieve table schema information");
  }

  if (!databaseConfigs.has(databaseId)) {
    throw new Error(`Database '${databaseId}' not found`);
  }

  const pool = getDatabasePool(databaseId);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
      [tableName],
    );

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(result.rows, null, 2),
        },
      ],
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
});

// Helper function to add database parameter to tool properties
function addDatabaseParameter(properties: any) {
  return {
    ...properties,
    database: {
      type: "string",
      description: `Database to operate on. Available databases: ${Array.from(databaseConfigs.keys()).join(', ')}. Defaults to '${defaultDatabaseId}' if not specified.`
    }
  };
}

// This handler returns the list of tools that the server supports
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_databases",
        description: "List all available databases and their configurations. Use this to see which databases are accessible and their descriptions.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "query",
        description: "Run a read-only SQL query against the PostgreSQL database and return the results as JSON. Use this tool to retrieve data without modifying the database. Only SELECT statements and other non-modifying operations are allowed. Example: Query all users with age greater than 18.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            sql: { 
              type: "string",
              description: "The SQL query to execute. Must be a SELECT statement or other read-only operation. Example: 'SELECT * FROM users WHERE age > 18'"
            },
          }),
          required: ["sql"],
        },
      },
      {
        name: "create_table",
        description: "Create a new table in the PostgreSQL database with specified columns and data types. Use this tool to define new database tables with custom schemas. Example: Create a users table with id, name, email, and created_at columns.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            tableName: { 
              type: "string",
              description: "Name for the new table. Should follow SQL naming conventions (letters, numbers, underscores). Example: 'users' or 'product_inventory'"
            },
            columns: {
              type: "array",
              description: "List of column definitions for the table, each with a name and PostgreSQL data type. Example: [{\"name\": \"id\", \"type\": \"SERIAL PRIMARY KEY\"}, {\"name\": \"name\", \"type\": \"VARCHAR(255)\"}, {\"name\": \"email\", \"type\": \"TEXT\"}, {\"name\": \"created_at\", \"type\": \"TIMESTAMP\"}]",
              items: {
                type: "object",
                properties: {
                  name: { 
                    type: "string",
                    description: "Column name. Should follow SQL naming conventions. Example: 'user_id' or 'email_address'"
                  },
                  type: { 
                    type: "string",
                    description: "PostgreSQL data type for this column. Examples: 'INTEGER', 'TEXT', 'VARCHAR(255)', 'TIMESTAMP', 'BOOLEAN', 'SERIAL PRIMARY KEY'"
                  },
                },
                required: ["name", "type"],
              },
            },
          }),
          required: ["tableName", "columns"],
        },
      },
      {
        name: "insert_entry",
        description: "Insert a new row/record into an existing table in the PostgreSQL database. Use this tool to add data to your tables. Example: Add a new user with name 'John Doe', email 'john@example.com', and age 30 to the users table.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            tableName: { 
              type: "string",
              description: "Name of the existing table to insert data into. Example: 'users'"
            },
            values: {
              type: "object",
              description: "Key-value pairs where keys are column names and values are the data to insert. All values are passed as strings and converted to appropriate types by PostgreSQL. Example: {\"name\": \"John Doe\", \"email\": \"john@example.com\", \"age\": \"30\"}",
              additionalProperties: { 
                type: "string",
                description: "String representation of the value to insert. Will be converted to the appropriate type by PostgreSQL."
              },
            },
          }),
          required: ["tableName", "values"],
        },
      },
      {
        name: "delete_table",
        description: "Permanently delete/drop an entire table from the PostgreSQL database, including all its data. Use with caution as this operation cannot be undone. Example: Delete a temporary_logs table that is no longer needed.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            tableName: { 
              type: "string",
              description: "Name of the table to delete. This operation cannot be undone. Example: 'temporary_logs'"
            },
          }),
          required: ["tableName"],
        },
      },
      {
        name: "update_entry",
        description: "Update existing rows in a PostgreSQL table that match specified conditions. Use this tool to modify data that already exists in the database. Example: Update the status to 'active' and last_login to current date for user with ID 42.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            tableName: { 
              type: "string",
              description: "Name of the table containing records to update. Example: 'users'"
            },
            values: {
              type: "object",
              description: "Key-value pairs of columns to update and their new values. Example: {\"status\": \"active\", \"last_login\": \"2025-03-23\"}",
              additionalProperties: { 
                type: "string",
                description: "String representation of the new value. Will be converted to the appropriate type by PostgreSQL."
              },
            },
            conditions: {
              type: "object",
              description: "Key-value pairs that specify which rows to update (WHERE clause conditions). Only rows matching ALL conditions will be updated. Example: {\"user_id\": \"42\", \"status\": \"pending\"}",
              additionalProperties: { 
                type: "string",
                description: "String representation of the condition value. Will be compared using equality (=) operator."
              },
            },
          }),
          required: ["tableName", "values", "conditions"],
        },
      },
      {
        name: "delete_entry",
        description: "Delete rows/records from a PostgreSQL table that match specified conditions. Use this tool to remove data from your database tables. Example: Delete all inactive users or users who haven't logged in since January 1, 2024.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            tableName: { 
              type: "string",
              description: "Name of the table to delete records from. Example: 'users'"
            },
            conditions: {
              type: "object",
              description: "Key-value pairs that specify which rows to delete (WHERE clause conditions). Only rows matching ALL conditions will be deleted. Example: {\"status\": \"inactive\", \"last_login_before\": \"2024-01-01\"}",
              additionalProperties: { 
                type: "string",
                description: "String representation of the condition value. Will be compared using equality (=) operator."
              },
            },
          }),
          required: ["tableName", "conditions"],
        },
      },
      {
        name: "buffer_health_check",
        description: "Analyze PostgreSQL buffer cache health by calculating index and table cache hit rates. This helps identify memory efficiency and potential performance issues. Returns detailed analysis of both index and table buffer performance with threshold comparisons.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            threshold: {
              type: "number",
              description: "Cache hit rate threshold for determining good vs poor performance (0.0 to 1.0). Default is 0.95 (95%). Example: 0.90 for 90% threshold",
              minimum: 0.0,
              maximum: 1.0,
              default: 0.95
            },
          }),
        },
      },
      {
        name: "database_health_check",
        description: "Perform comprehensive PostgreSQL database health analysis across multiple dimensions including indexes, connections, vacuum status, sequences, replication, buffer cache, and constraints. Supports selective health checks or full analysis.",
        inputSchema: {
          type: "object",
          properties: addDatabaseParameter({
            health_types: {
              type: "array",
              description: "List of health check types to perform. Available options: 'index', 'connection', 'vacuum', 'sequence', 'replication', 'buffer', 'constraint', 'all'. Default is ['all'] to run all checks.",
              items: {
                type: "string",
                enum: ["index", "connection", "vacuum", "sequence", "replication", "buffer", "constraint", "all"]
              },
              default: ["all"]
            },
          }),
        },
      },
    ],
  };
});

// Call tool handler for SQL operations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "list_databases") {
    const databases = listDatabases();
    return {
      content: [{ type: "text", text: JSON.stringify(databases, null, 2) }],
      isError: false,
    };
  }

  if (request.params.name === "query") {
    const sql = request.params.arguments?.sql as string;
    const databaseId = request.params.arguments?.database as string;

    const pool = getDatabasePool(databaseId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(sql);

      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  if (request.params.name === "create_table") {
    const { tableName, columns, database } = request.params.arguments as {
      tableName: string;
      columns: { name: string; type: string }[];
      database?: string;
    };

    const columnDefinitions = columns
      .map((col) => `${col.name} ${col.type}`)
      .join(", ");

    const pool = getDatabasePool(database);
    const client = await pool.connect();
    try {
      const createTableQuery = `CREATE TABLE ${tableName} (${columnDefinitions})`;
      await client.query(createTableQuery);

      return {
        content: [
          {
            type: "text",
            text: `Table "${tableName}" created successfully with columns: ${columns
              .map((col) => `${col.name} (${col.type})`)
              .join(", ")}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.params.name === "insert_entry") {
    const { tableName, values, database } = request.params.arguments as {
      tableName: string;
      values: Record<string, string>;
      database?: string;
    };

    const columns = Object.keys(values).join(", ");
    const placeholders = Object.keys(values)
      .map((_, index) => `$${index + 1}`)
      .join(", ");
    const valuesArray = Object.values(values);

    const pool = getDatabasePool(database);
    const client = await pool.connect();
    try {
      const insertQuery = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) RETURNING *`;
      const result = await client.query(insertQuery, valuesArray);

      return {
        content: [
          {
            type: "text",
            text: `Inserted into table "${tableName}": ${JSON.stringify(
              result.rows[0],
              null,
              2
            )}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.params.name === "delete_table") {
    const { tableName, database } = request.params.arguments as {
      tableName: string;
      database?: string;
    };

    const pool = getDatabasePool(database);
    const client = await pool.connect();
    try {
      const deleteTableQuery = `DROP TABLE IF EXISTS ${tableName}`;
      await client.query(deleteTableQuery);
      return {
        content: [
          {
            type: "text",
            text: `Table "${tableName}" deleted successfully`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.params.name === "update_entry") {
    const { tableName, values, conditions, database } = request.params.arguments as {
      tableName: string;
      values: Record<string, string>;
      conditions: Record<string, string>;
      database?: string;
    };

    const setClauses = Object.entries(values)
      .map(([key, _], index) => `${key} = $${index + 1}`)
      .join(", ");
    const whereClauses = Object.entries(conditions)
      .map(([key, _], index) => `${key} = $${Object.keys(values).length + index + 1}`)
      .join(" AND ");
    const queryParams = [...Object.values(values), ...Object.values(conditions)];

    const pool = getDatabasePool(database);
    const client = await pool.connect();
    try {
      const updateQuery = `UPDATE ${tableName} SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
      const result = await client.query(updateQuery, queryParams);

      return {
        content: [
          {
            type: "text",
            text: `Updated entry in table "${tableName}": ${JSON.stringify(result.rows, null, 2)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.params.name === "delete_entry") {
    const { tableName, conditions, database } = request.params.arguments as {
      tableName: string;
      conditions: Record<string, string>;
      database?: string;
    };

    const whereClauses = Object.entries(conditions)
      .map(([key, _], index) => `${key} = $${index + 1}`)
      .join(" AND ");
    const queryParams = Object.values(conditions);

    const pool = getDatabasePool(database);
    const client = await pool.connect();
    try {
      const deleteQuery = `DELETE FROM ${tableName} WHERE ${whereClauses} RETURNING *`;
      const result = await client.query(deleteQuery, queryParams);

      return {
        content: [
          {
            type: "text",
            text: `Deleted entry from table "${tableName}": ${JSON.stringify(result.rows, null, 2)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.params.name === "buffer_health_check") {
    const threshold = (request.params.arguments?.threshold as number) ?? 0.95;
    const database = request.params.arguments?.database as string;

    try {
      const indexHealth = await calculateIndexCacheHitRate(threshold, database);
      const tableHealth = await calculateTableCacheHitRate(threshold, database);

      return {
        content: [
          {
            type: "text",
            text: `PostgreSQL Buffer Health Analysis:\n\n${indexHealth}\n${tableHealth}\n\nAnalysis completed at: ${new Date().toISOString()}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    }
  }

  if (request.params.name === "database_health_check") {
    const healthTypes = (request.params.arguments?.health_types as string[]) ?? ["all"];
    const database = request.params.arguments?.database as string;

    try {
      const healthReport = await performDatabaseHealthCheck(healthTypes, database);

      return {
        content: [
          {
            type: "text",
            text: healthReport,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw error;
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Run the server
async function runServer() {
  const app = express();
  
  // Parse JSON bodies
  app.use(express.json());
  
  // Store SSE transports by session ID
  const transports = new Map<string, SSEServerTransport>();
  
  // SSE endpoint for establishing connections
  app.get('/sse/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    
    const transport = new SSEServerTransport(`/messages/${sessionId}`, res);
    transports.set(sessionId, transport);
    
    // Handle transport close
    res.on('close', () => {
      transports.delete(sessionId);
    });
    
    // Connect the server to this transport (this automatically starts the transport)
    server.connect(transport).catch(console.error);
  });
  
  // POST endpoint for receiving messages
  app.post('/messages/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const transport = transports.get(sessionId);
    
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    try {
      await transport.handlePostMessage(req, res);
    } catch (error) {
      console.error('Error handling message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Start the HTTP server
  app.listen(port, () => {
    console.log(`MCP PostgreSQL server running on port ${port}`);
    console.log(`SSE endpoint: http://localhost:${port}/sse/<sessionId>`);
    console.log(`Messages endpoint: http://localhost:${port}/messages/<sessionId>`);
    console.log(`Health check: http://localhost:${port}/health`);
    if (configMode) {
      console.log(`Connected to ${databaseConfigs.size} databases:`);
      for (const [id, config] of databaseConfigs.entries()) {
        const maskedUrl = config.connectionString.replace(/:[^:@]*@/, ':***@');
        console.log(`  - ${id}: ${config.name} (${maskedUrl})`);
      }
    } else {
      const config = getDatabaseConfig();
      const maskedUrl = config.connectionString.replace(/:[^:@]*@/, ':***@');
      console.log(`Connected to database: ${maskedUrl}`);
    }
  });
}

runServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
