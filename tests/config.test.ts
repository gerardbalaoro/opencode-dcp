import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigSchema, getConfigSchema, loadConfig, type Config } from "../src/lib/config"

type ExpectedLimit = number | `${number}%`
type Equal<Left, Right> =
    (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
        ? true
        : false
type Assert<T extends true> = T
const limitTypeAssertions: [
    Assert<Equal<Config["compress"]["maxContextLimit"], ExpectedLimit>>,
    Assert<Equal<Config["compress"]["modelMaxLimits"][string], ExpectedLimit>>,
] = [true, true]
void limitTypeAssertions

interface ConfigFixture {
    root: string
    project: string
    configDir: string
    xdgConfigHome: string
}

function createFixture(): ConfigFixture {
    const root = mkdtempSync(join(tmpdir(), "opencode-dcp-config-tests-"))
    const project = join(root, "project", "nested")
    const configDir = join(root, "opencode-config")
    const xdgConfigHome = join(root, "xdg")
    mkdirSync(project, { recursive: true })
    return { root, project, configDir, xdgConfigHome }
}

function writeConfig(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents, "utf-8")
}

function withEnvironment<T>(overrides: Record<string, string | undefined>, callback: () => T): T {
    const previous = new Map<string, string | undefined>()

    for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key])
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }

    try {
        return callback()
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
    }
}

function withConfigEnvironment<T>(fixture: ConfigFixture, callback: () => T): T {
    return withEnvironment(
        {
            XDG_CONFIG_HOME: fixture.xdgConfigHome,
            OPENCODE_CONFIG_DIR: fixture.configDir,
        },
        callback,
    )
}

function withCurrentDirectory<T>(directory: string, callback: () => T): T {
    const previous = process.cwd()
    process.chdir(directory)

    try {
        return callback()
    } finally {
        process.chdir(previous)
    }
}

function cleanupFixture(fixture: ConfigFixture): void {
    rmSync(fixture.root, { recursive: true, force: true })
}

function schemaObject(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Expected a JSON Schema object")
    }

    return value as Record<string, unknown>
}

function assertSchemaDefaultsMatch(schema: unknown, defaults: unknown, path = "root"): void {
    if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
        return
    }

    const schemaRecord = schemaObject(schema)
    if (schemaRecord.properties === undefined) {
        return
    }

    const properties = schemaObject(schemaRecord.properties)
    for (const [key, value] of Object.entries(defaults)) {
        const property = schemaObject(properties[key])
        assert.deepEqual(property.default, value, `${path}.${key}`)
        assertSchemaDefaultsMatch(property, value, `${path}.${key}`)
    }
}

test("ConfigSchema supplies exact defaults", () => {
    assert.deepEqual(ConfigSchema.parse({}), {
        enabled: true,
        autoUpdate: true,
        debug: false,
        pruneNotification: "detailed",
        pruneNotificationType: "chat",
        commands: {
            enabled: true,
            protectedTools: [
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
            ],
        },
        manualMode: {
            enabled: false,
            automaticStrategies: true,
        },
        turnProtection: {
            enabled: false,
            turns: 4,
        },
        experimental: {
            allowSubAgents: false,
            customPrompts: false,
        },
        protectedFilePatterns: [],
        compress: {
            mode: "range",
            permission: "allow",
            showCompression: false,
            summaryBuffer: true,
            maxContextLimit: 100000,
            minContextLimit: 50000,
            modelMaxLimits: {},
            modelMinLimits: {},
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: ["task", "skill", "todowrite", "todoread"],
            protectTags: false,
            protectUserMessages: false,
        },
        strategies: {
            deduplication: {
                enabled: true,
                protectedTools: [],
            },
            purgeErrors: {
                enabled: true,
                turns: 4,
                protectedTools: [],
            },
        },
    })
})

