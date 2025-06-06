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

## Connecting LLMs and Claude Desktop

### Claude Desktop Configuration

To connect Claude Desktop to this MCP PostgreSQL server, add the following configuration to your Claude Desktop MCP settings:

#### Single Database Mode
```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/path/to/ai-agents-mcp-pg/src/dist/index.js", "postgresql://user:password@localhost:5432/database", "3000"],
      "env": {}
    }
  }
}
```

#### Multiple Database Mode
```json
{
  "mcpServers": {
    "postgres-multi": {
      "command": "node", 
      "args": ["/path/to/ai-agents-mcp-pg/src/dist/index.js", "--config", "/path/to/databases.json", "3000"],
      "env": {}
    }
  }
}
```

### Remote Server Connection (SSE)

When the MCP server is running on a remote server, use Server-Sent Events (SSE) transport for connection:

#### Claude Desktop Configuration for Remote Server
```json
{
  "mcpServers": {
    "postgres-remote": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse", "http://your-server.com:3000/sse"],
      "env": {}
    }
  }
}
```

#### Starting MCP Server with SSE Support

On your remote server, start the MCP server with SSE enabled:

```bash
# Single database mode with SSE
node src/dist/index.js "postgresql://user:password@localhost:5432/database" 3000 --transport=sse

# Multi-database mode with SSE  
node src/dist/index.js --config databases.json 3000 --transport=sse
```

#### Connection Details for Remote Access
- **Protocol**: MCP over SSE (Server-Sent Events)
- **URL**: `http://your-server.com:3000/sse`
- **Transport**: SSE
- **Authentication**: Optional (configure as needed)

### Local Connection (stdio)

For local connections, use stdio transport:

#### Connection Details
- **Protocol**: MCP (Model Context Protocol)
- **Host**: localhost
- **Port**: 3000 (or your configured port)
- **Transport**: stdio (standard input/output)

#### Example for MCP Client Libraries

**Local Connection (stdio):**
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/ai-agents-mcp-pg/src/dist/index.js', '--config', '/path/to/databases.json', '3000']
});

const client = new Client({
  name: "postgres-client",
  version: "1.0.0"
}, {
  capabilities: {}
});

await client.connect(transport);
```

**Remote Connection (SSE):**
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport(
  new URL('http://your-server.com:3000/sse')
);

const client = new Client({
  name: "postgres-remote-client", 
  version: "1.0.0"
}, {
  capabilities: {}
});

await client.connect(transport);
```

### Setup Steps

1. **Build the MCP Server**:
   ```bash
   cd /path/to/ai-agents-mcp-pg
   npm run build
   ```

2. **Create Database Configuration** (for multi-database mode):
   Create your `databases.json` file with your database connections.

3. **Test Connection**:
   ```bash
   # Local connection tests
   node src/dist/index.js "postgresql://user:password@localhost:5432/database" 3000
   node src/dist/index.js --config databases.json 3000
   
   # Remote server tests (with SSE)
   node src/dist/index.js "postgresql://user:password@localhost:5432/database" 3000 --transport=sse
   node src/dist/index.js --config databases.json 3000 --transport=sse
   ```

4. **Configure Your LLM Client**:
   Add the MCP server configuration to your LLM client (Claude Desktop, etc.)

5. **Restart Your LLM Client**:
   Restart Claude Desktop or your LLM client to load the new MCP server configuration.

### Available Capabilities

Once connected, your LLM will have access to:

- **Database Operations**: Query, insert, update, delete data across all configured databases
- **Schema Management**: Create/modify tables, indexes, and database structures  
- **Health Monitoring**: Check database performance and connection status
- **Multi-Database Support**: Switch between different databases seamlessly
- **Security**: All operations respect PostgreSQL permissions and connection security

### Production Deployment for Remote Access

#### Reverse Proxy Configuration (Nginx)

For production deployments, use a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-mcp-server.com;
    
    location /sse {
        proxy_pass http://localhost:3000/sse;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE specific settings
        proxy_buffering off;
        proxy_read_timeout 24h;
    }
}
```

#### SSL/HTTPS Configuration

For secure connections, configure SSL:

```nginx
server {
    listen 443 ssl;
    server_name your-mcp-server.com;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location /sse {
        proxy_pass http://localhost:3000/sse;
        # ... same proxy settings as above
    }
}
```

Update Claude Desktop configuration for HTTPS:
```json
{
  "mcpServers": {
    "postgres-secure": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse", "https://your-mcp-server.com/sse"],
      "env": {}
    }
  }
}
```

#### Firewall Configuration

Open the necessary ports:
```bash
# Allow HTTP/HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443

# Allow direct MCP port (if not using reverse proxy)
sudo ufw allow 3000
```

### Troubleshooting Connection Issues

#### Local Connections (stdio)
1. **Build Issues**: Ensure `npm run build` completes successfully
2. **Database Connectivity**: Test your PostgreSQL connections independently
3. **Port Conflicts**: Make sure port 3000 (or your chosen port) is available
4. **Permissions**: Verify file permissions on configuration files
5. **Logs**: Check your LLM client logs for MCP connection errors

#### Remote Connections (SSE)
1. **Network Connectivity**: Verify the remote server is accessible on the specified port
2. **Firewall Rules**: Ensure firewall allows connections on port 3000 (or your configured port)
3. **SSE Support**: Confirm the MCP server is started with `--transport=sse` flag
4. **CORS Issues**: If connecting from browser-based clients, ensure CORS is properly configured
5. **Proxy Configuration**: If using a reverse proxy, verify the proxy configuration is correct
6. **SSL Certificate**: For HTTPS connections, ensure SSL certificates are valid and properly configured
7. **Connection Timeout**: SSE connections may timeout; check proxy and server timeout settings