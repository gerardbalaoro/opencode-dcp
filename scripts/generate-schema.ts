#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getConfigSchema } from "../src/lib/config"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaPath = resolve(root, "dcp.schema.json")

function usage(): string {
    return `Usage: bun scripts/generate-schema.ts [--check]

Generate dcp.schema.json from getConfigSchema().

Options:
  --check  Verify the checked-in schema is current without modifying it.
  --help   Show this help message.
`
}

function serializeSchema(): string {
    const schema = getConfigSchema()
    return JSON.stringify(schema, null, 4) + "\n"
}

function isMissingFileError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
}

function main(): number {
    const args = process.argv.slice(2)

    if (args.includes("--help") || args.includes("-h")) {
        console.log(usage())
        return 0
    }

    if (args.some((arg) => arg !== "--check")) {
        console.error(`Unknown option.\n\n${usage()}`)
        return 1
    }

    const expected = serializeSchema()
    const check = args.includes("--check")

    if (check) {
        let actual: string
        try {
            actual = readFileSync(schemaPath, "utf8")
        } catch (error) {
            if (isMissingFileError(error)) {
                console.error(
                    `Schema check failed: ${relative(root, schemaPath)} is missing. Run bun scripts/generate-schema.ts.`,
                )
                return 1
            }
            throw error
        }

        if (actual !== expected) {
            console.error(
                `Schema check failed: ${relative(root, schemaPath)} is stale. Run bun scripts/generate-schema.ts.`,
            )
            return 1
        }

        console.log(`Schema check passed: ${relative(root, schemaPath)}`)
        return 0
    }

    writeFileSync(schemaPath, expected, "utf8")
    console.log(`Generated ${relative(root, schemaPath)}`)
    return 0
}

process.exitCode = main()