test("getConfigSchema exposes the draft-07 root metadata", () => {
    const schema = getConfigSchema()

    assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#")
    assert.equal(
        schema.$id,
        "https://raw.githubusercontent.com/gerardbalaoro/opencode-dcp/main/dcp.schema.json",
    )
    assert.equal(schema.title, "DCP Plugin Configuration")
    assert.equal(
        schema.description,
        "Configuration schema for the OpenCode Dynamic Context Pruning plugin",
    )
})

test("getConfigSchema describes input fields without incorrect required entries", () => {
    const schema = getConfigSchema()
    const properties = schemaObject(schema.properties)

    assert.equal(schema.required, undefined)
    assert.equal(schemaObject(properties.commands).required, undefined)
    assert.equal(schemaObject(properties.compress).required, undefined)
    assert.equal(schemaObject(properties.strategies).required, undefined)
})

test("getConfigSchema preserves field metadata and constraints", () => {
    const schema = getConfigSchema()
    const properties = schemaObject(schema.properties)
    const compress = schemaObject(properties.compress)
    const compressProperties = schemaObject(compress.properties)
    const maxContextLimit = schemaObject(compressProperties.maxContextLimit)
    const anyOf = maxContextLimit.anyOf as unknown[] | undefined
    const percentLimit = schemaObject(
        anyOf?.find(
            (option) =>
                typeof option === "object" &&
                option !== null &&
                "type" in option &&
                option.type === "string",
        ),
    )
    const turnProtection = schemaObject(properties.turnProtection)
    const turnsProperties = schemaObject(turnProtection.properties)
    const turns = schemaObject(turnsProperties.turns)

    assert.equal(compress.description, "Configuration for the unified compress tool")
    assert.deepEqual(maxContextLimit.examples, ["80%"])
    assert.equal(percentLimit.pattern, "^\\d+(?:\\.\\d+)?%$")
    assert.equal(turns.minimum, 1)
})

test("getConfigSchema derives recursive defaults from runtime parsing", () => {
    const schema = getConfigSchema()
    const defaults = ConfigSchema.parse({})

    assertSchemaDefaultsMatch(schema, defaults)
})

test("ConfigSchema accepts numeric and percentage limits only", () => {
    const config = ConfigSchema.parse({
        compress: {
            maxContextLimit: "80%",
            minContextLimit: 50000,
            modelMaxLimits: { "provider/model": "40%" },
            modelMinLimits: { "provider/model": 20000 },
        },
    })

    assert.equal(config.compress.maxContextLimit, "80%")
    assert.equal(config.compress.minContextLimit, 50000)
    assert.equal(config.compress.modelMaxLimits["provider/model"], "40%")
    assert.equal(config.compress.modelMinLimits["provider/model"], 20000)
    assert.throws(() => ConfigSchema.parse({ compress: { maxContextLimit: "not-a-limit" } }))
})

test("getConfigSchema returns independent schema objects", () => {
    const first = getConfigSchema()
    const second = getConfigSchema()
    const firstCommands = schemaObject(schemaObject(first.properties).commands)
    const secondCommands = schemaObject(schemaObject(second.properties).commands)
    const firstDefault = schemaObject(firstCommands.default)
    const secondDefault = schemaObject(secondCommands.default)

    assert.notStrictEqual(first, second)
    assert.notStrictEqual(firstCommands.default, secondCommands.default)
    ;(firstDefault.protectedTools as string[]).push("mutated")
    assert.equal((secondDefault.protectedTools as string[]).includes("mutated"), false)
})

test("ConfigSchema strips unknown top-level and nested keys", () => {
    const config = ConfigSchema.parse({
        showUpdateToasts: false,
        commands: { enabled: false, unknown: true },
        compress: { mode: "message", unknown: true },
        strategies: {
            deduplication: { unknown: true },
            purgeErrors: { unknown: true },
        },
    } as unknown)

    assert.equal(config.commands.enabled, false)
    assert.equal(config.compress.mode, "message")
    assert.equal("showUpdateToasts" in config, false)
    assert.equal("unknown" in config.commands, false)
    assert.equal("unknown" in config.compress, false)
    assert.equal("unknown" in config.strategies.deduplication, false)
    assert.equal("unknown" in config.strategies.purgeErrors, false)
})

