import { setTemporaryPasswordForUsers, validateTemporaryPassword } from "#admin/users/bulkPassword";

import { describe, expect, it } from "vitest";

describe("validateTemporaryPassword", () => {
    it("requires a non-empty password", () => {
        expect(validateTemporaryPassword("", "")).toBe("Password is required.");
    });

    it("requires matching confirmation", () => {
        expect(validateTemporaryPassword("Temporary-1", "Temporary-2")).toBe(
            "Password confirmation does not match.",
        );
    });

    it("accepts matching passwords", () => {
        expect(validateTemporaryPassword("Temporary-1", "Temporary-1")).toBeNull();
    });
});

describe("setTemporaryPasswordForUsers", () => {
    it("reports successful users without returning the password", async () => {
        const result = await setTemporaryPasswordForUsers(
            [
                { pk: 10, username: "student-1" },
                { pk: 11, username: "student-2" },
            ],
            "Temporary-1",
            async () => undefined,
        );

        expect(result).toEqual({
            succeeded: ["student-1", "student-2"],
            failed: [],
        });
        expect(JSON.stringify(result)).not.toContain("Temporary-1");
    });

    it("continues after a failure and identifies the failed username", async () => {
        const result = await setTemporaryPasswordForUsers(
            [
                { pk: 10, username: "student-1" },
                { pk: 11, username: "student-2" },
            ],
            "Temporary-1",
            async (user) => {
                if (user.pk === 10) {
                    throw new Error("Password policy rejected the value");
                }
            },
        );

        expect(result).toEqual({
            succeeded: ["student-2"],
            failed: [
                {
                    username: "student-1",
                    message: "Password policy rejected the value",
                },
            ],
        });
    });
});
