#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchTools,
  getToolDetail,
  createGeneration,
  pollGeneration,
  listGenerations,
  uploadFile,
  getAccount,
} from "./api.js";

function getApiKey(): string {
  const key = process.env.ARTIFICIAL_STUDIO_API_KEY;
  if (!key) {
    throw new Error(
      "ARTIFICIAL_STUDIO_API_KEY environment variable is not set. " +
        "Get your API key at https://app.artificialstudio.ai/account/api-keys and set it with: " +
        "export ARTIFICIAL_STUDIO_API_KEY=your_key_here"
    );
  }
  return key;
}

const server = new McpServer({
  name: "artificial-studio",
  version: "1.0.0",
});

// --- Tool: search ---
server.tool(
  "search_tools",
  "Search for available AI tools and models on Artificial Studio. Use this to discover the right tool and model for a task. Returns tools with their input schemas.",
  { query: z.string().describe("What you want to do, e.g. 'generate image', 'text to speech', '3d model'") },
  async ({ query }) => {
    const apiKey = getApiKey();
    const result = await searchTools(apiKey, query);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: get_tool_detail ---
server.tool(
  "get_tool_detail",
  "Get detailed information about a specific tool, including all available models and their input schemas.",
  { tool_slug: z.string().describe("Tool slug, e.g. 'create-image', 'create-video', 'text-to-speech'") },
  async ({ tool_slug }) => {
    const apiKey = getApiKey();
    const result = await getToolDetail(apiKey, tool_slug);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: generate ---
server.tool(
  "generate",
  "Run an AI generation on Artificial Studio. Submits the job and waits for the result — no need to poll manually. Returns the completed generation with output URL.",
  {
    tool: z.string().describe(
      "Tool to use, e.g. 'create-image', 'create-video', 'text-to-speech', 'text-to-3d', 'edit-image', 'animate-image', etc."
    ),
    input: z
      .record(z.string(), z.unknown())
      .describe(
        "Tool-specific input. Use search_tools or get_tool_detail first to discover the exact fields. Common fields: prompt, model, image_urls, video_url, audio_url"
      ),
  },
  async ({ tool, input }) => {
    const apiKey = getApiKey();
    const gen = await createGeneration(apiKey, tool, input);
    const result = await pollGeneration(apiKey, gen.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { id: result.id, status: result.status, tool: result.tool, type: result.type, output: result.output, thumbnail: result.thumbnail },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: check_generation ---
server.tool(
  "check_generation",
  "Check the status of an existing generation by its ID. Useful if a previous generation timed out or you want to check on a specific job.",
  { generation_id: z.string().describe("The generation ID to check") },
  async ({ generation_id }) => {
    const apiKey = getApiKey();
    const result = await pollGeneration(apiKey, generation_id);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: list_generations ---
server.tool(
  "list_generations",
  "List recent generations from your Artificial Studio account.",
  {
    limit: z.number().optional().default(20).describe("Number of results (max 100)"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
    status: z.string().optional().describe("Filter by status: pending, processing, success, error"),
  },
  async ({ limit, offset, status }) => {
    const apiKey = getApiKey();
    const result = await listGenerations(apiKey, { limit, offset, status });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: upload_file ---
server.tool(
  "upload_file",
  "Upload a local file (image, video, audio) to Artificial Studio. Returns a URL that can be used in generation inputs like image_urls, video_url, or audio_url.",
  { file_path: z.string().describe("Absolute path to the local file to upload") },
  async ({ file_path }) => {
    const apiKey = getApiKey();
    const result = await uploadFile(apiKey, file_path);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: get_account ---
server.tool(
  "get_account",
  "Get your Artificial Studio account info including remaining credits and plan type.",
  {},
  async () => {
    const apiKey = getApiKey();
    const result = await getAccount(apiKey);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
