import { readFileSync, statSync } from "fs"
import { homedir } from "os"
import { dirname, join, resolve } from "path"
import * as jsoncParser from "jsonc-parser"
import type { ParseError } from "jsonc-parser"
import * as z from "zod"

const DECIMAL_PERCENT_PATTERN = /^\d+(?:\.\d+)?%$/

const PercentSchema = z
    .string()
    .regex(DECIMAL_PERCENT_PATTERN)
    .pipe(z.templateLiteral([z.number(), z.literal("%")]))

const LimitSchema = z.union([z.number(), PercentSchema])

const CommandsSchema = z
    .object({
        enabled: z
            .boolean()
            .default(true)
            .meta({ description: "Enable DCP slash commands (/dcp)" }),
        protectedTools: z
            .array(z.string())
            .default([
                "task",
                "skill",
                "todowrite",
                "todoread",
                "compress",
                "batch",
                "plan_enter",
                "plan_exit",
                "write",
                "edit",
            ])
            .meta({
                description:
                    'Additional tool names or wildcard patterns to protect from pruning via commands (e.g., /dcp sweep). Supports glob wildcards: * matches any characters, ? matches a single character (e.g., "mcp_*", "my_tool_?")',
                examples: [["mcp_*", "my_tool_?"]],
            }),
    })
    .prefault({})
    .meta({ description: "Configuration for DCP slash commands (/dcp)" })

const ManualModeSchema = z
    .object({
        enabled: z
            .boolean()
            .default(false)
            .meta({ description: "Start new sessions with manual mode enabled" }),
        automaticStrategies: z.boolean().default(true).meta({
            description:
                "When manual mode is enabled, keep automatic deduplication/purge strategies running",
        }),
    })
    .prefault({})
    .meta({ description: "Manual mode behavior for context management tools" })

const TurnProtectionSchema = z
    .object({
        enabled: z.boolean().default(false).meta({ description: "Enable turn-based protection" }),
        turns: z
            .number()
            .min(1)
            .default(4)
            .meta({ description: "Number of recent turns to protect from pruning" }),
    })
    .prefault({})
    .meta({ description: "Protect recent tool outputs from being pruned" })

const ExperimentalSchema = z
    .object({
        allowSubAgents: z
            .boolean()
            .default(false)
            .meta({ description: "Allow DCP processing in subagent sessions" }),
        customPrompts: z.boolean().default(false).meta({
            description: "Enable user-editable prompt overrides under dcp-prompts directories",
        }),
    })
    .prefault({})
    .meta({ description: "Experimental settings that may change in future releases" })

const CompressSchema = z
    .object({
        mode: z.enum(["range", "message"]).default("range").meta({
            description:
                "Compression mode. 'range' compresses spans into block summaries, 'message' compresses individual raw messages.",
        }),
        permission: z
            .enum(["ask", "allow", "deny"])
            .default("allow")
            .meta({ description: "Permission mode (deny disables the tool)" }),
        showCompression: z
            .boolean()
            .default(false)
            .meta({ description: "Show compression summaries in notifications" }),
        summaryBuffer: z.boolean().default(true).meta({
            description:
                "When enabled, active summary tokens extend the effective maxContextLimit used for context-limit nudges.",
        }),
        maxContextLimit: LimitSchema.default(100000).meta({
            description:
                'Soft upper threshold. Above this, DCP keeps sending strong compression nudges (based on nudgeFrequency), so the model is pushed to compress. Accepts number or "X%" of the model context window.',
            examples: ["80%"],
        }),
        minContextLimit: LimitSchema.default(50000).meta({
            description:
                'Soft lower threshold for reminder nudges. Below this, turn/iteration reminders are off (compression is less likely). At or above this, reminders are on. Accepts number or "X%" of the model context window.',
            examples: ["40%"],
        }),
        modelMaxLimits: z.record(z.string(), LimitSchema).default({}).meta({
            description:
                "Per-model override for maxContextLimit by exact provider/model key. If set, this takes priority over the global maxContextLimit.",
        }),
        modelMinLimits: z.record(z.string(), LimitSchema).default({}).meta({
            description:
                "Per-model override for minContextLimit by exact provider/model key. If set, this takes priority over the global minContextLimit.",
        }),
        nudgeFrequency: z.number().min(1).default(5).meta({
            description:
                "How often the context-limit nudge fires when above maxContextLimit (1 = every fetch, 5 = every 5th fetch)",
        }),
        iterationNudgeThreshold: z.number().min(1).default(15).meta({
            description:
                "How many messages to wait after a user message before adding compression reminders.",
        }),
        nudgeForce: z.enum(["strong", "soft"]).default("soft").meta({
            description:
                "Controls how likely compression is after user messages. 'strong' is more likely, 'soft' is less likely.",
        }),
        protectedTools: z
            .array(z.string())
            .default(["task", "skill", "todowrite", "todoread"])
            .meta({
                description:
                    'Tool names or wildcard patterns whose completed outputs should be appended to the compression summary. Supports glob wildcards: * matches any characters, ? matches a single character (e.g., "mcp_*", "my_tool_?")',
                examples: [["mcp_*", "my_tool_?"]],
            }),
        protectTags: z.boolean().default(false).meta({
            description: "Preserve text wrapped in <protect>...</protect> when compressed",
        }),
        protectUserMessages: z
            .boolean()
            .default(false)
            .meta({ description: "When enabled, your messages are never lost during compression" }),
    })
    .prefault({})
    .meta({ description: "Configuration for the unified compress tool" })

