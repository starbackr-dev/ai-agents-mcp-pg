# Multi-Database PostgreSQL MCP Server Setup

This MCP server now supports connecting to multiple PostgreSQL databases simultaneously. You can run it in two modes:

## Mode 1: Single Database (Backward Compatible)

```bash
# Build first
npm run build

# Run with single database
node src/dist/index.js "postgresql://user:password@localhost:5432/database" 3000
```

## Mode 2: Multiple Databases

### 1. Create Configuration File

Create a `databases.json` file with your database configurations:

```json
{
  "databases": {
    "primary": {
      "name": "Primary Application Database",
      "connectionString": "postgresql://app_user:password@localhost:5432/app_db",
      "description": "Main application database with user data and transactions"
    },
    "analytics": {
      "name": "Analytics Data Warehouse", 
      "connectionString": "postgresql://analytics_user:password@analytics-server:5432/analytics_db",
      "description": "Read-only analytics and reporting database"
    },
    "staging": {
      "name": "Staging Environment",
      "connectionString": "postgresql://staging_user:password@staging-server:5432/staging_db",
      "description": "Staging database for testing"
    }
  },
  "defaultDatabase": "primary"
}
```

### 2. Run with Configuration

```bash
# Build first
npm run build

# Run with multi-database configuration
node src/dist/index.js --config databases.json 3000
```

## Using Multiple Databases

### Available Tools

All tools now accept an optional `database` parameter:

#### 1. List Available Databases
```json
{
  "tool": "list_databases"
}
```

#### 2. Query Specific Database
```json
{
  "tool": "query",
  "arguments": {
    "sql": "SELECT * FROM users LIMIT 10",
    "database": "primary"
  }
}
```

#### 3. Create Table in Specific Database
```json
{
  "tool": "create_table",
  "arguments": {
    "tableName": "test_table",
    "database": "staging",
    "columns": [
      {"name": "id", "type": "SERIAL PRIMARY KEY"},
      {"name": "name", "type": "VARCHAR(255)"}
    ]
  }
}
```

#### 4. Health Check Specific Database
```json
{
  "tool": "database_health_check",
  "arguments": {
    "database": "analytics",
    "health_types": ["connection", "vacuum", "buffer"]
  }
}
```

### Resources

Resources now include database context:

- **Database List**: `postgres://databases` - Lists all configured databases
- **Table Schemas**: `postgres://<database>/<table>/schema` - Schema for specific table in specific database

### Default Database Behavior

- If no `database` parameter is specified, the `defaultDatabase` from config is used
- In single database mode, all operations use the single configured database

## Production Deployment

### 1. SystemD Service for Multi-Database

Update the service file to use configuration mode:

```ini
[Unit]
Description=MCP PostgreSQL Multi-Database Server
Documentation=https://modelcontextprotocol.io
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=mcp-postgres
Group=mcp-postgres
WorkingDirectory=/opt/mcp-postgres
ExecStart=/usr/bin/node /opt/mcp-postgres/src/dist/index.js --config /opt/mcp-postgres/databases.json 3000
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcp-postgres-multi

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/mcp-postgres/logs
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

### 2. Secure Configuration

```bash
# Create secure configuration directory
sudo mkdir -p /opt/mcp-postgres/config
sudo chown mcp-postgres:mcp-postgres /opt/mcp-postgres/config
sudo chmod 750 /opt/mcp-postgres/config

# Create configuration file
sudo -u mcp-postgres tee /opt/mcp-postgres/config/databases.json << 'EOF'
{
  "databases": {
    "production": {
      "name": "Production Database",
      "connectionString": "postgresql://prod_user:secure_password@db-server:5432/prod_db",
      "description": "Production application database"
    },
    "readonly": {
      "name": "Read-Only Replica",
      "connectionString": "postgresql://readonly_user:readonly_pass@replica-server:5432/prod_db",
      "description": "Read-only database replica for reporting"
    }
  },
  "defaultDatabase": "production"
}
EOF

# Secure the configuration file
sudo chmod 600 /opt/mcp-postgres/config/databases.json
```

## Configuration Examples

### Development Setup
```json
{
  "databases": {
    "dev": {
      "name": "Development Database",
      "connectionString": "postgresql://dev_user:dev_pass@localhost:5432/dev_db",
      "description": "Local development database"
    },
    "test": {
      "name": "Test Database", 
      "connectionString": "postgresql://test_user:test_pass@localhost:5432/test_db",
      "description": "Testing database"
    }
  },
  "defaultDatabase": "dev"
}
```

### Multi-Environment Setup
```json
{
  "databases": {
    "production": {
      "name": "Production",
      "connectionString": "postgresql://prod_user:prod_pass@prod-server:5432/app_db",
      "description": "Production environment"
    },
    "staging": {
      "name": "Staging",
      "connectionString": "postgresql://stage_user:stage_pass@staging-server:5432/app_db", 
      "description": "Staging environment"
    },
    "analytics": {
      "name": "Analytics Warehouse",
      "connectionString": "postgresql://analytics_user:analytics_pass@warehouse:5432/analytics_db",
      "description": "Data warehouse for analytics"
    }
  },
  "defaultDatabase": "production"
}
```

### Read/Write Separation
```json
{
  "databases": {
    "master": {
      "name": "Master (Read/Write)",
      "connectionString": "postgresql://rw_user:rw_pass@master-db:5432/app_db",
      "description": "Master database for read/write operations"
    },
    "replica": {
      "name": "Replica (Read-Only)",
      "connectionString": "postgresql://ro_user:ro_pass@replica-db:5432/app_db",
      "description": "Read replica for queries and reporting"
    }
  },
  "defaultDatabase": "master"
}
```

## Health Monitoring

Multi-database health monitoring provides insights across all configured databases:

### Per-Database Health Checks
```json
{
  "tool": "database_health_check",
  "arguments": {
    "database": "analytics",
    "health_types": ["all"]
  }
}
```

### Connection Pool Monitoring
Each database maintains its own connection pool. Monitor them individually:

```json
{
  "tool": "database_health_check", 
  "arguments": {
    "database": "primary",
    "health_types": ["connection"]
  }
}
```

## Best Practices

1. **Database Naming**: Use descriptive database IDs (`primary`, `analytics`, `staging` vs `db1`, `db2`)

2. **Connection Pooling**: Each database gets its own connection pool for optimal performance

3. **Security**: Store sensitive configuration files with restricted permissions (600)

4. **Monitoring**: Regularly check health across all configured databases

5. **Default Database**: Choose the most commonly used database as the default

6. **Resource Management**: Consider the total connection load across all databases

This multi-database setup enables flexible data access patterns while maintaining the security and performance benefits of the MCP protocol.