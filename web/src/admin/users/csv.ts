import type { UserRequest, UserTypeEnum } from "@goauthentik/api";

/**
 * The set of user types that are valid for CSV import.
 *
 * `internal_service_account` is intentionally excluded as it is managed by
 * authentik and cannot be assigned manually.
 */
export const IMPORTABLE_USER_TYPES = ["internal", "external", "service_account"] as const;

/**
 * Columns that are understood by the CSV importer.
 *
 * `username` is the only required column, everything else is optional and falls
 * back to a sensible default when omitted.
 */
export const USER_CSV_COLUMNS = ["username", "name", "email", "type", "is_active", "path"] as const;

export type UserCSVColumn = (typeof USER_CSV_COLUMNS)[number];

/**
 * A standard/example CSV that documents the expected format and can be offered
 * to administrators as a downloadable template.
 */
export const EXAMPLE_USER_CSV = [
    "username,name,email,type,is_active,path",
    "jdoe,John Doe,jdoe@example.com,internal,true,users",
    "asmith,Alice Smith,alice.smith@example.com,internal,true,users",
    'bservice,"Backup, Service",backup@example.com,service_account,true,users/service-accounts',
    " guest,Guest User,guest@example.com,external,false,users",
].join("\n");

/**
 * A single successfully parsed row, paired with the 1-based line number it
 * originated from so the UI can reference it in feedback.
 */
export interface ParsedUserRow {
    /** 1-based line number in the source CSV (the header is line 1). */
    line: number;
    user: UserRequest;
}

/**
 * A problem encountered while parsing/validating a single row.
 */
export interface UserCSVRowError {
    /** 1-based line number in the source CSV (the header is line 1). */
    line: number;
    message: string;
}

export interface UserCSVParseResult {
    users: ParsedUserRow[];
    errors: UserCSVRowError[];
}

/**
 * Parse a chunk of CSV text into an array of records (rows of string fields).
 *
 * Implements a small RFC-4180-ish state machine that understands:
 * - quoted fields (`"..."`) which may contain commas and newlines,
 * - escaped quotes inside quoted fields (`""`),
 * - both `\n` and `\r\n` line endings.
 *
 * Fully empty lines are skipped.
 */
export function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let field = "";
    let row: string[] = [];
    let inQuotes = false;
    let fieldStarted = false;

    const pushField = () => {
        row.push(field);
        field = "";
        fieldStarted = false;
    };

    const pushRow = () => {
        pushField();
        // Skip rows that are completely empty (a single empty, unquoted field).
        const isEmpty = row.length === 1 && row[0] === "";
        if (!isEmpty) {
            rows.push(row);
        }
        row = [];
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        switch (char) {
            case '"':
                // Only treat as the start of a quoted field if no characters
                // have been consumed for the current field yet.
                if (!fieldStarted && field === "") {
                    inQuotes = true;
                    fieldStarted = true;
                } else {
                    field += char;
                }
                break;
            case ",":
                pushField();
                break;
            case "\r":
                // Swallow `\r`; the following `\n` (if any) terminates the row.
                break;
            case "\n":
                pushRow();
                break;
            default:
                field += char;
                fieldStarted = true;
                break;
        }
    }

    // Flush any trailing field/row that wasn't terminated by a newline.
    if (field !== "" || row.length > 0 || fieldStarted) {
        pushRow();
    }

    return rows;
}

/**
 * Parse a boolean-ish string. Returns `undefined` when the value cannot be
 * interpreted as a boolean.
 */
export function parseBoolean(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "active"].includes(normalized)) {
        return true;
    }
    if (["false", "0", "no", "n", "inactive"].includes(normalized)) {
        return false;
    }
    return undefined;
}

function isImportableType(value: string): value is UserTypeEnum {
    return (IMPORTABLE_USER_TYPES as readonly string[]).includes(value);
}

/**
 * Parse and validate a CSV document into `UserRequest` objects.
 *
 * The first non-empty line is treated as a header that maps columns to fields.
 * The only required column is `username`.
 */
export function parseUserCSV(text: string): UserCSVParseResult {
    const result: UserCSVParseResult = { users: [], errors: [] };

    const rows = parseCSV(text);

    if (rows.length === 0) {
        result.errors.push({ line: 1, message: "The file is empty." });
        return result;
    }

    const header = rows[0].map((column) => column.trim().toLowerCase());

    if (!header.includes("username")) {
        result.errors.push({
            line: 1,
            message: 'The header row must contain a "username" column.',
        });
        return result;
    }

    for (let r = 1; r < rows.length; r++) {
        // +1 to convert from 0-based index to a 1-based, header-inclusive line number.
        const line = r + 1;
        const cells = rows[r];

        const record: Record<string, string> = {};
        header.forEach((column, index) => {
            record[column] = (cells[index] ?? "").trim();
        });

        const username = record.username ?? "";

        if (!username) {
            result.errors.push({ line, message: "Missing required value: username." });
            continue;
        }

        const user: UserRequest = {
            username,
            name: record.name || username,
        };

        if (record.email) {
            user.email = record.email;
        }

        if (record.path) {
            user.path = record.path;
        }

        if (record.type) {
            const type = record.type.toLowerCase();
            if (!isImportableType(type)) {
                result.errors.push({
                    line,
                    message: `Invalid user type "${record.type}". Must be one of: ${IMPORTABLE_USER_TYPES.join(", ")}.`,
                });
                continue;
            }
            user.type = type;
        }

        if (record.is_active) {
            const isActive = parseBoolean(record.is_active);
            if (isActive === undefined) {
                result.errors.push({
                    line,
                    message: `Invalid value for is_active: "${record.is_active}". Use true or false.`,
                });
                continue;
            }
            user.isActive = isActive;
        }

        result.users.push({ line, user });
    }

    if (result.users.length === 0 && result.errors.length === 0) {
        result.errors.push({ line: 1, message: "No user rows found in the file." });
    }

    return result;
}
