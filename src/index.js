#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2/promise.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

class MySQLMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mysql-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.connection = null;
    
    // 从环境变量读取默认配置
    this.defaultConfig = {
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: process.env.MYSQL_SSL === 'true' || false,
    };
    
    // 权限控制配置
    this.permissions = {
      allowInsert: process.env.ALLOW_INSERT_OPERATION === 'true' || false,
      allowUpdate: process.env.ALLOW_UPDATE_OPERATION === 'true' || false,
      allowDelete: process.env.ALLOW_DELETE_OPERATION === 'true' || false,
    };
    
    // 版本控制配置
    this.sessionId = randomUUID();
    this.versionDB = null;
    this.initVersionControl();
    
    this.setupToolHandlers();
  }

  async createConnection(overrideConfig = {}) {
    if (this.connection) {
      await this.connection.end();
    }
    
    // 合并默认配置和传入的配置
    const config = { ...this.defaultConfig, ...overrideConfig };
    
    // 验证必需的参数
    if (!config.user || !config.password || !config.database) {
      throw new Error('Missing required database connection parameters. Please set MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE environment variables, or provide them as parameters.');
    }
    
    this.connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
    });
    
    return this.connection;
  }

  checkQueryPermissions(query) {
    const normalizedQuery = query.trim().toUpperCase();
    
    // 检查是否是危险的DELETE操作
    if (normalizedQuery.startsWith('DELETE') || 
        normalizedQuery.includes('DROP TABLE') || 
        normalizedQuery.includes('DROP DATABASE') ||
        normalizedQuery.includes('TRUNCATE')) {
      if (!this.permissions.allowDelete) {
        throw new Error('DELETE operations are not allowed. Set ALLOW_DELETE_OPERATION=true to enable.');
      }
    }
    
    // 检查是否是UPDATE操作
    if (normalizedQuery.startsWith('UPDATE') || 
        normalizedQuery.includes('ALTER TABLE') ||
        normalizedQuery.includes('MODIFY COLUMN') ||
        normalizedQuery.includes('ADD COLUMN') ||
        normalizedQuery.includes('DROP COLUMN')) {
      if (!this.permissions.allowUpdate) {
        throw new Error('UPDATE operations are not allowed. Set ALLOW_UPDATE_OPERATION=true to enable.');
      }
    }
    
    // 检查是否是INSERT操作
    if (normalizedQuery.startsWith('INSERT') || 
        normalizedQuery.includes('CREATE TABLE') ||
        normalizedQuery.includes('CREATE DATABASE') ||
        normalizedQuery.includes('CREATE INDEX')) {
      if (!this.permissions.allowInsert) {
        throw new Error('INSERT operations are not allowed. Set ALLOW_INSERT_OPERATION=true to enable.');
      }
    }
    
    return true;
  }

  initVersionControl() {
    try {
      this.versionDB = new Database('./mysql_versions.db');
      
      // 创建版本记录表
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS version_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          target_table TEXT,
          sql_query TEXT,
          backup_data TEXT,
          affected_rows INTEGER,
          description TEXT
        )
      `;
      
      this.versionDB.exec(createTableSQL);
    } catch (error) {
      console.error('Failed to initialize version control:', error.message);
    }
  }

  async createBackup(operation, query, targetTable = null, insertResult = null, connection = null) {
    if (!this.permissions.allowInsert && !this.permissions.allowUpdate && !this.permissions.allowDelete) {
      return null; // 如果没有写权限，不需要备份
    }

    let backupData = null;
    let affectedRows = 0;
    let backupInfo = { 
      type: operation,
      sql_query: query // 记录完整的SQL语句
    };

    try {
      if (connection && (operation === 'DELETE' || operation === 'UPDATE')) {
        // DELETE和UPDATE操作：备份即将被影响的数据
        let backupQuery = '';
        
        if (query.toLowerCase().includes('where')) {
          const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
          if (whereMatch) {
            backupQuery = `SELECT * FROM ${targetTable} WHERE ${whereMatch[1]}`;
          }
        } else {
          backupQuery = `SELECT * FROM ${targetTable}`;
        }
        
        if (backupQuery) {
          const [rows] = await connection.execute(backupQuery);
          if (operation === 'DELETE') {
            backupInfo.deletedRows = rows;
          } else {
            backupInfo.originalRows = rows;
          }
          backupData = JSON.stringify(backupInfo);
          affectedRows = rows.length;
        }

      } else if (connection && operation === 'DROP_TABLE') {
        // DROP TABLE操作：备份整个表结构和数据
        const [tableData] = await connection.execute(`SELECT * FROM ${targetTable}`);
        const [tableStructure] = await connection.execute(`SHOW CREATE TABLE ${targetTable}`);
        
        backupInfo.structure = tableStructure[0];
        backupInfo.data = tableData;
        backupData = JSON.stringify(backupInfo);
        affectedRows = tableData.length;
      } else if (operation === 'CREATE_TABLE' || operation === 'INSERT') {
        // CREATE TABLE和INSERT操作：记录操作信息
        if (operation === 'CREATE_TABLE') {
          backupInfo.tableName = targetTable;
          backupInfo.createQuery = query;
          affectedRows = 0;
        } else if (insertResult) {
          backupInfo.insertId = insertResult.insertId;
          backupInfo.insertedRows = insertResult.affectedRows;
          backupInfo.tableName = targetTable;
          
          // 如果有auto_increment ID，记录插入的ID范围
          if (insertResult.insertId) {
            const startId = insertResult.insertId;
            const endId = insertResult.insertId + insertResult.affectedRows - 1;
            backupInfo.idRange = { start: startId, end: endId };
          }
          
          affectedRows = insertResult.affectedRows;
        }
        backupData = JSON.stringify(backupInfo);
      }

      // 记录到版本历史
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -1) + String(process.hrtime.bigint()).slice(-6);
      
      await this.saveVersion({
        sessionId: this.sessionId,
        timestamp,
        operationType: operation,
        targetTable,
        sqlQuery: query,
        backupData,
        affectedRows,
        description: this.getOperationDescription(operation, targetTable, affectedRows)
      });

      return { timestamp, backupData, affectedRows };
    } catch (error) {
      console.error('Backup creation failed:', error.message);
      throw error;
    }
  }

  getOperationDescription(operation, tableName, affectedRows) {
    switch (operation) {
      case 'INSERT':
        return `INSERT operation: ${affectedRows} row(s) inserted into ${tableName}`;
      case 'UPDATE':
        return `UPDATE operation: ${affectedRows} row(s) updated in ${tableName}`;
      case 'DELETE':
        return `DELETE operation: ${affectedRows} row(s) deleted from ${tableName}`;
      case 'CREATE_TABLE':
        return `CREATE TABLE operation: table ${tableName} created`;
      case 'DROP_TABLE':
        return `DROP TABLE operation: table ${tableName} dropped with ${affectedRows} rows`;
      default:
        return `${operation} operation on ${tableName}`;
    }
  }

  saveVersion(versionInfo) {
    try {
      const insertSQL = `
        INSERT INTO version_history 
        (session_id, timestamp, operation_type, target_table, sql_query, backup_data, affected_rows, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.versionDB.prepare(insertSQL);
      const result = stmt.run(
        versionInfo.sessionId,
        versionInfo.timestamp,
        versionInfo.operationType,
        versionInfo.targetTable,
        versionInfo.sqlQuery,
        versionInfo.backupData,
        versionInfo.affectedRows,
        versionInfo.description
      );
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Failed to save version:', error.message);
      throw error;
    }
  }

  extractTableFromQuery(query) {
    const normalizedQuery = query.trim().toUpperCase();
    
    // 匹配不同的SQL操作
    let match;
    
    if (match = normalizedQuery.match(/(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO)\s+([`"]?)(\w+)\1/)) {
      return match[2].toLowerCase();
    }
    
    if (match = normalizedQuery.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"]?)(\w+)\1/)) {
      return match[2].toLowerCase();
    }
    
    if (match = normalizedQuery.match(/TRUNCATE\s+(?:TABLE\s+)?([`"]?)(\w+)\1/)) {
      return match[2].toLowerCase();
    }
    
    return null;
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'mysql_query',
            description: 'Execute a MySQL query and return the results',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The SQL query to execute',
                },
                // 这些参数现在是可选的，可以通过环境变量预设
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['query'],
            },
          },
          {
            name: 'mysql_show_tables',
            description: 'Show all tables in the database',
            inputSchema: {
              type: 'object',
              properties: {
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: [],
            },
          },
          {
            name: 'mysql_describe_table',
            description: 'Describe the structure of a table',
            inputSchema: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  description: 'Table name to describe',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['table'],
            },
          },
          {
            name: 'mysql_show_databases',
            description: 'Show all databases (requires appropriate privileges)',
            inputSchema: {
              type: 'object',
              properties: {
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: [],
            },
          },
          {
            name: 'mysql_table_info',
            description: 'Get detailed information about a table including row count, size, and engine',
            inputSchema: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  description: 'Table name to get information about',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['table'],
            },
          },
          {
            name: 'mysql_show_indexes',
            description: 'Show all indexes for a table',
            inputSchema: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  description: 'Table name to show indexes for',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['table'],
            },
          },
          {
            name: 'mysql_show_processes',
            description: 'Show currently running MySQL processes',
            inputSchema: {
              type: 'object',
              properties: {
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: [],
            },
          },
          {
            name: 'mysql_create_table',
            description: 'Create a new table with specified schema',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the table to create',
                },
                schema: {
                  type: 'string',
                  description: 'CREATE TABLE SQL statement (without CREATE TABLE table_name)',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['table_name', 'schema'],
            },
          },
          {
            name: 'mysql_insert_data',
            description: 'Insert data into a table',
            inputSchema: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  description: 'Table name to insert data into',
                },
                data: {
                  type: 'object',
                  description: 'Data to insert as key-value pairs (column: value)',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['table', 'data'],
            },
          },
          {
            name: 'mysql_database_size',
            description: 'Get the size of the current database',
            inputSchema: {
              type: 'object',
              properties: {
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: [],
            },
          },
          {
            name: 'mysql_explain_query',
            description: 'Analyze query execution plan with EXPLAIN',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'SQL query to explain',
                },
                format: {
                  type: 'string',
                  description: 'Output format: TRADITIONAL, JSON, or TREE (default: TRADITIONAL)',
                  enum: ['TRADITIONAL', 'JSON', 'TREE'],
                  default: 'TRADITIONAL'
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['query'],
            },
          },
          {
            name: 'mysql_list_versions',
            description: 'List all version history with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                operation_type: {
                  type: 'string',
                  description: 'Filter by operation type (INSERT, UPDATE, DELETE, DROP_TABLE, etc.)',
                },
                target_table: {
                  type: 'string',
                  description: 'Filter by target table name',
                },
                session_only: {
                  type: 'boolean',
                  description: 'Show only current session versions (default: true)',
                  default: true
                },
                limit: {
                  type: 'integer',
                  description: 'Limit number of results (default: 50)',
                  default: 50
                }
              },
              required: [],
            },
          },
          {
            name: 'mysql_rollback_to_version',
            description: 'Rollback to a specific version by restoring backed up data',
            inputSchema: {
              type: 'object',
              properties: {
                version_id: {
                  type: 'integer',
                  description: 'Version ID to rollback to',
                },
                host: {
                  type: 'string',
                  description: 'MySQL host (default: from MYSQL_HOST env or localhost)',
                },
                port: {
                  type: 'integer',
                  description: 'MySQL port (default: from MYSQL_PORT env or 3306)',
                },
                user: {
                  type: 'string',
                  description: 'MySQL username (default: from MYSQL_USER env)',
                },
                password: {
                  type: 'string',
                  description: 'MySQL password (default: from MYSQL_PASSWORD env)',
                },
                database: {
                  type: 'string',
                  description: 'Database name (default: from MYSQL_DATABASE env)',
                },
                ssl: {
                  type: 'boolean',
                  description: 'Use SSL connection (default: from MYSQL_SSL env or false)',
                }
              },
              required: ['version_id'],
            },
          },
          {
            name: 'mysql_clear_version_history',
            description: 'Clear version history for current session or all sessions',
            inputSchema: {
              type: 'object',
              properties: {
                session_only: {
                  type: 'boolean',
                  description: 'Clear only current session history (default: true)',
                  default: true
                },
                confirm: {
                  type: 'boolean',
                  description: 'Confirmation flag to prevent accidental deletion',
                }
              },
              required: ['confirm'],
            },
          }
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'mysql_query':
            return await this.handleQuery(args);
          case 'mysql_show_tables':
            return await this.handleShowTables(args);
          case 'mysql_describe_table':
            return await this.handleDescribeTable(args);
          case 'mysql_show_databases':
            return await this.handleShowDatabases(args);
          case 'mysql_table_info':
            return await this.handleTableInfo(args);
          case 'mysql_show_indexes':
            return await this.handleShowIndexes(args);
          case 'mysql_show_processes':
            return await this.handleShowProcesses(args);
          case 'mysql_create_table':
            return await this.handleCreateTable(args);
          case 'mysql_insert_data':
            return await this.handleInsertData(args);
          case 'mysql_database_size':
            return await this.handleDatabaseSize(args);
          case 'mysql_explain_query':
            return await this.handleExplainQuery(args);
          case 'mysql_list_versions':
            return await this.handleListVersions(args);
          case 'mysql_rollback_to_version':
            return await this.handleRollbackToVersion(args);
          case 'mysql_clear_version_history':
            return await this.handleClearVersionHistory(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async handleQuery(args) {
    // 权限检查
    this.checkQueryPermissions(args.query);
    
    // 检查是否是需要备份的操作
    const normalizedQuery = args.query.trim().toUpperCase();
    const targetTable = this.extractTableFromQuery(args.query);
    let operationType = null;
    
    if (normalizedQuery.startsWith('DELETE') || normalizedQuery.includes('TRUNCATE')) {
      operationType = 'DELETE';
    } else if (normalizedQuery.startsWith('UPDATE')) {
      operationType = 'UPDATE';
    } else if (normalizedQuery.startsWith('INSERT')) {
      operationType = 'INSERT';
    } else if (normalizedQuery.includes('DROP TABLE')) {
      operationType = 'DROP_TABLE';
    }
    
    const connection = await this.createConnection(args);
    
    try {
      // 对于DELETE、UPDATE、DROP_TABLE操作，先创建备份
      if ((operationType === 'DELETE' || operationType === 'UPDATE' || operationType === 'DROP_TABLE') && targetTable) {
        try {
          await this.createBackup(operationType, args.query, targetTable, null, connection);
        } catch (backupError) {
          console.error('Backup failed:', backupError.message);
        }
      }

      const [rows, fields] = await connection.execute(args.query);
      
      // 对于INSERT操作，在执行后创建备份记录
      if (operationType === 'INSERT' && targetTable && rows.insertId !== undefined) {
        try {
          await this.createBackup(operationType, args.query, targetTable, rows, connection);
        } catch (backupError) {
          console.error('Backup failed:', backupError.message);
        }
      }
      
      let result = '';
      if (Array.isArray(rows) && rows.length > 0) {
        result = this.formatResultsAsTable(rows, fields);
      } else if (rows.affectedRows !== undefined) {
        result = `Query executed successfully. Affected rows: ${rows.affectedRows}`;
      } else {
        result = 'Query executed successfully. No rows returned.';
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleShowTables(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute('SHOW TABLES');
      const tableList = rows.map(row => Object.values(row)[0]).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Tables in database '${this.defaultConfig.database || args.database}':\n${tableList}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleDescribeTable(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute(`DESCRIBE ${args.table}`);
      const description = this.formatResultsAsTable(rows);
      
      return {
        content: [
          {
            type: 'text',
            text: `Structure of table '${args.table}':\n${description}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleShowDatabases(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute('SHOW DATABASES');
      const dbList = rows.map(row => Object.values(row)[0]).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Available databases:\n${dbList}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleTableInfo(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [tableStats] = await connection.execute(`
        SELECT 
          TABLE_NAME,
          ENGINE,
          TABLE_ROWS,
          DATA_LENGTH,
          INDEX_LENGTH,
          DATA_FREE,
          AUTO_INCREMENT,
          CREATE_TIME,
          UPDATE_TIME
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [this.defaultConfig.database || args.database, args.table]);

      if (tableStats.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Table '${args.table}' not found.`,
            },
          ],
        };
      }

      const table = tableStats[0];
      const dataSize = (table.DATA_LENGTH / 1024 / 1024).toFixed(2);
      const indexSize = (table.INDEX_LENGTH / 1024 / 1024).toFixed(2);
      const totalSize = ((table.DATA_LENGTH + table.INDEX_LENGTH) / 1024 / 1024).toFixed(2);

      let result = `Table Information for '${args.table}':\n\n`;
      result += `Engine: ${table.ENGINE}\n`;
      result += `Rows: ${table.TABLE_ROWS || 'Unknown'}\n`;
      result += `Data Size: ${dataSize} MB\n`;
      result += `Index Size: ${indexSize} MB\n`;
      result += `Total Size: ${totalSize} MB\n`;
      result += `Auto Increment: ${table.AUTO_INCREMENT || 'None'}\n`;
      result += `Created: ${table.CREATE_TIME || 'Unknown'}\n`;
      result += `Updated: ${table.UPDATE_TIME || 'Unknown'}\n`;

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleShowIndexes(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute(`SHOW INDEX FROM ${args.table}`);
      const indexes = this.formatResultsAsTable(rows);
      
      return {
        content: [
          {
            type: 'text',
            text: `Indexes for table '${args.table}':\n${indexes}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleShowProcesses(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute('SHOW PROCESSLIST');
      const processes = this.formatResultsAsTable(rows);
      
      return {
        content: [
          {
            type: 'text',
            text: `Current MySQL processes:\n${processes}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleCreateTable(args) {
    // 权限检查
    if (!this.permissions.allowInsert) {
      throw new Error('CREATE TABLE operations are not allowed. Set ALLOW_INSERT_OPERATION=true to enable.');
    }
    
    const connection = await this.createConnection(args);
    
    try {
      const createTableSQL = `CREATE TABLE ${args.table_name} ${args.schema}`;
      await connection.execute(createTableSQL);
      
      // 创建备份记录（CREATE TABLE操作）- 在执行后记录
      try {
        await this.createBackup('CREATE_TABLE', createTableSQL, args.table_name, null, connection);
      } catch (backupError) {
        console.error('Backup failed:', backupError.message);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Table '${args.table_name}' created successfully.\nSQL: ${createTableSQL}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleInsertData(args) {
    // 权限检查
    if (!this.permissions.allowInsert) {
      throw new Error('INSERT operations are not allowed. Set ALLOW_INSERT_OPERATION=true to enable.');
    }
    
    const connection = await this.createConnection(args);
    
    try {
      const columns = Object.keys(args.data);
      const values = Object.values(args.data);
      const placeholders = columns.map(() => '?').join(', ');
      
      const insertSQL = `INSERT INTO ${args.table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const [result] = await connection.execute(insertSQL, values);
      
      // 创建备份记录（INSERT操作）- 在执行后记录结果
      try {
        await this.createBackup('INSERT', insertSQL, args.table, result, connection);
      } catch (backupError) {
        console.error('Backup failed:', backupError.message);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Data inserted successfully into '${args.table}'.\nAffected rows: ${result.affectedRows}\nInsert ID: ${result.insertId}`,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleDatabaseSize(args) {
    const connection = await this.createConnection(args);
    
    try {
      const [rows] = await connection.execute(`
        SELECT 
          table_schema AS 'Database',
          ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)',
          COUNT(*) AS 'Tables'
        FROM information_schema.tables 
        WHERE table_schema = ?
        GROUP BY table_schema
      `, [this.defaultConfig.database || args.database]);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Database size information not available.',
            },
          ],
        };
      }

      const dbInfo = rows[0];
      let result = `Database Size Information:\n\n`;
      result += `Database: ${dbInfo.Database}\n`;
      result += `Total Size: ${dbInfo['Size (MB)']} MB\n`;
      result += `Number of Tables: ${dbInfo.Tables}\n`;

      // Get table sizes
      const [tableSizes] = await connection.execute(`
        SELECT 
          table_name AS 'Table',
          ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)'
        FROM information_schema.TABLES 
        WHERE table_schema = ?
        ORDER BY (data_length + index_length) DESC
      `, [this.defaultConfig.database || args.database]);

      if (tableSizes.length > 0) {
        result += '\nTable Sizes:\n';
        result += this.formatResultsAsTable(tableSizes);
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  async handleExplainQuery(args) {
    const connection = await this.createConnection(args);
    
    try {
      const format = args.format || 'TRADITIONAL';
      let explainSQL;

      if (format === 'JSON') {
        explainSQL = `EXPLAIN FORMAT=JSON ${args.query}`;
      } else if (format === 'TREE') {
        explainSQL = `EXPLAIN FORMAT=TREE ${args.query}`;
      } else {
        explainSQL = `EXPLAIN ${args.query}`;
      }

      const [rows] = await connection.execute(explainSQL);
      
      let result = `Query Execution Plan (${format}):\n\n`;
      
      if (format === 'JSON') {
        result += JSON.stringify(rows[0]['EXPLAIN'], null, 2);
      } else if (format === 'TREE') {
        result += rows[0]['EXPLAIN'];
      } else {
        result += this.formatResultsAsTable(rows);
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } finally {
      await connection.end();
    }
  }

  handleListVersions(args) {
    try {
      const limit = args.limit || 50;
      const sessionOnly = args.session_only !== false;
      
      let whereClause = '';
      const params = [];
      
      if (sessionOnly) {
        whereClause += 'WHERE session_id = ?';
        params.push(this.sessionId);
      }
      
      if (args.operation_type) {
        whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'operation_type = ?';
        params.push(args.operation_type.toUpperCase());
      }
      
      if (args.target_table) {
        whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'target_table = ?';
        params.push(args.target_table);
      }
      
      const query = `
        SELECT id, timestamp, operation_type, target_table, affected_rows, description 
        FROM version_history 
        ${whereClause}
        ORDER BY timestamp DESC 
        LIMIT ?
      `;
      params.push(limit);
      
      const stmt = this.versionDB.prepare(query);
      const rows = stmt.all(...params);
      
      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No version history found.',
            },
          ],
        };
      }
      
      let result = `Version History (Session: ${this.sessionId.slice(0, 8)}...):\n\n`;
      
      rows.forEach(row => {
        result += `Version ID: ${row.id}\n`;
        result += `Timestamp: ${row.timestamp}\n`;
        result += `Operation: ${row.operation_type}\n`;
        result += `Table: ${row.target_table || 'N/A'}\n`;
        result += `Affected Rows: ${row.affected_rows}\n`;
        result += `Description: ${row.description}\n`;
        result += `${'─'.repeat(50)}\n`;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing versions: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleRollbackToVersion(args) {
    try {
      // 获取版本信息
      const stmt = this.versionDB.prepare('SELECT * FROM version_history WHERE id = ?');
      const versionInfo = stmt.get(args.version_id);

      if (!versionInfo) {
        return {
          content: [
            {
              type: 'text',
              text: `Version ${args.version_id} not found.`,
            },
          ],
          isError: true,
        };
      }

      if (!versionInfo.backup_data) {
        return {
          content: [
            {
              type: 'text',
              text: `Version ${args.version_id} has no backup data to restore.`,
            },
          ],
          isError: true,
        };
      }

      const connection = await this.createConnection(args);
      
      try {
        const backupData = JSON.parse(versionInfo.backup_data);
        let result = '';

        if (versionInfo.operation_type === 'DELETE') {
          // 恢复被删除的数据
          if (backupData.deletedRows && Array.isArray(backupData.deletedRows) && backupData.deletedRows.length > 0) {
            for (const row of backupData.deletedRows) {
              const columns = Object.keys(row);
              const values = Object.values(row).map(value => {
                // 处理日期时间格式转换
                if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
                }
                return value;
              });
              const placeholders = columns.map(() => '?').join(', ');
              
              const insertSQL = `INSERT INTO ${versionInfo.target_table} (${columns.join(', ')}) VALUES (${placeholders})`;
              await connection.execute(insertSQL, values);
            }
            result = `Restored ${backupData.deletedRows.length} deleted rows to table '${versionInfo.target_table}'`;
          }
        } else if (versionInfo.operation_type === 'UPDATE') {
          // 恢复UPDATE前的原始数据
          if (backupData.originalRows && Array.isArray(backupData.originalRows) && backupData.originalRows.length > 0) {
            for (const row of backupData.originalRows) {
              const columns = Object.keys(row);
              const values = Object.values(row).map(value => {
                // 处理日期时间格式转换
                if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
                }
                return value;
              });
              
              // 构建UPDATE语句来恢复原始数据
              if (row.id) {
                const setClause = columns.filter(col => col !== 'id').map(col => `${col} = ?`).join(', ');
                const updateValues = values.filter((_, index) => columns[index] !== 'id');
                updateValues.push(row.id); // WHERE id = ? 的参数
                
                const updateSQL = `UPDATE ${versionInfo.target_table} SET ${setClause} WHERE id = ?`;
                await connection.execute(updateSQL, updateValues);
              }
            }
            result = `Restored ${backupData.originalRows.length} rows to original state in table '${versionInfo.target_table}'`;
          }
        } else if (versionInfo.operation_type === 'INSERT') {
          // 回滚INSERT操作：删除插入的数据
          if (backupData.idRange) {
            const { start, end } = backupData.idRange;
            if (start === end) {
              await connection.execute(`DELETE FROM ${versionInfo.target_table} WHERE id = ?`, [start]);
              result = `Deleted inserted row with id ${start} from table '${versionInfo.target_table}'`;
            } else {
              await connection.execute(`DELETE FROM ${versionInfo.target_table} WHERE id BETWEEN ? AND ?`, [start, end]);
              result = `Deleted inserted rows with ids ${start}-${end} from table '${versionInfo.target_table}'`;
            }
          } else {
            result = `INSERT rollback: Cannot automatically delete inserted data without primary key info. Manual deletion may be required.`;
          }
        } else if (versionInfo.operation_type === 'DROP_TABLE') {
          // 恢复被删除的表
          if (backupData.structure && backupData.data) {
            // 重新创建表
            const createTableSQL = backupData.structure['Create Table'];
            await connection.execute(createTableSQL);
            
            // 恢复数据
            if (backupData.data.length > 0) {
              for (const row of backupData.data) {
                const columns = Object.keys(row);
                const values = Object.values(row).map(value => {
                  // 处理日期时间格式转换
                  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                    return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
                  }
                  return value;
                });
                const placeholders = columns.map(() => '?').join(', ');
                
                const insertSQL = `INSERT INTO ${versionInfo.target_table} (${columns.join(', ')}) VALUES (${placeholders})`;
                await connection.execute(insertSQL, values);
              }
            }
            result = `Restored table '${versionInfo.target_table}' with ${backupData.data.length} rows`;
          }
        } else if (versionInfo.operation_type === 'CREATE_TABLE') {
          // 回滚CREATE TABLE：删除创建的表
          await connection.execute(`DROP TABLE IF EXISTS ${versionInfo.target_table}`);
          result = `Dropped table '${versionInfo.target_table}' (rollback CREATE TABLE)`;
        }

        // 记录回滚操作
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -1) + String(process.hrtime.bigint()).slice(-6);
        this.saveVersion({
          sessionId: this.sessionId,
          timestamp,
          operationType: 'ROLLBACK',
          targetTable: versionInfo.target_table,
          sqlQuery: `ROLLBACK TO VERSION ${args.version_id}`,
          backupData: null,
          affectedRows: 0,
          description: `Rollback to version ${args.version_id}`
        });

        return {
          content: [
            {
              type: 'text',
              text: `Rollback successful!\n${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Rollback failed: ${error.message}`,
            },
          ],
          isError: true,
        };
      } finally {
        await connection.end();
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error accessing version data: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  handleClearVersionHistory(args) {
    if (!args.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: 'Clear operation cancelled. Set confirm=true to proceed.',
          },
        ],
        isError: true,
      };
    }

    try {
      const sessionOnly = args.session_only !== false;
      
      let deleteSQL = 'DELETE FROM version_history';
      const params = [];
      
      if (sessionOnly) {
        deleteSQL += ' WHERE session_id = ?';
        params.push(this.sessionId);
      }
      
      const stmt = this.versionDB.prepare(deleteSQL);
      const result = stmt.run(...params);
      
      const scope = sessionOnly ? 'current session' : 'all sessions';
      return {
        content: [
          {
            type: 'text',
            text: `Cleared ${result.changes} version records for ${scope}.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error clearing version history: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  formatResultsAsTable(rows, fields = null) {
    if (!rows || rows.length === 0) {
      return 'No results found.';
    }

    const columns = Object.keys(rows[0]);
    
    // 计算每列的最大宽度
    const columnWidths = {};
    columns.forEach(col => {
      columnWidths[col] = Math.max(
        col.length,
        ...rows.map(row => String(row[col] || '').length)
      );
    });

    // 创建表头
    let result = '┌' + columns.map(col => 
      '─'.repeat(columnWidths[col] + 2)
    ).join('┬') + '┐\n';
    
    result += '│' + columns.map(col => 
      ` ${col.padEnd(columnWidths[col])} `
    ).join('│') + '│\n';
    
    result += '├' + columns.map(col => 
      '─'.repeat(columnWidths[col] + 2)
    ).join('┼') + '┤\n';

    // 添加数据行
    rows.forEach(row => {
      result += '│' + columns.map(col => 
        ` ${String(row[col] || '').padEnd(columnWidths[col])} `
      ).join('│') + '│\n';
    });

    // 添加底部边框
    result += '└' + columns.map(col => 
      '─'.repeat(columnWidths[col] + 2)
    ).join('┴') + '┘';

    return result;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MySQL MCP server running on stdio');
  }
}

const server = new MySQLMCPServer();
server.run().catch(console.error); 