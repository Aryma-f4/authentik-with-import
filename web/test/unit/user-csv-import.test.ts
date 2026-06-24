import { EXAMPLE_USER_CSV, parseBoolean, parseCSV, parseUserCSV } from "#admin/users/csv";

import { describe, expect, it } from "vitest";

describe("parseCSV", () => {
    it("parses a simple document into rows of fields", () => {
        expect(parseCSV("a,b,c\n1,2,3")).toEqual([
            ["a", "b", "c"],
            ["1", "2", "3"],
        ]);
    });

    it("handles quoted fields containing commas", () => {
        expect(parseCSV('name,note\n"Doe, John",hello')).toEqual([
            ["name", "note"],
            ["Doe, John", "hello"],
        ]);
    });

    it("handles escaped quotes inside quoted fields", () => {
        expect(parseCSV('value\n"a ""quoted"" word"')).toEqual([["value"], ['a "quoted" word']]);
    });

    it("handles newlines inside quoted fields", () => {
        expect(parseCSV('value\n"line1\nline2"')).toEqual([["value"], ["line1\nline2"]]);
    });

    it("supports CRLF line endings and skips empty lines", () => {
        expect(parseCSV("a,b\r\n1,2\r\n\r\n3,4")).toEqual([
            ["a", "b"],
            ["1", "2"],
            ["3", "4"],
        ]);
    });
});

describe("parseBoolean", () => {
    it("recognizes truthy values", () => {
        expect(parseBoolean("true")).toBe(true);
        expect(parseBoolean(" YES ")).toBe(true);
        expect(parseBoolean("1")).toBe(true);
    });

    it("recognizes falsy values", () => {
        expect(parseBoolean("false")).toBe(false);
        expect(parseBoolean("No")).toBe(false);
        expect(parseBoolean("0")).toBe(false);
    });

    it("returns undefined for unrecognized values", () => {
        expect(parseBoolean("maybe")).toBeUndefined();
        expect(parseBoolean("")).toBeUndefined();
    });
});

describe("parseUserCSV", () => {
    it("parses the bundled example CSV without errors", () => {
        const result = parseUserCSV(EXAMPLE_USER_CSV);

        expect(result.errors).toEqual([]);
        expect(result.users.map((row) => row.user.username)).toEqual([
            "jdoe",
            "asmith",
            "bservice",
            "guest",
        ]);

        const [jdoe] = result.users;
        expect(jdoe.user).toMatchObject({
            username: "jdoe",
            name: "John Doe",
            email: "jdoe@example.com",
            type: "internal",
            isActive: true,
            path: "users",
        });

        const guest = result.users[3];
        expect(guest.user.type).toBe("external");
        expect(guest.user.isActive).toBe(false);

        const service = result.users[2];
        expect(service.user.name).toBe("Backup, Service");
        expect(service.user.type).toBe("service_account");
    });

    it("requires a username header", () => {
        const result = parseUserCSV("name,email\nJohn,john@example.com");

        expect(result.users).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toMatch(/username/);
    });

    it("reports an error for an empty document", () => {
        const result = parseUserCSV("");

        expect(result.users).toEqual([]);
        expect(result.errors).toHaveLength(1);
    });

    it("defaults the display name to the username and leaves optionals unset", () => {
        const result = parseUserCSV("username\njdoe");

        expect(result.errors).toEqual([]);
        expect(result.users).toHaveLength(1);
        expect(result.users[0].user).toEqual({ username: "jdoe", name: "jdoe" });
    });

    it("skips rows with a missing username and keeps the valid ones", () => {
        const result = parseUserCSV("username,name\njdoe,John\n,Nobody\nasmith,Alice");

        expect(result.users.map((row) => row.user.username)).toEqual(["jdoe", "asmith"]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].line).toBe(3);
    });

    it("rejects an invalid user type", () => {
        const result = parseUserCSV("username,type\njdoe,wizard");

        expect(result.users).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toMatch(/Invalid user type/);
    });

    it("rejects an invalid is_active value", () => {
        const result = parseUserCSV("username,is_active\njdoe,perhaps");

        expect(result.users).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toMatch(/is_active/);
    });

    it("is case-insensitive for headers and types", () => {
        const result = parseUserCSV("Username,Type\njdoe,INTERNAL");

        expect(result.errors).toEqual([]);
        expect(result.users[0].user.type).toBe("internal");
    });
});
