# MySQL MCP Server

一个基于 Model Context Protocol (MCP) 的MySQL数据库服务器，具备**企业级版本控制**和**安全权限管理**功能。

## 🎯 功能特性

### 📊 核心数据库功能
- 🔍 **执行自定义SQL查询** - 支持任意MySQL查询语句
- 📋 **数据库管理** - 显示数据库、表、索引等信息
- 🔧 **表结构查看** - 获取表的详细结构和统计信息
- 📈 **性能分析** - 查询执行计划分析和数据库大小统计
- 🛠️ **数据操作** - 支持创建表、插入数据等操作

### 🛡️ 安全与权限控制
- 🔐 **三级权限控制** - 精确控制INSERT/UPDATE/DELETE权限
- 🔒 **默认只读模式** - 防止意外数据修改和删除
- 🎨 **美观的表格输出** - 查询结果以表格形式展示
- 🔐 **安全连接** - 支持SSL连接和完整的认证配置

### ⚡ Git风格版本控制系统
- 📚 **智能备份策略** - 自动备份所有增删改操作
- 🔄 **精确回滚功能** - 可回滚到任意历史版本
- 🕐 **微秒级时间戳** - 精确的操作时间记录
- 🎭 **会话隔离** - 每个对话的版本历史独立管理
- 💾 **持久化存储** - 使用SQLite存储版本历史
- 📝 **完整SQL记录** - 记录每个操作的完整SQL语句

### 🔧 开发友好
- 🔑 **环境变量支持** - 通过环境变量预设数据库连接信息
- 🎛️ **灵活配置** - 支持多种连接和权限配置方式

## 安装

### 本地安装

0. clone到本地

  ```bash
  git clone https://github.com/csrts/MySQL_MCP_Server
  cd MySQL_MCP_Server
  ```

1. 安装依赖：
   
   ```bash
   npm install
   ```

2. 添加到你使用的MCP Clients：
   
   #### 例：Cursor
   
   ```json
   "mysql": {
      "command": "node",
      "args": [
        "path_your_mcp_server/src/index.js"
      ],
      "env": {
        "MYSQL_HOST": "your_mysql_host",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mysql_username", 
        "MYSQL_PASSWORD": "mysql_password",
        "MYSQL_DATABASE": "mysql_database",
        "MYSQL_SSL": "false",
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false"
      }
    }
   ```

## 详细说明

`node` : MySQL MCP Server需要通过node进行启动，前置条件是需要已安装 Node.js

`args` : 参数，需要修改整个参数为MCP Server的绝对路径

    例如：

```json
"args": [
     "test/MCPs/MySQL_MCP_Server/src/index.js"
   ],
```

`MYSQL_HOST` : MySQL数据库服务器地址

`MYSQL_PORT` : MySQL数据库服务器端口

`MYSQL_USER` : MySQL数据库用户名

`MYSQL_PASSWORD` : MySQL数据库密码

`MYSQL_DATABASE` : MySQL数据库名称

`MYSQL_SSL` : 是否启用MySQL SSL连接

`ALLOW_INSERT_OPERATION` : 是否允许AI数据执行插入操作

`ALLOW_UPDATE_OPERATION` : 是否允许AI执行数据修改操作

`ALLOW_DELETE_OPERATION` : 是否允许AI执行数据删除操作

## 配置

### MCP客户端配置

在您的MCP客户端配置文件中添加以下配置：

```json
"mysql": {
      "command": "node",
      "args": [
        "path_your_mcp_server/src/index.js"
      ],
      "env": {
        "MYSQL_HOST": "your_mysql_host",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mysql_username", 
        "MYSQL_PASSWORD": "mysql_password",
        "MYSQL_DATABASE": "mysql_database",
        "MYSQL_SSL": "false",
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false"
      }
}
```

#### Claude Desktop配置示例