const DeduplicationSchema = z
    .object({
        enabled: z.boolean().default(true).meta({ description: "Enable deduplication strategy" }),
        protectedTools: z
            .array(z.string())
            .default([])
            .meta({
                description:
                    'Tool names or wildcard patterns excluded from deduplication. Supports glob wildcards: * matches any characters, ? matches a single character (e.g., "mcp_*", "my_tool_?")',
                examples: [["mcp_*", "my_tool_?"]],
            }),
    })
    .prefault({})
    .meta({ description: "Remove duplicate tool outputs" })

const PurgeErrorsSchema = z
    .object({
        enabled: z.boolean().default(true).meta({ description: "Enable purge errors strategy" }),
        turns: z
            .number()
            .min(1)
            .default(4)
            .meta({ description: "Number of turns after which errors are purged" }),
        protectedTools: z
            .array(z.string())
            .default([])
            .meta({
                description:
                    'Tool names or wildcard patterns excluded from error purging. Supports glob wildcards: * matches any characters, ? matches a single character (e.g., "mcp_*", "my_tool_?")',
                examples: [["mcp_*", "my_tool_?"]],
            }),
    })
    .prefault({})
    .meta({ description: "Remove tool outputs that resulted in errors" })

const StrategiesSchema = z
    .object({
        deduplication: DeduplicationSchema,
        purgeErrors: PurgeErrorsSchema,
    })
    .prefault({})
    .meta({ description: "Automatic pruning strategies" })

export const ConfigSchema = z
    .object({
        $schema: z
            .string()
            .optional()
            .meta({ description: "JSON Schema reference for IDE autocomplete" }),
        enabled: z
            .boolean()
            .default(true)
            .meta({ description: "Enable or disable the DCP plugin" }),
        autoUpdate: z.boolean().default(true).meta({
            description:
                "Automatically update npm-installed DCP when a newer npm latest version is available. Version-locked plugin specs are not updated.",
        }),
        debug: z.boolean().default(false).meta({ description: "Enable debug logging" }),
        pruneNotification: z
            .enum(["off", "minimal", "detailed"])
            .default("detailed")
            .meta({ description: "Level of notification shown when context management occurs" }),
        pruneNotificationType: z.enum(["chat", "toast"]).default("chat").meta({
            description: "Where to display notifications (chat message or toast notification)",
        }),
        commands: CommandsSchema,
        manualMode: ManualModeSchema,
        turnProtection: TurnProtectionSchema,
        experimental: ExperimentalSchema,
        protectedFilePatterns: z
            .array(z.string())
            .default([])
            .meta({
                description:
                    "Glob patterns for files that should be protected from pruning (e.g., '**/*.config.ts')",
                examples: [["**/*.config.ts"]],
            }),
        compress: CompressSchema,
        strategies: StrategiesSchema,
    })
    .meta({
        title: "DCP Plugin Configuration",
        description: "Configuration schema for the OpenCode Dynamic Context Pruning plugin",
    })

export type Config = z.infer<typeof ConfigSchema>

export type JSONSchema = z.core.JSONSchema.JSONSchema

const CONFIG_SCHEMA_ID =
    "https://raw.githubusercontent.com/gerardbalaoro/opencode-dcp/main/dcp.schema.json"

