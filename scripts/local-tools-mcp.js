import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "stealthnet-local-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "calculate",
        description: "Perform a mathematical calculation using a string expression.",
        inputSchema: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "The expression to evaluate (e.g., '2 + 2 * 3').",
            },
          },
          required: ["expression"],
        },
      },
      {
        name: "regex_match",
        description: "Match a string against a regular expression.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The regex pattern.",
            },
            text: {
              type: "string",
              description: "The text to match against.",
            },
            flags: {
              type: "string",
              description: "Regex flags (e.g., 'gi').",
            },
          },
          required: ["pattern", "text"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "calculate") {
    try {
      // Basic math evaluation (safe enough for local)
      const result = eval(args.expression.replace(/[^-+*/().0-9 ]/g, ""));
      return {
        content: [{ type: "text", text: String(result) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }

  if (name === "regex_match") {
    try {
      const regex = new RegExp(args.pattern, args.flags || "");
      const matches = args.text.match(regex);
      return {
        content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Local Tools MCP server running on stdio");