如果您使用Claude Desktop，请在以下位置创建或编辑配置文件：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": [
        "path_your_mcp_server/src/index.js"
      ],
      "env": {
        "MYSQL_HOST": "your_mysql_host",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mysql_username", 
        "MYSQL_PASSWORD": "mysql_password",
        "MYSQL_DATABASE": "mysql_database",
        "MYSQL_SSL": "false",
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false"
      }
    }
  }
}
```

### 配置字段说明

- **`command`**: 要执行的命令（npx、node等）
- **`args`**: 命令参数数组
- **`env`** (可选): 环境变量对象
- **`cwd`** (可选): 当前工作目录，仅在本地开发时需要

#### **环境变量说明：**

**数据库连接：**
- `MYSQL_HOST`: 数据库主机地址
- `MYSQL_PORT`: 数据库端口
- `MYSQL_USER`: 数据库用户名（必需）
- `MYSQL_PASSWORD`: 数据库密码（必需）
- `MYSQL_DATABASE`: 数据库名称（必需）
- `MYSQL_SSL`: 是否使用SSL连接

**权限控制变量（安全）：**

- `ALLOW_INSERT_OPERATION`: 允许INSERT、CREATE TABLE等操作（默认：false）
- `ALLOW_UPDATE_OPERATION`: 允许UPDATE、ALTER TABLE等操作（默认：false）
- `ALLOW_DELETE_OPERATION`: 允许DELETE、DROP TABLE等操作（默认：false）

## 🛠️ 可用工具 (14个)

### 📊 基础查询工具

#### 1. mysql_query
执行自定义MySQL查询

**参数：**
- `query` (必需): SQL查询语句
- `host`, `port`, `user`, `password`, `database`, `ssl` (可选): 数据库连接参数

**示例：**
```sql
SELECT * FROM users WHERE age > 18 LIMIT 10
```

#### 2. mysql_show_tables
显示数据库中的所有表

**参数：** 连接参数（如果配置了环境变量则无需传递）

#### 3. mysql_describe_table
查看表的结构信息

**参数：**
- `table` (必需): 表名
- 其他连接参数（可选）

### 🗄️ 数据库管理工具

#### 4. mysql_show_databases
显示所有可用的数据库

**参数：** 连接参数（可选）

#### 5. mysql_table_info
获取表的详细统计信息

**参数：**
- `table` (必需): 表名
- 其他连接参数（可选）

**功能：** 显示表引擎、行数、数据大小、索引大小、创建时间等

#### 6. mysql_show_indexes
显示表的索引信息

**参数：**
- `table` (必需): 表名
- 其他连接参数（可选）

#### 7. mysql_show_processes
显示当前MySQL进程列表

**参数：** 连接参数（可选）

#### 8. mysql_database_size
获取数据库大小统计

**参数：** 连接参数（可选）

**功能：** 显示数据库总大小、表数量及各表大小排序

### 🔧 数据操作工具

#### 9. mysql_create_table
创建新表

**参数：**
- `table_name` (必需): 表名
- `schema` (必需): 表结构定义
- 其他连接参数（可选）

**权限要求：** `ALLOW_INSERT_OPERATION=true`

#### 10. mysql_insert_data
插入数据到表中

**参数：**
- `table` (必需): 表名
- `data` (必需): 数据对象（键值对）
- 其他连接参数（可选）

**权限要求：** `ALLOW_INSERT_OPERATION=true`

### 📈 性能分析工具

#### 11. mysql_explain_query
分析查询执行计划

**参数：**
- `query` (必需): 要分析的SQL查询
- `format` (可选): 输出格式 (`TRADITIONAL`, `JSON`, `TREE`)
- 其他连接参数（可选）

### 🕐 版本控制工具

#### 12. mysql_list_versions
列出版本历史记录

**参数：**
- `limit` (可选): 显示记录数量（默认：50）
- `session_only` (可选): 是否只显示当前会话（默认：true）
- `operation_type` (可选): 按操作类型过滤
- `target_table` (可选): 按目标表过滤

**示例输出：**
```
Version ID: 1
Timestamp: 2025-07-10 16:32:07.469221707
Operation: INSERT
Table: users
Affected Rows: 1
Description: INSERT operation: 1 row(s) inserted into users
```

#### 13. mysql_rollback_to_version
回滚到指定版本

**参数：**
- `version_id` (必需): 要回滚到的版本ID
- 其他连接参数（可选）

**支持的回滚操作：**
- **INSERT回滚**: 自动删除插入的数据
- **UPDATE回滚**: 恢复到修改前的原始状态
- **DELETE回滚**: 重新插入被删除的数据
- **CREATE_TABLE回滚**: 删除创建的表
- **DROP_TABLE回滚**: 重新创建表和数据

#### 14. mysql_clear_version_history
清理版本历史记录

**参数：**
- `confirm` (必需): 确认删除（必须为true）
- `session_only` (可选): 是否只清理当前会话（默认：true）

## 🛡️ 版本控制系统详解

### 自动备份策略

系统会根据操作类型智能创建备份：

- **DELETE操作**: 在删除前备份即将被删除的数据
- **UPDATE操作**: 在修改前备份原始数据
- **INSERT操作**: 记录插入的详细信息（ID范围等）
- **CREATE_TABLE操作**: 记录表创建信息
- **DROP_TABLE操作**: 备份完整的表结构和数据

### 版本历史存储

使用SQLite数据库存储版本历史：

```sql
CREATE TABLE version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,           -- 会话隔离
  timestamp TEXT NOT NULL,            -- 微秒级时间戳  
  operation_type TEXT NOT NULL,       -- 操作类型
  target_table TEXT,                  -- 目标表
  sql_query TEXT,                     -- 完整的SQL语句
  backup_data TEXT,                   -- 备份数据(JSON格式)
  affected_rows INTEGER,              -- 影响行数
  description TEXT                    -- 操作描述
);
```

### 精确回滚机制

- **DELETE回滚**: 使用INSERT语句重新插入被删除的数据
- **UPDATE回滚**: 使用UPDATE语句恢复到修改前的原始值
- **INSERT回滚**: 使用DELETE语句删除插入的数据
- **表操作回滚**: 重新创建或删除相应的表结构

## 使用示例

### 基础查询
```
使用mysql_query工具执行：
query: SELECT id, name, email FROM users WHERE status = 'active'
```

### 表管理
```
使用mysql_show_tables工具查看所有表
使用mysql_describe_table工具查看'users'表结构
使用mysql_table_info工具获取'users'表的详细统计
```

### 数据操作（需要权限）
```
使用mysql_insert_data工具插入数据：
table: users
data: {"name": "John Doe", "email": "john@example.com"}
```

### 版本控制
```
使用mysql_list_versions工具查看版本历史
使用mysql_rollback_to_version工具回滚：
version_id: 5
```

### 性能分析
```
使用mysql_explain_query工具分析查询：
query: SELECT * FROM users WHERE email = 'test@example.com'
format: JSON
```

## 输出格式

查询结果将以美观的ASCII表格格式显示：

```
┌────┬──────────┬─────────────────────┐
│ id │ name     │ email               │
├────┼──────────┼─────────────────────┤
│ 1  │ John Doe │ john@example.com    │
│ 2  │ Jane Doe │ jane@example.com    │
└────┴──────────┴─────────────────────┘
```

## 🔐 安全注意事项

### 权限控制
- 🔒 **默认只读模式**：所有写操作默认禁用
- ⚠️ **三级权限控制**：
  - `ALLOW_INSERT_OPERATION=false`: 禁用INSERT、CREATE TABLE、CREATE DATABASE操作
  - `ALLOW_UPDATE_OPERATION=false`: 禁用UPDATE、ALTER TABLE操作  
  - `ALLOW_DELETE_OPERATION=false`: 禁用DELETE、DROP TABLE、DROP DATABASE、TRUNCATE操作

### 数据安全
- 🔐 **数据库凭据安全**：数据库凭据通过环境变量管理，不会被持久化存储
- 🔒 **连接管理**：每次查询都会创建新的连接并在完成后关闭
- 🛡️ **版本控制保护**：所有增删改操作自动备份，支持精确回滚
- 📚 **操作记录**：完整记录所有SQL操作和时间戳

### 生产环境建议
- 🛡️ **保持权限控制为false**，或使用只读数据库用户
- 🚨 **谨慎开启写权限**：如需开启写权限，请谨慎设置对应环境变量为true
- 💾 **定期清理版本历史**：使用`mysql_clear_version_history`工具管理存储空间
- 🔍 **监控操作日志**：定期检查版本历史记录

## 系统要求

- Node.js >= 18.0.0
- MySQL 5.7+ 或 8.0+
- npm 或 yarn

## 依赖包

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.6.0",
    "mysql2": "^3.11.0",
    "better-sqlite3": "^11.8.0"
  }
}
```

