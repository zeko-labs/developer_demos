# MCP Integration (Optional)

This folder documents how to use the Zeko/o1js MCP helper alongside the app.

## Why

The MCP server provides standardized tools for querying Zeko Sepolia activity using a
Blockberry API key. Use it to inspect transactions, zkApp calls, and wallet history
from your own MCP client or LLM workflow.

## Quick Start

```bash
npx mina-mcp-server
```

Then set your key:

```bash
export MCP_BLOCKBERRY_API_KEY=your_key
```

## Suggested Usage

- Use MCP tool `get-zkapp-transaction` to inspect the tx hash returned by the app.
- Use MCP tool `get-wallet-transactions` to compare user activity across agents.

The core app is deliberately decoupled so you can plug MCP-driven analytics into
any UI or backend environment.
