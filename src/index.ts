#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  searchTools,
  getToolDetail,
  createGeneration,
  pollGeneration,
  listGenerations,
  uploadFile,
  getAccount,
  requestDeviceCode,
  pollDeviceToken,
} from "./api.js";

// --- Credential storage ---

const CREDENTIALS_DIR = join(homedir(), ".artificial-studio");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

function loadStoredApiKey(): string | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    return data.api_key || null;
  } catch {
    return null;
  }
}

function saveApiKey(apiKey: string): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify({ api_key: apiKey }, null, 2), { mode: 0o600 });
}

function getApiKey(): string {
  // 1. Environment variable takes priority
  const envKey = process.env.ARTIFICIAL_STUDIO_API_KEY;
  if (envKey) return envKey;

  // 2. Stored credentials
  const storedKey = loadStoredApiKey();
  if (storedKey) return storedKey;

  throw new Error(
    "Not authenticated. Use the 'authenticate' tool to connect your Artificial Studio account, " +
    "or set the ARTIFICIAL_STUDIO_API_KEY environment variable."
  );
}

const server = new McpServer(
  {
    name: "artificial-studio",
    version: "1.0.0",
  },
  {
    instructions: `You are connected to Artificial Studio, an AI media generation platform.

## Model selection workflow
When the user asks to generate content (image, video, audio, 3D):
1. Use search_tools or get_tool_detail to find the right tool and see available models with their costs.
2. If the tool has multiple models, present the options to the user with name and cost (credits per generation/second) and ask which one they prefer.
3. Once the user picks a model, remember it for subsequent generations with the same tool — don't ask again unless they request a change.
4. If the user specifies a model by name upfront, use it directly without asking.

## Cost awareness
Each model has a "cost" (credits) and "costUnit" (per generation or per second for video). Always mention the cost when presenting model options so the user can make an informed choice.

## Input discovery
Always check the model's inputSchema before generating. Use the required fields and respect defaults for optional fields. Don't guess parameter names.`,
  }
);

// --- Tool: authenticate ---
server.tool(
  "authenticate",
  "Connect your Artificial Studio account. Opens a browser link where you log in and approve access. Only needed once — credentials are saved locally.",
  {},
  async () => {
    // Check if already authenticated
    try {
      const key = getApiKey();
      const account = await getAccount(key);
      return {
        content: [{
          type: "text",
          text: `Already authenticated as ${account.email} (${account.credits} credits, ${account.plan} plan). To re-authenticate, delete ~/.artificial-studio/credentials.json and try again.`,
        }],
      };
    } catch {
      // Not authenticated, proceed with device flow
    }

    const device = await requestDeviceCode();

    const instructions = [
      `To connect your Artificial Studio account:`,
      ``,
      `1. Open this URL in your browser:`,
      `   ${device.verification_uri_complete}`,
      ``,
      `2. Verify the code matches: ${device.user_code}`,
      ``,
      `3. Click "Connect" to authorize.`,
      ``,
      `Waiting for authorization (expires in ${Math.floor(device.expires_in / 60)} minutes)...`,
    ].join("\n");

    // Poll for token
    const apiKey = await pollDeviceToken(device.device_code, device.interval * 1000);

    // Save credentials
    saveApiKey(apiKey);

    return {
      content: [{
        type: "text",
        text: `${instructions}\n\nAuthenticated successfully! Credentials saved to ~/.artificial-studio/credentials.json`,
      }],
    };
  }
);

// --- Tool: search ---
server.tool(
  "search_tools",
  "Search for available AI tools and models on Artificial Studio. Use this to discover the right tool and model for a task. Returns tools with their input schemas and pricing.",
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
  "Get detailed information about a specific tool, including all available models, their input schemas, and pricing.",
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
  "Run an AI generation on Artificial Studio. Submits the job and waits for the result. IMPORTANT: Before calling this, use get_tool_detail to discover available models and their inputSchema. If the user hasn't chosen a model yet and the tool has multiple options, present them with costs and ask for their preference first.",
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