## 故障排除

### 连接失败
- 检查MySQL服务是否运行
- 验证用户名、密码和数据库名称
- 确认主机和端口配置正确
- 检查防火墙设置

### 权限错误
- 确保MySQL用户具有访问指定数据库的权限
- 对于修改操作，确保用户具有相应的写权限
- 检查环境变量中的权限控制设置

### SSL连接问题
- 如果MySQL服务器要求SSL，请将`ssl`参数设置为`true`
- 检查MySQL服务器的SSL配置

### 版本控制问题
- 检查SQLite数据库文件`mysql_versions.db`是否可写
- 确保有足够的磁盘空间存储版本历史
- 如需重置版本历史，可删除`mysql_versions.db`文件

## 开发

### 本地开发

```bash
# 克隆项目
git clone https://github.com/csrts/MySQL_MCP_Server
cd MySQL_MCP_Server

# 安装依赖
npm install
```

### 版本控制数据库

版本控制系统使用SQLite数据库`mysql_versions.db`存储历史记录。该文件会在首次运行时自动创建。

## 许可证

MIT License

## 贡献

欢迎提交问题和PR！请确保您的代码符合项目的编码规范。

---

## 🎯 更新日志

### v2.0.0 - 企业级版本控制系统
- ✅ 新增 8个扩展MySQL工具
- ✅ 实现Git风格版本控制系统
- ✅ 新增 3个版本控制工具
- ✅ 智能备份与精确回滚功能
- ✅ 会话隔离和微秒级时间戳
- ✅ 完整SQL语句记录
- ✅ 企业级数据安全保障

### v1.0.0 - 基础功能
- ✅ 基础MySQL查询功能
- ✅ 权限控制系统
- ✅ 环境变量支持 