test("loadConfig handles missing paths without creating config paths", () => {
    const fixture = createFixture()
    const missingStart = join(fixture.root, "missing", "nested")

    try {
        const config = withConfigEnvironment(fixture, () => loadConfig(missingStart))

        assert.equal(config.enabled, true)
        assert.equal(config.compress.nudgeFrequency, 5)
        assert.equal(config.strategies.purgeErrors.turns, 4)
        assert.equal(existsSync(missingStart), false)
        assert.equal(existsSync(fixture.xdgConfigHome), false)
        assert.equal(existsSync(fixture.configDir), false)
        assert.equal(existsSync(join(fixture.root, "project", ".opencode")), false)
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig falls back to dcp.json when dcp.jsonc is absent", () => {
    const fixture = createFixture()

    try {
        writeConfig(
            join(fixture.configDir, "dcp.json"),
            JSON.stringify({ $schema: "json-schema", debug: true }),
        )

        const config = withConfigEnvironment(fixture, () => loadConfig(fixture.project))

        assert.equal(config.$schema, "json-schema")
        assert.equal(config.debug, true)
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig uses the nearest actual project config", () => {
    const fixture = createFixture()

    try {
        writeConfig(
            join(fixture.root, ".opencode", "dcp.json"),
            JSON.stringify({ $schema: "ancestor", debug: true }),
        )
        writeConfig(
            join(fixture.root, "project", ".opencode", "dcp.json"),
            JSON.stringify({ $schema: "nearest", debug: false }),
        )

        const config = withConfigEnvironment(fixture, () => loadConfig(fixture.project))

        assert.equal(config.$schema, "nearest")
        assert.equal(config.debug, false)
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig uses process.cwd when no start is provided", () => {
    const fixture = createFixture()

    try {
        writeConfig(
            join(fixture.root, "project", ".opencode", "dcp.json"),
            JSON.stringify({ $schema: "cwd-config" }),
        )

        const config = withConfigEnvironment(fixture, () =>
            withCurrentDirectory(fixture.project, () => loadConfig()),
        )

        assert.equal(config.$schema, "cwd-config")
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig uses the HOME config when XDG_CONFIG_HOME is unset", () => {
    const fixture = createFixture()
    const home = join(fixture.root, "home")

    try {
        writeConfig(
            join(home, ".config", "opencode", "dcp.json"),
            JSON.stringify({ $schema: "home-config" }),
        )

        const environment = { ...process.env, HOME: home }
        delete environment.XDG_CONFIG_HOME
        delete environment.OPENCODE_CONFIG_DIR

        const result = spawnSync(
            "bun",
            [
                "--eval",
                `
                    import { loadConfig } from ${JSON.stringify(new URL("../src/lib/config.ts", import.meta.url).href)}

                    const config = loadConfig(${JSON.stringify(fixture.project)})
                    if (config.$schema !== "home-config") {
                        throw new Error(
                            \`Expected the HOME config, got \${JSON.stringify(config.$schema)}\`,
                        )
                    }
                `,
            ],
            { env: environment, encoding: "utf8" },
        )

        assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig applies project, config-dir, and global layers with their merge rules", () => {
    const fixture = createFixture()

    try {
        writeConfig(
            join(fixture.xdgConfigHome, "opencode", "dcp.jsonc"),
            `{
                // lowest priority layer
                "enabled": false,
                "debug": false,
                "$schema": "global-schema",
                "commands": { "protectedTools": ["global", "shared"] },
                "protectedFilePatterns": ["global-pattern"],
                "compress": {
                    "protectedTools": ["global-compress"],
                    "modelMaxLimits": { "global/model": 10 },
                    "modelMinLimits": { "global/model": 5 },
                },
                "strategies": {
                    "deduplication": { "protectedTools": ["global-dedup"] },
                    "purgeErrors": { "protectedTools": ["global-purge"] },
                },
            }`,
        )
        writeConfig(
            join(fixture.configDir, "dcp.json"),
            JSON.stringify({
                enabled: false,
                debug: false,
                commands: { protectedTools: ["json"] },
            }),
        )
        writeConfig(
            join(fixture.configDir, "dcp.jsonc"),
            `{
                "enabled": true,
                "debug": true,
                "$schema": "config-dir-schema",
                "commands": { "protectedTools": ["config", "shared"] },
                "protectedFilePatterns": ["config-pattern"],
                "compress": {
                    "nudgeFrequency": 3,
                    "protectedTools": ["config-compress"],
                    "modelMaxLimits": { "config/model": 20 },
                    "modelMinLimits": { "config/model": 15 },
                },
                "strategies": {
                    "deduplication": { "protectedTools": ["config-dedup"] },
                    "purgeErrors": { "protectedTools": ["config-purge"] },
                },
            }`,
        )
        writeConfig(
            join(fixture.root, "project", ".opencode", "dcp.json"),
            JSON.stringify({ enabled: true, commands: { protectedTools: ["json-project"] } }),
        )
        writeConfig(
            join(fixture.root, "project", ".opencode", "dcp.jsonc"),
            `{
                "enabled": false,
                "$schema": "project-schema",
                "commands": { "protectedTools": ["project", "shared"] },
                "protectedFilePatterns": ["project-pattern"],
                "compress": {
                    "protectedTools": ["project-compress"],
                    "modelMaxLimits": { "project/model": 30 },
                    "modelMinLimits": {},
                },
                "strategies": {
                    "deduplication": { "protectedTools": ["project-dedup"] },
                    "purgeErrors": { "protectedTools": ["project-purge"] },
                },
            }`,
        )

        const config = withConfigEnvironment(fixture, () => loadConfig(fixture.project))

        assert.equal(config.enabled, false)
        assert.equal(config.debug, true)
        assert.equal(config.compress.nudgeFrequency, 3)
        assert.equal(config.$schema, "project-schema")
        assert.deepEqual(config.compress.modelMaxLimits, { "project/model": 30 })
        assert.deepEqual(config.compress.modelMinLimits, {})
        assert.deepEqual(config.protectedFilePatterns, [
            "global-pattern",
            "config-pattern",
            "project-pattern",
        ])
        assert.deepEqual(config.strategies.deduplication.protectedTools, [
            "global-dedup",
            "config-dedup",
            "project-dedup",
        ])
        assert.deepEqual(config.strategies.purgeErrors.protectedTools, [
            "global-purge",
            "config-purge",
            "project-purge",
        ])
        assert.deepEqual(config.commands.protectedTools.slice(-4), [
            "global",
            "shared",
            "config",
            "project",
        ])
        assert.deepEqual(config.compress.protectedTools.slice(-3), [
            "global-compress",
            "config-compress",
            "project-compress",
        ])
        assert.equal(config.commands.protectedTools.includes("json"), false)
        assert.equal(config.commands.protectedTools.includes("json-project"), false)
    } finally {
        cleanupFixture(fixture)
    }
})

test("loadConfig throws for malformed JSONC and final schema-invalid values", () => {
    const fixture = createFixture()

    try {
        const configPath = join(fixture.root, "project", ".opencode", "dcp.jsonc")

        writeConfig(configPath, "{ enabled: true,")
        assert.throws(() => withConfigEnvironment(fixture, () => loadConfig(fixture.project)))

        writeConfig(configPath, JSON.stringify({ enabled: "yes" }))
        assert.throws(() => withConfigEnvironment(fixture, () => loadConfig(fixture.project)))
    } finally {
        cleanupFixture(fixture)
    }
})
