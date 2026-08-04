import assert from "node:assert/strict"
import test from "node:test"
import { configureClientAuth, getAuthorizationHeader, isSecureMode } from "../src/lib/auth"

type RequestInterceptor = (request: Request) => Request

test("authentication behavior", async (t) => {
    await t.test("missing and empty passwords disable authentication", () => {
        for (const password of [undefined, ""] as const) {
            const fixture = createClientFixture()
            const configuredClient = withAuthEnvironment({ password }, () => {
                assert.equal(isSecureMode(), false)
                assert.equal(getAuthorizationHeader(), undefined)
                return configureClientAuth(fixture.client)
            })

            assert.equal(configuredClient, fixture.client)
            assert.equal(fixture.registrationCount, 0)
        }
    })

    await t.test("default username produces the expected authorization header", () => {
        const fixture = createClientFixture()
        const configuredClient = withAuthEnvironment({ password: "secret" }, () => {
            assert.equal(isSecureMode(), true)
            assert.equal(getAuthorizationHeader(), "Basic b3BlbmNvZGU6c2VjcmV0")
            return configureClientAuth(fixture.client)
        })

        assert.equal(configuredClient, fixture.client)
        assert.equal(fixture.registrationCount, 1)

        const interceptor = fixture.interceptor
        assert.ok(interceptor)

        const request = new Request("https://example.test")
        assert.equal(interceptor(request), request)
        assert.equal(request.headers.get("Authorization"), "Basic b3BlbmNvZGU6c2VjcmV0")

        const existingAuthorizationRequest = new Request("https://example.test", {
            headers: { Authorization: "Bearer existing" },
        })
        interceptor(existingAuthorizationRequest)
        assert.equal(existingAuthorizationRequest.headers.get("Authorization"), "Bearer existing")
    })

    await t.test("custom username produces the expected authorization header", () => {
        withAuthEnvironment({ password: "secret", username: "alice" }, () => {
            assert.equal(getAuthorizationHeader(), "Basic YWxpY2U6c2VjcmV0")
        })
    })

    await t.test("missing request interceptors are a no-op", () => {
        withAuthEnvironment({ password: "secret" }, () => {
            const client = { _client: {} }
            assert.equal(configureClientAuth(client), client)
        })
    })
})

function createClientFixture() {
    let interceptor: RequestInterceptor | undefined
    let registrationCount = 0

    const client = {
        _client: {
            interceptors: {
                request: {
                    use(callback: RequestInterceptor) {
                        interceptor = callback
                        registrationCount += 1
                    },
                },
            },
        },
    }

    return {
        client,
        get interceptor() {
            return interceptor
        },
        get registrationCount() {
            return registrationCount
        },
    }
}

function withAuthEnvironment<T>(
    values: { password?: string; username?: string },
    callback: () => T,
): T {
    const previousPassword = process.env.OPENCODE_SERVER_PASSWORD
    const previousUsername = process.env.OPENCODE_SERVER_USERNAME

    try {
        setEnvironmentValue("OPENCODE_SERVER_PASSWORD", values.password)
        setEnvironmentValue("OPENCODE_SERVER_USERNAME", values.username)
        return callback()
    } finally {
        setEnvironmentValue("OPENCODE_SERVER_PASSWORD", previousPassword)
        setEnvironmentValue("OPENCODE_SERVER_USERNAME", previousUsername)
    }
}

function setEnvironmentValue(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name]
    } else {
        process.env[name] = value
    }
}
