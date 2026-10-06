export interface TemporaryPasswordUser {
    pk: number;
    username: string;
}

export interface TemporaryPasswordFailure {
    username: string;
    message: string;
}

export interface TemporaryPasswordResult {
    succeeded: string[];
    failed: TemporaryPasswordFailure[];
}

export function validateTemporaryPassword(password: string, confirmation: string): string | null {
    if (!password) {
        return "Password is required.";
    }
    if (password !== confirmation) {
        return "Password confirmation does not match.";
    }
    return null;
}

/**
 * Set the same password for each user while keeping failures isolated.
 *
 * The returned summary intentionally contains usernames only. The password is
 * never retained in result state or included in an error message.
 */
export async function setTemporaryPasswordForUsers(
    users: TemporaryPasswordUser[],
    password: string,
    setPassword: (user: TemporaryPasswordUser, password: string) => Promise<void>,
): Promise<TemporaryPasswordResult> {
    const result: TemporaryPasswordResult = { succeeded: [], failed: [] };

    for (const user of users) {
        try {
            await setPassword(user, password);
            result.succeeded.push(user.username);
        } catch (error) {
            result.failed.push({
                username: user.username,
                message: error instanceof Error && error.message ? error.message : "Unknown error",
            });
        }
    }

    return result;
}