export function getConfigSchema(): JSONSchema {
    const schema = z.toJSONSchema(ConfigSchema, { target: "draft-7", io: "input" })
    const defaults = ConfigSchema.parse({})

    addSchemaDefaults(schema, defaults)

    schema.$schema = "http://json-schema.org/draft-07/schema#"
    schema.$id = CONFIG_SCHEMA_ID
    schema.title = "DCP Plugin Configuration"
    schema.description = "Configuration schema for the OpenCode Dynamic Context Pruning plugin"
    schema.allowTrailingCommas = true

    return schema
}

type ConfigInput = z.input<typeof ConfigSchema>
type ConfigRecord = Record<string, unknown>

function addSchemaDefaults(schema: JSONSchema, defaults: unknown): void {
    if (!isConfigRecord(defaults) || schema.properties === undefined) {
        return
    }

    for (const [key, value] of Object.entries(defaults)) {
        const property = schema.properties[key]
        if (!isConfigRecord(property)) {
            continue
        }

        property.default = value
        addSchemaDefaults(property, value)
    }
}

const MERGED_ARRAY_PATHS = new Set([
    "commands.protectedTools",
    "protectedFilePatterns",
    "compress.protectedTools",
    "strategies.deduplication.protectedTools",
    "strategies.purgeErrors.protectedTools",
])

const REPLACED_MAP_PATHS = new Set(["compress.modelMaxLimits", "compress.modelMinLimits"])

function isConfigRecord(value: unknown): value is ConfigRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mergeRecords(base: ConfigRecord, override: ConfigRecord, prefix = ""): ConfigRecord {
    const merged: ConfigRecord = { ...base }

    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) {
            continue
        }

        const path = prefix ? `${prefix}.${key}` : key

        if (MERGED_ARRAY_PATHS.has(path)) {
            if (Array.isArray(merged[key]) && Array.isArray(value)) {
                merged[key] = [...new Set([...merged[key], ...value])]
            } else {
                merged[key] = value
            }
            continue
        }

        if (REPLACED_MAP_PATHS.has(path)) {
            merged[key] = value
            continue
        }

        if (isConfigRecord(merged[key]) && isConfigRecord(value)) {
            merged[key] = mergeRecords(merged[key], value, path)
        } else {
            merged[key] = value
        }
    }

    return merged
}

function merge(base: ConfigInput, override: ConfigInput): ConfigInput {
    return mergeRecords(base as ConfigRecord, override as ConfigRecord) as ConfigInput
}

function isMissingPathError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile()
    } catch (error) {
        if (isMissingPathError(error)) {
            return false
        }
        throw error
    }
}

function configInDirectory(directory: string): string | undefined {
    const jsoncPath = resolve(directory, "dcp.jsonc")
    if (isFile(jsoncPath)) {
        return jsoncPath
    }

    const jsonPath = resolve(directory, "dcp.json")
    if (isFile(jsonPath)) {
        return jsonPath
    }

    return undefined
}

function findProjectConfig(start: string): string | undefined {
    let current = resolve(start)

    while (true) {
        const projectConfig = configInDirectory(join(current, ".opencode"))
        if (projectConfig) {
            return projectConfig
        }

        const parent = dirname(current)
        if (parent === current) {
            return undefined
        }
        current = parent
    }
}

function scan(start: string): string[] {
    const paths: string[] = []
    const seen = new Set<string>()

    const add = (path: string | undefined): void => {
        if (path && !seen.has(path)) {
            seen.add(path)
            paths.push(path)
        }
    }

    add(findProjectConfig(start))

    const opencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    if (opencodeConfigDir) {
        add(configInDirectory(opencodeConfigDir))
    }

    const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
    add(configInDirectory(join(xdgConfigHome, "opencode")))

    return paths
}

function readConfigFile(configPath: string): ConfigInput | undefined {
    let fileContent: string
    try {
        fileContent = readFileSync(configPath, "utf-8")
    } catch (error) {
        if (isMissingPathError(error)) {
            return undefined
        }
        throw error
    }

    const errors: ParseError[] = []
    const parsed = jsoncParser.parse(fileContent, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
        throw new Error(`Invalid JSON in ${configPath}`)
    }

    if (!isConfigRecord(parsed)) {
        throw new Error(`Invalid config in ${configPath}: expected an object`)
    }

    return parsed as ConfigInput
}

export function loadConfig(start = process.cwd()): Config {
    let config: ConfigInput = ConfigSchema.parse({})

    for (const configPath of scan(start).reverse()) {
        const layer = readConfigFile(configPath)
        if (layer !== undefined) {
            config = merge(config, layer)
        }
    }

    return ConfigSchema.parse(config)
}
