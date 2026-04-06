import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config, isDemoMode } from './config';
import { formatError, formatResult, type ToolDefinition } from './utils/toolHelper';

// Tool registry
const toolRegistry: Map<string, ToolDefinition> = new Map();

export function registerTool(def: ToolDefinition) {
  toolRegistry.set(def.name, def);
}

export function createServer() {
  const server = new Server(
    { name: 'polymarket-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Araç listesi
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [];
    for (const [, def] of toolRegistry) {
      if (def.requiresFullMode && isDemoMode()) continue; // Demo modda full araçları gizle
      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: zodToJsonSchema(def.inputSchema),
      });
    }
    return { tools };
  });

  // Araç çağrısı
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const def = toolRegistry.get(name);

    if (!def) {
      return {
        content: [{ type: 'text', text: `Araç bulunamadı: ${name}` }],
        isError: true,
      };
    }

    if (def.requiresFullMode && isDemoMode()) {
      return {
        content: [{ type: 'text', text: `"${name}" aracı Full Mode gerektirir. .env dosyasında POLYMARKET_MODE=full yapın.` }],
        isError: true,
      };
    }

    try {
      const parsed = def.inputSchema instanceof z.ZodType ? def.inputSchema.parse(args) : args;
      const result = await def.handler(parsed);
      return {
        content: [{ type: 'text', text: formatResult(result) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: formatError(err) }],
        isError: true,
      };
    }
  });

  return server;
}

/** Zod şemasını MCP'nin beklediği JSON Schema formatına dönüştür */
function zodToJsonSchema(schema: z.ZodTypeAny): Tool['inputSchema'] {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodFieldToJson(val as z.ZodTypeAny);
      if (!(val instanceof z.ZodOptional)) required.push(key);
    }

    return { type: 'object', properties, required };
  }
  return { type: 'object', properties: {} };
}

function zodFieldToJson(field: z.ZodTypeAny): { type: string; description?: string; enum?: string[]; default?: unknown } {
  if (field instanceof z.ZodOptional) return zodFieldToJson(field.unwrap());
  if (field instanceof z.ZodDefault) return { ...zodFieldToJson(field.removeDefault()), default: field._def.defaultValue() };
  if (field instanceof z.ZodString)  return { type: 'string' };
  if (field instanceof z.ZodNumber)  return { type: 'number' };
  if (field instanceof z.ZodBoolean) return { type: 'boolean' };
  if (field instanceof z.ZodEnum)    return { type: 'string', enum: field.options as string[] };
  if (field instanceof z.ZodArray)   return { type: 'array' } as { type: string };
  return { type: 'string' };
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();

  console.error(`[Polymarket MCP] Başlatılıyor... Mod: ${config.mode.toUpperCase()}`);
  console.error(`[Polymarket MCP] ${toolRegistry.size} araç yüklendi`);

  await server.connect(transport);
  console.error('[Polymarket MCP] Hazır.');
}
